"""
Lance 查询服务：conversation / conversation_item 表查询

所有查询接口均强制要求 user_id，通过 Lance filter 做数据隔离，防止跨账号访问。
通过 lance_conn.get_db() 获取连接，支持 local / TOS 两种模式。
"""

import json
import logging
from typing import Dict, List, Optional

from .lance_conn import get_db
from . import config

logger = logging.getLogger(__name__)


class ConversationQueryService:
    """面向 Skill 的 Lance 查询服务"""

    def __init__(self):
        self.db = get_db()

    def _conv_table(self):
        return self.db.open_table(config.LANCE_CONVERSATION_TABLE)

    def _item_table(self):
        return self.db.open_table(config.LANCE_CONVERSATION_ITEM_TABLE)

    # ---- 内部鉴权方法 ----

    def _get_conversation_if_owned(self, user_id: str, conversation_id: int) -> Optional[dict]:
        """获取会议记录，同时校验 user_id 归属权"""
        try:
            df = (
                self._conv_table().search()
                .where(f"id = {conversation_id} AND user_id = '{user_id}' AND del_flag = 0")
                .select(["id", "summary_title", "summary", "date",
                          "start_timestamp", "end_timestamp"])
                .limit(1)
                .to_pandas()
            )
            if df.empty:
                return None
            row = df.iloc[0]
            return {
                "id": int(row["id"]),
                "summary_title": row.get("summary_title", ""),
                "summary": row.get("summary", ""),
                "date": row.get("date", ""),
                "start_timestamp": int(row.get("start_timestamp", 0)),
                "end_timestamp": int(row.get("end_timestamp", 0)),
            }
        except Exception as e:
            logger.error(f"_get_conversation_if_owned failed: {e}")
            return None

    def _get_items_if_owned(self, user_id: str, conversation_id: int):
        """先校验 conversation 归属权，再查 items"""
        conv = self._get_conversation_if_owned(user_id, conversation_id)
        if conv is None:
            return None, None
        try:
            df = (
                self._item_table().search()
                .where(f"conversation_id = {conversation_id} AND del_flag = 0")
                .to_pandas()
            )
            return conv, df
        except Exception as e:
            logger.error(f"_get_items_if_owned failed: {e}")
            return conv, None

    # ===================== 1. 列表查询 =====================

    def list_by_date(self, user_id: str, start_ts: int, end_ts: int,
                     limit: int = 20) -> List[dict]:
        """
        按时间戳范围查询会议列表，按 start_timestamp 倒序

        Args:
            user_id: 用户ID
            start_ts: 起始 Unix 时间戳（秒），如当天 00:00:00
            end_ts: 结束 Unix 时间戳（秒），如当天 23:59:59
            limit: 返回数量上限
        """
        try:
            df = (
                self._conv_table().search()
                .where(
                    f"user_id = '{user_id}' AND del_flag = 0 "
                    f"AND start_timestamp >= {start_ts} AND start_timestamp <= {end_ts}"
                )
                .select(["id", "date", "summary_title", "start_timestamp",
                          "end_timestamp", "summary"])
                .limit(limit)
                .to_pandas()
            )
            if df.empty:
                return []
            df = df.sort_values("start_timestamp", ascending=False)
            return df.to_dict("records")
        except Exception as e:
            logger.error(f"list_by_date failed: {e}")
            return []

    # ===================== 2. 摘要查询 =====================

    def get_summary(self, user_id: str, conversation_id: int) -> Optional[dict]:
        """获取指定会议摘要（带归属权校验）"""
        return self._get_conversation_if_owned(user_id, conversation_id)

    # ===================== 3. 详情查询 =====================

    def get_detail(self, user_id: str, conversation_id: int) -> dict:
        """获取会议详情：摘要 + speaker_transcriptions（带归属权校验）"""
        result = {"conversation": None, "items": [], "all_speakers": []}

        conv, df = self._get_items_if_owned(user_id, conversation_id)
        result["conversation"] = conv
        if conv is None or df is None or df.empty:
            return result

        speaker_set = set()
        items = []
        for _, row in df.iterrows():
            meta = _parse_meta(row.get("meta_data", "{}"))
            speaker_trans = meta.get("speaker_transcriptions", [])
            for seg in speaker_trans:
                s = seg.get("speaker", "")
                if s:
                    speaker_set.add(s)
            items.append({
                "entity": row.get("entity", ""),
                "content": row.get("content", ""),
                "speaker_transcriptions": speaker_trans,
            })

        result["items"] = items
        result["all_speakers"] = sorted(speaker_set)
        return result

    # ===================== 4. 搜索查询 =====================

    def search_by_keyword(self, user_id: str, keyword: str,
                          limit: int = 10) -> List[dict]:
        """按关键词搜索会议（匹配 summary / summary_title）"""
        try:
            df = (
                self._conv_table().search()
                .where(
                    f"user_id = '{user_id}' AND del_flag = 0 "
                    f"AND (summary LIKE '%{keyword}%' OR summary_title LIKE '%{keyword}%')"
                )
                .select(["id", "date", "summary_title", "start_timestamp",
                          "end_timestamp", "summary"])
                .limit(limit)
                .to_pandas()
            )
            if df.empty:
                return []
            df = df.sort_values("start_timestamp", ascending=False)
            return df.to_dict("records")
        except Exception as e:
            logger.error(f"search_by_keyword failed: {e}")
            return []

    # ===================== 5. 参与人查询 =====================

    def get_participants(self, user_id: str, conversation_id: int) -> List[dict]:
        """提取会议参与人信息（带归属权校验）"""
        conv, df = self._get_items_if_owned(user_id, conversation_id)
        if conv is None or df is None or df.empty:
            return []

        speaker_stats: Dict[str, dict] = {}
        for _, row in df.iterrows():
            meta = _parse_meta(row.get("meta_data", "{}"))
            for seg in meta.get("speaker_transcriptions", []):
                speaker = seg.get("speaker", "UNKNOWN")
                if speaker not in speaker_stats:
                    speaker_stats[speaker] = {
                        "speaker": speaker,
                        "gender": seg.get("gender", ""),
                        "segment_count": 0,
                        "emotions": set(),
                    }
                speaker_stats[speaker]["segment_count"] += 1
                emo = seg.get("emotion", "")
                if emo:
                    speaker_stats[speaker]["emotions"].add(emo)

        result = []
        for s in sorted(speaker_stats.values(), key=lambda x: -x["segment_count"]):
            result.append({
                "speaker": s["speaker"],
                "gender": s["gender"],
                "segment_count": s["segment_count"],
                "emotions": list(s["emotions"]),
            })
        return result

    # ===================== 6. 开放式问题查询 =====================

    def get_open_issues(self, user_id: str, start_ts: int, end_ts: int) -> List[dict]:
        """提取时间范围内所有会议的开放式问题"""
        conversations = self.list_by_date(user_id, start_ts, end_ts, limit=50)
        results = []
        for conv in conversations:
            summary = conv.get("summary", "")
            text = _extract_section(summary, "开放式问题")
            if text and "未识别" not in text:
                results.append({
                    "id": conv["id"],
                    "summary_title": conv.get("summary_title", ""),
                    "date": conv.get("date", ""),
                    "open_issues_text": text,
                })
        return results


# ===================== 工具函数 =====================

def _parse_meta(raw: str) -> dict:
    try:
        return json.loads(raw) if raw else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _extract_section(summary: str, section_name: str) -> str:
    """从结构化摘要中提取指定 section 的内容"""
    if not summary:
        return ""
    markers = [f"## {section_name}", f"**{section_name}**",
               f"# {section_name}", section_name]
    start_pos = -1
    for marker in markers:
        pos = summary.find(marker)
        if pos != -1:
            start_pos = pos + len(marker)
            break
    if start_pos == -1:
        return ""

    remaining = summary[start_pos:].strip()
    next_section = -1
    for prefix in ["## ", "**", "# "]:
        pos = remaining.find(f"\n{prefix}")
        if pos != -1 and (next_section == -1 or pos < next_section):
            next_section = pos

    return remaining[:next_section].strip() if next_section != -1 else remaining.strip()
