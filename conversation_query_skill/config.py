"""
Skill 独立配置：所有配置项均从环境变量读取，便于独立部署分发

必需环境变量：
  ARKCLAW_ID              — 当前用户标识（claw_id）

Lance 存储（二选一）：
  LANCE_STORAGE_MODE      — "local"（默认） 或 "tos"
  LANCE_LOCAL_PATH         — 本地模式下的 Lance 数据目录（默认 ./lance_data）
  LANCE_TOS_PATH           — TOS 模式下的路径（如 tos://xqfz/lance_data/）
  LANCE_TOS_ACCESS_KEY     — TOS AK
  LANCE_TOS_SECRET_KEY     — TOS SK
  LANCE_TOS_ENDPOINT       — TOS S3 兼容 endpoint（如 https://xqfz.tos-s3-cn-beijing.volces.com）
  LANCE_TOS_REGION         — TOS region（如 cn-beijing）

表名：
  LANCE_CONVERSATION_TABLE       — conversation 表名（默认 conversation）
  LANCE_CONVERSATION_ITEM_TABLE  — conversation_item 表名（默认 conversation_item）
"""

import os
from pathlib import Path

# ===================== 用户标识 =====================
ARKCLAW_ID = os.environ.get("ARKCLAW_ID", "")

if not ARKCLAW_ID:
    _openclaw_env = Path.home() / ".openclaw" / ".env"
    if _openclaw_env.exists():
        for _line in _openclaw_env.read_text(errors="ignore").splitlines():
            if _line.startswith("CLAW_INSTANCE_ID="):
                ARKCLAW_ID = _line.split("=", 1)[1].strip().strip('"').strip("'")
                break

# ===================== Lance 存储 =====================
LANCE_STORAGE_MODE = os.environ.get("LANCE_STORAGE_MODE", "local")

# 本地模式
LANCE_LOCAL_PATH = os.environ.get("LANCE_LOCAL_PATH", "./lance_data")

# TOS 远程模式
LANCE_TOS_PATH = os.environ.get("LANCE_TOS_PATH", "")
LANCE_TOS_ACCESS_KEY = os.environ.get("LANCE_TOS_ACCESS_KEY", "")
LANCE_TOS_SECRET_KEY = os.environ.get("LANCE_TOS_SECRET_KEY", "")
LANCE_TOS_ENDPOINT = os.environ.get("LANCE_TOS_ENDPOINT", "")
LANCE_TOS_REGION = os.environ.get("LANCE_TOS_REGION", "cn-beijing")

# ===================== 表名 =====================
LANCE_CONVERSATION_TABLE = os.environ.get("LANCE_CONVERSATION_TABLE", "conversation")
LANCE_CONVERSATION_ITEM_TABLE = os.environ.get("LANCE_CONVERSATION_ITEM_TABLE", "conversation_item")
