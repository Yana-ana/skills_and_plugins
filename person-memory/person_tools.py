"""
人物记忆工具函数：Agent 直接调用的 tool 层。

所有函数 user_id 可选，省略时从 ARKCLAW_ID 环境变量读取。
"""

import logging
from typing import List, Optional

import config
from person_memory import PersonMemoryService

logger = logging.getLogger(__name__)

_service = PersonMemoryService()


def _resolve_user_id(user_id: Optional[str] = None) -> str:
    uid = user_id or config.ARKCLAW_ID
    if not uid:
        raise ValueError(
            "user_id is required: pass it explicitly, set ARKCLAW_ID env var, "
            "or configure CLAW_INSTANCE_ID in ~/.openclaw/.env"
        )
    return uid


def list_known_people(since_ts: Optional[int] = None,
                      limit: int = 50,
                      user_id: Optional[str] = None) -> List[dict]:
    """列出用户历史会议中出现过的人物（按最近提及倒序）。"""
    return _service.list_known_people(_resolve_user_id(user_id), since_ts, limit)


def get_person_profile(name: str,
                       user_id: Optional[str] = None) -> dict:
    """获取指定人物的完整档案（所有相关会议、话题、关键事实、情绪）。"""
    return _service.get_person_profile(_resolve_user_id(user_id), name)


def recall_person_context(name: str,
                          user_id: Optional[str] = None) -> dict:
    """极简回忆包：电梯偶遇/突然碰面场景的低延迟数据。"""
    return _service.recall_person_context(_resolve_user_id(user_id), name)


def find_people_by_topic(keyword: str,
                         user_id: Optional[str] = None) -> List[dict]:
    """反向查询：某话题涉及过哪些人。"""
    return _service.find_people_by_topic(_resolve_user_id(user_id), keyword)


def find_common_connections(name_a: str, name_b: str,
                            user_id: Optional[str] = None) -> dict:
    """两人共同出现过的会议 / 话题 / 上下文。"""
    return _service.find_common_connections(_resolve_user_id(user_id),
                                             name_a, name_b)
