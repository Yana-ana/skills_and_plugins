"""
会议内容查询 Skill — 独立可分发包

通过环境变量配置，支持 local / TOS 两种 Lance 存储模式。
所有查询接口通过 user_id 做数据隔离。

快速使用：
    from skill.conversation_tools import list_conversations, get_conversation_summary
    conversations = list_conversations("20260409", "20260409")
"""
