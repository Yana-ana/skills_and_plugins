"""
人物档案聚合服务

从 conversation / conversation_item 表中，扫描转录文本里的姓名称谓，
跨会议聚合为人物档案。单会议内尝试把姓名绑定到 speaker（启发式，最大努力）。
"""

import json
import logging
from collections import defaultdict
from typing import Dict, List, Optional

import config
from lance_conn import get_db
from name_extractor import extract_names, normalize_name

logger = logging.getLogger(__name__)


class PersonMemoryService:
    def __init__(self):
        self.db = get_db()

    def _conv_table(self):
        return self.db.open_table(config.LANCE_CONVERSATION_TABLE)

    def _item_table(self):
        return self.db.open_table(config.LANCE_CONVERSATION_ITEM_TABLE)

    # ---------- 内部：按 user_id 扫描所有会议 items ----------

    def _iter_user_items(self, user_id: str, since_ts: Optional[int] = None):
        """
        返回 [(conversation_meta, item_row)] 迭代结构。
        conversation_meta: {id, date, summary_title, start_timestamp, summary}
        item_row: pandas row（含 content, meta_data）
        """
        where = f"user_id = '{user_id}' AND del_flag = 0"
        if since_ts is not None:
            where += f" AND start_timestamp >= {since_ts}"

        conv_df = (
            self._conv_table().search()
            .where(where)
            .select(["id", "date", "summary_title", "start_timestamp",
                      "end_timestamp", "summary"])
            .to_pandas()
        )
        if conv_df.empty:
            return

        conv_ids = conv_df["id"].tolist()
        if not conv_ids:
            return

        ids_str = ",".join(str(i) for i in conv_ids)
        item_df = (
            self._item_table().search()
            .where(f"conversation_id IN ({ids_str}) AND del_flag = 0")
            .to_pandas()
        )

        conv_by_id = {int(row["id"]): row.to_dict() for _, row in conv_df.iterrows()}
        for _, item in item_df.iterrows():
            cid = int(item.get("conversation_id", 0))
            meta = conv_by_id.get(cid)
            if meta:
                yield meta, item

    # ---------- 1. 列出所有人物 ----------

    def list_known_people(self, user_id: str,
                          since_ts: Optional[int] = None,
                          limit: int = 50) -> List[dict]:
        stats: Dict[str, dict] = defaultdict(lambda: {
            "name": "",
            "mention_count": 0,
            "conversation_ids": set(),
            "first_seen_ts": None,
            "last_seen_ts": None,
            "sample_context": "",
        })

        for conv, item in self._iter_user_items(user_id, since_ts):
            text = _text_of_item(item)
            if not text:
                continue
            cid = int(conv["id"])
            ts = int(conv.get("start_timestamp", 0))

            for raw_name in extract_names(text):
                name = normalize_name(raw_name)
                s = stats[name]
                s["name"] = name
                s["mention_count"] += 1
                s["conversation_ids"].add(cid)
                if s["first_seen_ts"] is None or ts < s["first_seen_ts"]:
                    s["first_seen_ts"] = ts
                if s["last_seen_ts"] is None or ts > s["last_seen_ts"]:
                    s["last_seen_ts"] = ts
                if not s["sample_context"]:
                    s["sample_context"] = _snippet_around(text, raw_name)

        # 排序：按 last_seen_ts 倒序
        out = sorted(
            stats.values(),
            key=lambda x: x["last_seen_ts"] or 0,
            reverse=True,
        )[:limit]

        for s in out:
            s["conversation_count"] = len(s["conversation_ids"])
            del s["conversation_ids"]
            # 提示下游 LLM: 这是规则匹配出的姓名候选, 可能有误判 (如"干什"被识别成名字).
            # 下游应基于 sample_context 验证.
            s["extraction_method"] = "rule_based_ner"
            s["confidence_hint"] = ("基于姓+称谓/姓+常见名规则, 可能误判. "
                                     "请用 sample_context 校验; 误判时可调 "
                                     "person-memory.get_person_profile(name) 看更多原文.")
        return out

    # ---------- 2. 获取人物档案 ----------

    def get_person_profile(self, user_id: str, name: str) -> dict:
        target = normalize_name(name)
        profile = {
            "name": target,
            "conversations": [],
            "topics": [],
            "key_facts": [],
            "emotional_tendency": [],
        }

        seen_conv_ids = set()
        topics_set = set()
        facts: List[str] = []
        emotions_set = set()

        for conv, item in self._iter_user_items(user_id):
            text = _text_of_item(item)
            if not text or target not in text:
                continue

            cid = int(conv["id"])
            if cid not in seen_conv_ids:
                seen_conv_ids.add(cid)
                profile["conversations"].append({
                    "id": cid,
                    "date": conv.get("date", ""),
                    "summary_title": conv.get("summary_title", ""),
                    "start_timestamp": int(conv.get("start_timestamp", 0)),
                })
                title = conv.get("summary_title", "")
                if title:
                    topics_set.add(title)

            # 抽取与 target 邻近的关键事实（前后 80 字）
            snippet = _snippet_around(text, target, window=80)
            if snippet and snippet not in facts:
                facts.append(snippet)

            # 情绪（单会议内 speaker_transcriptions）
            meta = _parse_meta(item.get("meta_data", "{}"))
            for seg in meta.get("speaker_transcriptions", []):
                seg_text = seg.get("text", "")
                if target in seg_text:
                    emo = seg.get("emotion", "")
                    if emo:
                        emotions_set.add(emo)

        profile["conversations"].sort(key=lambda c: c["start_timestamp"], reverse=True)
        profile["topics"] = sorted(topics_set)
        profile["key_facts"] = facts[:10]
        profile["emotional_tendency"] = sorted(emotions_set)
        # 给下游 LLM 一份 raw 原料: 该 person 出现的全部句子段
        profile["raw_mentions"] = facts  # 完整列表 (key_facts 是截断版)
        profile["extraction_meta"] = {
            "note": ("key_facts 是规则提取的姓名邻近文本片段 (前后 80 字). "
                     "raw_mentions 是完整列表. 下游 LLM 可基于 raw_mentions 自行抽取人物信息. "
                     "如需该人物相关会议的全文, 调 conversation-query.get_full_transcripts(cid)."),
        }
        return profile

    # ---------- 3. 极简回忆包 ----------

    def recall_person_context(self, user_id: str, name: str) -> dict:
        profile = self.get_person_profile(user_id, name)
        last_conv = profile["conversations"][0] if profile["conversations"] else None
        return {
            "name": profile["name"],
            "last_seen_date": last_conv.get("date", "") if last_conv else "",
            "last_seen_context": last_conv.get("summary_title", "") if last_conv else "",
            "top_3_last_topics": profile["key_facts"][:3],
            "total_meetings": len(profile["conversations"]),
        }

    # ---------- 4. 按话题反查人 ----------

    def find_people_by_topic(self, user_id: str, keyword: str) -> List[dict]:
        name_stats: Dict[str, dict] = defaultdict(lambda: {
            "name": "",
            "conversation_ids": set(),
            "sample_context": "",
        })

        for conv, item in self._iter_user_items(user_id):
            text = _text_of_item(item)
            if not text or keyword not in text:
                continue

            cid = int(conv["id"])
            for raw_name in extract_names(text):
                name = normalize_name(raw_name)
                s = name_stats[name]
                s["name"] = name
                s["conversation_ids"].add(cid)
                if not s["sample_context"]:
                    s["sample_context"] = _snippet_around(text, keyword, window=60)

        out = []
        for s in name_stats.values():
            out.append({
                "name": s["name"],
                "conversation_count": len(s["conversation_ids"]),
                "sample_context": s["sample_context"],
            })
        out.sort(key=lambda x: -x["conversation_count"])
        return out

    # ---------- 5. 两人共同连接 ----------

    def find_common_connections(self, user_id: str,
                                name_a: str, name_b: str) -> dict:
        a = normalize_name(name_a)
        b = normalize_name(name_b)

        shared_convs = []
        shared_topics = set()
        per_conv_snippets: List[str] = []

        for conv, item in self._iter_user_items(user_id):
            text = _text_of_item(item)
            if not text:
                continue
            if a in text and b in text:
                cid = int(conv["id"])
                if not any(c["id"] == cid for c in shared_convs):
                    shared_convs.append({
                        "id": cid,
                        "date": conv.get("date", ""),
                        "summary_title": conv.get("summary_title", ""),
                    })
                    title = conv.get("summary_title", "")
                    if title:
                        shared_topics.add(title)
                snippet = _snippet_around(text, a, window=60)
                if snippet:
                    per_conv_snippets.append(snippet)

        hint = ""
        if shared_convs:
            hint = f"在 {len(shared_convs)} 场会议中同时出现过"
        else:
            hint = "未发现两人在同一场会议共同出现"

        return {
            "shared_conversations": shared_convs,
            "shared_topics": sorted(shared_topics),
            "sample_contexts": per_conv_snippets[:3],
            "hint": hint,
        }


# ===================== 工具函数 =====================

def _text_of_item(item) -> str:
    """从 item 行聚合出完整文本（content + speaker_transcriptions.text）。"""
    parts = []
    content = item.get("content", "") or ""
    if content:
        parts.append(str(content))
    meta = _parse_meta(item.get("meta_data", "{}"))
    for seg in meta.get("speaker_transcriptions", []):
        t = seg.get("text", "")
        if t:
            parts.append(t)
    return "\n".join(parts)


def _parse_meta(raw) -> dict:
    try:
        if isinstance(raw, dict):
            return raw
        return json.loads(raw) if raw else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _snippet_around(text: str, target: str, window: int = 60) -> str:
    pos = text.find(target)
    if pos == -1:
        return ""
    start = max(0, pos - window)
    end = min(len(text), pos + len(target) + window)
    snippet = text[start:end].replace("\n", " ").strip()
    if start > 0:
        snippet = "…" + snippet
    if end < len(text):
        snippet = snippet + "…"
    return snippet
