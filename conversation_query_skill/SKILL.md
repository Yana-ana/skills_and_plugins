# 会议内容查询 Skill（conversation_query）

## 功能

查询音频 ASR 管道产出的会议数据（存储在 LanceDB 中），支持本地和 TOS 远程两种存储模式。

数据结构：
- **conversation** 表：会议级别，含结构化摘要（概要、对话参与人、对话详情、开放式问题）
- **conversation_item** 表：文件级别，每个音频文件 = 1 条 item，`content` 为完整转录文本，`meta_data` 含 `speaker_transcriptions`

## 安全说明

**所有接口均强制 `user_id`**，查询时校验数据归属权，防止跨账号泄露。

`user_id` 默认从环境变量 **`ARKCLAW_ID`** 自动获取，Agent 通常无需显式传递。

## 环境变量配置

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `ARKCLAW_ID` | 是 | 当前用户标识（claw_id） |
| `LANCE_STORAGE_MODE` | 否 | `local`（默认）或 `tos` |
| `LANCE_LOCAL_PATH` | 否 | 本地模式下 Lance 数据目录（默认 `./lance_data`） |
| `LANCE_TOS_PATH` | tos 模式必填 | TOS 路径，如 `tos://xqfz/lance_data/` |
| `LANCE_TOS_ACCESS_KEY` | tos 模式必填 | TOS AK |
| `LANCE_TOS_SECRET_KEY` | tos 模式必填 | TOS SK |
| `LANCE_TOS_ENDPOINT` | tos 模式必填 | S3 兼容 endpoint，如 `https://xqfz.tos-s3-cn-beijing.volces.com` |
| `LANCE_TOS_REGION` | 否 | TOS region（默认 `cn-beijing`） |

## 可用工具

本 Skill 提供以下工具函数，均位于 `skill.conversation_tools` 模块。

所有函数的 `user_id` 参数可选，省略时自动从 `ARKCLAW_ID` 环境变量获取。

---

### 1. `list_conversations(start_ts, end_ts)` — 查询会议列表

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| start_ts | int | 是 | 起始 Unix 时间戳（秒），如当天 00:00:00 的时间戳 |
| end_ts | int | 是 | 结束 Unix 时间戳（秒），如当天 23:59:59 的时间戳 |
| user_id | str | 否 | 默认从 `ARKCLAW_ID` 获取 |

**返回：** `[{id, date, summary_title, start_timestamp, end_timestamp, summary}]`

**适用：** "我今天开了哪些会？""本周有几场会议？"

---

### 2. `get_conversation_summary(conversation_id)` — 获取会议摘要

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| conversation_id | int | 是 | 会议 ID（从 list_conversations 获取） |
| user_id | str | 否 | 默认从 `ARKCLAW_ID` 获取 |

**返回：** `{id, summary_title, summary, date, start_timestamp, end_timestamp}` 或 `None`

**适用：** "会议的主要内容是什么？""讨论了什么？"

---

### 3. `get_conversation_detail(conversation_id)` — 获取会议详情

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| conversation_id | int | 是 | 会议 ID |
| user_id | str | 否 | 默认从 `ARKCLAW_ID` 获取 |

**返回：**
```json
{
  "conversation": {id, summary_title, summary, ...},
  "items": [{entity, content, speaker_transcriptions: [{speaker, start_time, end_time, text, gender?, emotion?}]}],
  "all_speakers": ["SPEAKER_1", "SPEAKER_2"]
}
```

**适用：** "详细对话记录""谁说了什么？"

---

### 4. `search_conversations(keyword)` — 关键词搜索

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| keyword | str | 是 | 搜索关键词 |
| user_id | str | 否 | 默认从 `ARKCLAW_ID` 获取 |

**返回：** `[{id, date, summary_title, start_timestamp, end_timestamp, summary}]`

**适用：** "有没有讨论过预算的会议？""搜一下关于技术方案的会"

---

### 5. `get_participants(conversation_id)` — 获取参与人

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| conversation_id | int | 是 | 会议 ID |
| user_id | str | 否 | 默认从 `ARKCLAW_ID` 获取 |

**返回：** `[{speaker, gender, segment_count, emotions}]`

**适用：** "这个会有几个人参加？""谁发言最多？"

---

### 6. `get_open_issues(start_ts, end_ts)` — 获取待解决问题

**参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| start_ts | int | 是 | 起始 Unix 时间戳（秒） |
| end_ts | int | 是 | 结束 Unix 时间戳（秒） |
| user_id | str | 否 | 默认从 `ARKCLAW_ID` 获取 |

**返回：** `[{id, summary_title, date, open_issues_text}]`

**适用：** "最近会议有哪些待解决的问题？""本周的未决事项"

---

## 查询策略指引

Agent 收到用户问题后：

1. **会议列表/数量** → `list_conversations(start_ts, end_ts)`
2. **会议内容/摘要** → 已知 ID 则 `get_conversation_summary(id)`，否则先 `list_conversations` 定位
3. **详细对话/逐字** → `get_conversation_detail(id)`
4. **按关键词找会** → `search_conversations(keyword)`
5. **参与人** → `get_participants(id)`
6. **待解决问题** → `get_open_issues(start_ts, end_ts)`
7. **"第N个会"** → 引用上一次 `list_conversations` 返回的第 N 条的 `id`

## 时间解析参考

时间参数为 **Unix 时间戳（秒）**，Agent 需将用户自然语言转换为时间戳范围：

| 用户表达 | start_ts | end_ts |
|---------|----------|--------|
| 今天 | 当天 00:00:00 的时间戳 | 当天 23:59:59 的时间戳 |
| 昨天 | 昨天 00:00:00 | 昨天 23:59:59 |
| 本周 | 本周一 00:00:00 | 今天 23:59:59 |
| 最近N天 | N天前 00:00:00 | 今天 23:59:59 |
| 未提及时间 | 默认今天 00:00:00 | 默认今天 23:59:59 |

**示例：** 2026-04-11 的时间范围 → `start_ts=1775836800, end_ts=1775923199`

## 文件结构

```
skill/
├── SKILL.md                 # 本文件 — Agent 阅读的工具说明
├── config.py                # 独立配置（全部从环境变量读取）
├── lance_conn.py            # LanceDB 连接管理（local / TOS）
├── conversation_query.py    # 查询服务层
└── conversation_tools.py    # 工具函数层（Agent 直接调用）
```

本 Skill 为独立可分发包，**不依赖**项目中的其他模块。仅需安装 `lancedb` 和 `pyarrow` 依赖。
