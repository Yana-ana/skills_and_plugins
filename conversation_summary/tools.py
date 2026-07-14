"""
Helpers for the conversation-summary skill.

The skill queries data through the plugin tool `query_database`. This module only
parses returned rows, builds a transcript, classifies the scene, and assembles the
prompt payload. It does not connect to LanceDB/TOS directly.
"""

import json
import logging
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

try:
    from .scene_classifier import classify
    from .template_registry import get_template
except ImportError:
    from scene_classifier import classify
    from template_registry import get_template

logger = logging.getLogger(__name__)


_JSON_OUTPUT_PREFIX = """【输出格式硬性约束 — 最高优先级】
你的整段回复必须是一个合法 JSON 对象，且仅此一个对象，不要任何 JSON 之外的字符。

输出结构（仅此四字段，scene 原样照抄不要翻译/改写）：
{
  "title": "12字以内的对话标题",
  "content": "<按下方规范生成的 Markdown 报告全文，作为字符串放在这里>",
  "scene": "{{SCENE}}",
  "knowledge_graph": {
    "nodes": [
      {
        "ref_id": "n1",
        "node_type": "person|event|item|organization",
        "node_subtype": "自由标签，如 speaker、meeting、issue、task、product、company、other",
        "canonical_name": "实体规范名称；如果是 SPK_xxx 说话人则必须原样保留",
        "confidence": 0.0
      },
      {
        "ref_id": "n2",
        "node_type": "person|event|item|organization",
        "node_subtype": "自由标签，如 speaker、meeting、issue、task、product、company、other",
        "canonical_name": "另一个实体规范名称",
        "confidence": 0.0
      }
    ],
    "edges": [
      {
        "ref_id": "e1",
        "source_ref": "n1",
        "target_ref": "n2",
        "rel_type": "关系名称，如 参与、提及、涉及、负责、阻塞",
        "confidence": 0.0
      }
    ],
    "properties": [
      {
        "owner_type": "node|edge",
        "owner_ref": "n1 或 e1",
        "prop_name": "属性名称",
        "prop_value": "属性值",
        "value_type": "string|number|date|bool|json",
        "confidence": 0.0
      }
    ],
    "evidence": [
      {
        "target_type": "node|edge",
        "target_ref": "n1 或 e1",
        "source_type": "summary",
        "source_ref": {
          "conversation_id": "{{CONVERSATION_ID}}",
          "date": "{{DATE}}",
          "section": "content 中对应章节名",
          "reason": "简短说明该知识来自哪类总结内容"
        }
      }
    ]
  }
}

knowledge_graph 抽取规则：
1. 只基于本次对话和你生成的 content 总结抽取，不要编造未出现的信息。
2. node_type 必须且只能取 person、event、item、organization 四类之一。
3. 不要输出 aliases 字段。
4. node_subtype 暂不做强枚举，可以根据语义输出简短英文标签；不确定时使用 other。
5. rel_type 必须是简短、事实型中文关系谓词，建议 2-6 个字；不要输出主观推断关系。
6. 当 evidence.source_type 为 summary 时，source_ref 必须包含 conversation_id 和 date。

---

"""


class ConversationNotFound(Exception):
    """Conversation does not exist or does not belong to the requested user."""


def _first_row(rows: Sequence[Dict]) -> Dict:
    return rows[0] if rows else {}


def _as_str(value) -> str:
    return "" if value is None else str(value)


def _id_equal(left, right) -> bool:
    return _as_str(left).strip() == _as_str(right).strip()


def _parse_meta(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    if not raw:
        return {}
    try:
        return json.loads(str(raw))
    except (json.JSONDecodeError, TypeError, ValueError):
        return {}


def _rows_from_text(text: str) -> List[Dict]:
    start = text.find("[")
    if start < 0:
        return []
    try:
        value = json.loads(text[start:])
    except (json.JSONDecodeError, TypeError, ValueError):
        return []
    return value if isinstance(value, list) else []


def parse_query_database_rows(result) -> List[Dict]:
    """
    Extract rows from a query_database tool result.

    Preferred shape is result["details"]["rows"]. If only the text response is
    available, this falls back to parsing the JSON array after the status line.
    """
    if isinstance(result, list):
        return [row for row in result if isinstance(row, dict)]

    if isinstance(result, dict):
        details = result.get("details")
        if isinstance(details, dict) and isinstance(details.get("rows"), list):
            return [row for row in details["rows"] if isinstance(row, dict)]

        content = result.get("content")
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and isinstance(part.get("text"), str):
                    rows = _rows_from_text(part["text"])
                    if rows:
                        return rows

    if isinstance(result, str):
        return _rows_from_text(result)

    return []


def _speaker_segments(row: Dict) -> List[Tuple[str, str]]:
    meta = _parse_meta(row.get("meta_data"))
    transcriptions = meta.get("speaker_transcriptions")
    if not isinstance(transcriptions, list):
        return []

    segments: List[Tuple[str, str]] = []
    for segment in transcriptions:
        if not isinstance(segment, dict):
            continue
        speaker = _as_str(segment.get("speaker")).strip()
        text = _as_str(segment.get("text")).strip()
        if text:
            segments.append((speaker, text))
    return segments


def build_transcript(item_rows: Iterable[Dict]) -> Tuple[str, List[str], int]:
    """Build transcript text from query_database rows."""
    parts: List[str] = []
    speakers = set()
    item_count = 0

    for row in item_rows:
        item_count += 1
        segments = _speaker_segments(row)
        if segments:
            for speaker, text in segments:
                if speaker:
                    speakers.add(speaker)
                parts.append(f"[{speaker or '?'}] {text}")
            continue

        content = _as_str(row.get("content")).strip()
        if content:
            parts.append(content)

    return "\n".join(parts), sorted(speakers), item_count


def build_summary_input(
    conversation_id: int,
    users_id: int,
    conversation_rows: Sequence[Dict],
    item_rows: Sequence[Dict],
    scene_override: Optional[str] = None,
) -> Dict:
    """
    Build the prompt payload from query_database rows.

    `conversation_rows` should come from conversation.lance.
    `item_rows` should come from conversation_item.lance.
    """
    if not users_id:
        raise ValueError("users_id is required")
    if not conversation_id:
        raise ValueError("conversation_id is required")

    conv = _first_row(conversation_rows)
    if not conv:
        raise ConversationNotFound(
            f"conversation_id={conversation_id} not found for users_id={users_id}"
        )

    conv_id = conv.get("id") or conv.get("conversation_id")
    if not _id_equal(conv_id, conversation_id) or not _id_equal(conv.get("users_id"), users_id):
        raise ConversationNotFound(
            f"conversation_id={conversation_id} not found for users_id={users_id}"
        )

    transcript, speakers, item_count = build_transcript(item_rows)
    if scene_override:
        scene, scene_label, scores = scene_override, scene_override, {}
    else:
        scene, scene_label, scores = classify(transcript)

    date = _as_str(conv.get("date"))
    template = (
        _JSON_OUTPUT_PREFIX + get_template(scene)
    ).replace("{{SCENE}}", scene).replace(
        "{{CONVERSATION_ID}}", str(conversation_id)
    ).replace(
        "{{DATE}}", date
    )

    logger.info(
        "build_summary_input ok: conv=%s, scene=%s, item_count=%s",
        conversation_id,
        scene,
        item_count,
    )

    return {
        "conversation_id": int(conversation_id),
        "users_id": int(users_id),
        "scene": scene,
        "scene_label": scene_label,
        "scene_scores": scores,
        "template": template,
        "content": transcript,
        "date": date,
        "speakers": speakers,
        "item_count": item_count,
        "start_timestamp": conv.get("start_timestamp"),
        "end_timestamp": conv.get("end_timestamp"),
    }


get_summary_input_from_rows = build_summary_input
