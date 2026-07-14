"""
Conversation summary skill.

Data access is handled by the plugin tool `query_database`. Local helpers only
parse query rows and assemble prompt payloads.
"""

from .tools import (
    build_summary_input,
    build_transcript,
    get_summary_input_from_rows,
    parse_query_database_rows,
)

__all__ = [
    "build_summary_input",
    "build_transcript",
    "get_summary_input_from_rows",
    "parse_query_database_rows",
]
