"""
会议查询工具函数：供 Agent 直接调用的 tool 层

所有函数的 user_id 默认从环境变量 ARKCLAW_ID 获取，也可显式传入。
每个函数 = 一个 tool，返回结构化数据，Agent 自行组织回答。
"""

import logging
from typing import List, Optional

from . import config
from .conversation_query import ConversationQueryService

logger = logging.getLogger(__name__)

_service = ConversationQueryService()


def _resolve_user_id(user_id: Optional[str] = None) -> str:
    """解析 user_id：显式传入 → 环境变量 ARKCLAW_ID → ~/.openclaw/.env 的 CLAW_INSTANCE_ID → 报错"""
    uid = user_id or config.ARKCLAW_ID
    if not uid:
        raise ValueError(
            "user_id is required: pass it explicitly, set ARKCLAW_ID env var, "
            "or configure CLAW_INSTANCE_ID in ~/.openclaw/.env"
        )
    return uid


def list_conversations(start_ts: int, end_ts: int,
                       user_id: Optional[str] = None) -> List[dict]:
    """
    查询会议列表

    Args:
        start_ts: 起始 Unix 时间戳（秒），如当天 00:00:00 的时间戳
        end_ts:   结束 Unix 时间戳（秒），如当天 23:59:59 的时间戳
        user_id:  用户标识，默认从 ARKCLAW_ID 环境变量获取

    Returns:
        会议列表，按时间倒序。每项含 id, date, summary_title,
        start_timestamp, end_timestamp, summary
    """
    uid = _resolve_user_id(user_id)
    return _service.list_by_date(uid, start_ts, end_ts)


def get_conversation_summary(conversation_id: int,
                             user_id: Optional[str] = None) -> Optional[dict]:
    """
    获取指定会议的完整结构化摘要

    Args:
        conversation_id: 会议 ID（从 list_conversations 结果获取）
        user_id:         默认从 ARKCLAW_ID 环境变量获取
    """
    uid = _resolve_user_id(user_id)
    return _service.get_summary(uid, conversation_id)


def get_conversation_detail(conversation_id: int,
                            user_id: Optional[str] = None) -> dict:
    """
    获取会议详情：摘要 + speaker_transcriptions

    Args:
        conversation_id: 会议 ID
        user_id:         默认从 ARKCLAW_ID 环境变量获取
    """
    uid = _resolve_user_id(user_id)
    return _service.get_detail(uid, conversation_id)


def search_conversations(keyword: str,
                         user_id: Optional[str] = None) -> List[dict]:
    """
    按关键词搜索会议

    Args:
        keyword: 搜索关键词
        user_id: 默认从 ARKCLAW_ID 环境变量获取
    """
    uid = _resolve_user_id(user_id)
    return _service.search_by_keyword(uid, keyword)


def get_participants(conversation_id: int,
                     user_id: Optional[str] = None) -> List[dict]:
    """
    获取会议参与人信息

    Args:
        conversation_id: 会议 ID
        user_id:         默认从 ARKCLAW_ID 环境变量获取
    """
    uid = _resolve_user_id(user_id)
    return _service.get_participants(uid, conversation_id)


def get_open_issues(start_ts: int, end_ts: int,
                    user_id: Optional[str] = None) -> List[dict]:
    """
    获取时间范围内会议的开放式问题

    Args:
        start_ts: 起始 Unix 时间戳（秒）
        end_ts:   结束 Unix 时间戳（秒）
        user_id:  默认从 ARKCLAW_ID 环境变量获取
    """
    uid = _resolve_user_id(user_id)
    return _service.get_open_issues(uid, start_ts, end_ts)
