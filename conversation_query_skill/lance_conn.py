"""
LanceDB 连接管理：根据配置创建 local 或 TOS（S3）连接

单例模式，整个 Skill 生命周期共享一个连接实例。
"""

import logging
from typing import Optional

import lancedb

from . import config

logger = logging.getLogger(__name__)

_db_instance: Optional[lancedb.DBConnection] = None


def get_db() -> lancedb.DBConnection:
    """获取 LanceDB 连接（单例）"""
    global _db_instance
    if _db_instance is None:
        _db_instance = _create_connection()
    return _db_instance


def _create_connection() -> lancedb.DBConnection:
    """
    根据 LANCE_STORAGE_MODE 创建连接

    - local: lancedb.connect("./lance_data")
    - tos:   lancedb.connect("s3://...", storage_options={aksk...})
    """
    mode = config.LANCE_STORAGE_MODE

    if mode == "tos":
        if not config.LANCE_TOS_PATH:
            raise ValueError("LANCE_TOS_PATH is required when LANCE_STORAGE_MODE=tos")

        # tos:// → s3://
        uri = config.LANCE_TOS_PATH.replace("tos://", "s3://", 1)
        storage_options = {
            "access_key_id": config.LANCE_TOS_ACCESS_KEY,
            "secret_access_key": config.LANCE_TOS_SECRET_KEY,
            "aws_endpoint": config.LANCE_TOS_ENDPOINT,
            "aws_region": config.LANCE_TOS_REGION,
            "virtual_hosted_style_request": "true",
        }
        logger.info(f"Connecting LanceDB via TOS: {uri}")
        return lancedb.connect(uri, storage_options=storage_options)
    else:
        logger.info(f"Connecting LanceDB locally: {config.LANCE_LOCAL_PATH}")
        return lancedb.connect(config.LANCE_LOCAL_PATH)
