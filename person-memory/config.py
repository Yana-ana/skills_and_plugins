"""Skill 独立配置：所有配置项从环境变量读取。与 conversation-query 一致。"""

import os
from pathlib import Path

# 加载 ~/.openclaw/.env (ArkClaw Agent 运行环境的标准配置文件); OS 环境变量优先.
_openclaw_env = Path.home() / ".openclaw" / ".env"
if _openclaw_env.exists():
    for _line in _openclaw_env.read_text(errors="ignore").splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _, _v = _line.partition("=")
        _k = _k.strip()
        _v = _v.strip().strip('"').strip("'")
        if _k and _k not in os.environ:
            os.environ[_k] = _v

# 优先级: os.environ (含 ~/.openclaw/.env) > defaults.py 内置值
try:
    try:
        import defaults as _defaults
    except ImportError:
        from . import defaults as _defaults
except ImportError:
    _defaults = None


def _cfg(key: str, fallback: str = "") -> str:
    v = os.environ.get(key)
    if v:
        return v
    if _defaults is not None:
        v = getattr(_defaults, key, None)
        if v:
            return v
    return fallback


# ===================== 用户标识 =====================
ARKCLAW_ID = os.environ.get("CLAW_INSTANCE_ID") or os.environ.get("ARKCLAW_ID", "")

# ===================== Lance 存储 =====================
LANCE_STORAGE_MODE = _cfg("LANCE_STORAGE_MODE", "local")
LANCE_LOCAL_PATH = _cfg("LANCE_LOCAL_PATH", "./lance_data")
LANCE_TOS_PATH = _cfg("LANCE_TOS_PATH")
LANCE_TOS_ACCESS_KEY = _cfg("LANCE_TOS_ACCESS_KEY")
LANCE_TOS_SECRET_KEY = _cfg("LANCE_TOS_SECRET_KEY")
LANCE_TOS_ENDPOINT = _cfg("LANCE_TOS_ENDPOINT")
LANCE_TOS_REGION = _cfg("LANCE_TOS_REGION", "cn-beijing")

# ===================== 表名 =====================
LANCE_CONVERSATION_TABLE = os.environ.get("LANCE_CONVERSATION_TABLE", "conversation")
LANCE_CONVERSATION_ITEM_TABLE = os.environ.get("LANCE_CONVERSATION_ITEM_TABLE", "conversation_item")
