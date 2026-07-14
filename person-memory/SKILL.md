---
name: person-memory
description: 跨会议聚合人物档案。通过扫描会议转录文本里出现的姓名称谓（如"李总""张经理""王老师"），结合单场会议内的 speaker ID，构建"你见过的人"画像。适用于：电梯/走廊偶遇想不起对方是谁、行业峰会后回忆某人说过什么、查询某个话题涉及过哪些人、发现两个人之间的共同连接。提供 list_known_people、get_person_profile、recall_person_context、find_people_by_topic、find_common_connections 五个工具函数。所有查询按 user_id 鉴权，默认从 ARKCLAW_ID 环境变量获取。依赖同一 LanceDB 数据源（local 或 TOS）。
---

# 人物记忆 Skill（person-memory）

## 功能

从用户历史会议记录中，抽取并聚合"人物档案"——即用户见过的人，对方说过什么、关心什么、和用户有过哪些交集。

### 核心挑战与策略

LanceDB 中的 `SPEAKER_X` 标签**只在单场会议内部有效**，跨会议无法匹配（SPEAKER_1 在会议 A 和会议 B 不一定是同一个人）。本 skill 采用**混合主键策略**：

- **Name-keyword 层（跨会议主键）：** 扫描会议转录中出现的姓名称谓（"李总"、"张经理"、"王老师"、"赵工"、常见中文姓名等），同一姓名在不同会议中聚合为同一人物档案。
- **Speaker 层（单会议绑定）：** 会议内部尽量把姓名关键字绑定到 `SPEAKER_X`（启发式：被第三方直接称呼时，紧随其后的发言者大概率就是此人）。绑定不确定时保留"该会议出现过此姓名"作为弱关联。

> 注意：同名人物（如都叫"李总"但是两家公司的不同人）暂不区分，会被合并。Agent 在回答时应提示用户"以上信息来自 N 场会议，可能涉及多位'李总'"。

## 安全说明

所有接口均强制 `user_id`，默认从环境变量 `ARKCLAW_ID` 获取。跨账号数据隔离。

## 环境变量配置

与 `conversation-query` skill 完全一致（共用 LanceDB 数据源）：

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `ARKCLAW_ID` | 是 | 当前用户标识 |
| `LANCE_STORAGE_MODE` | 否 | `local`（默认）或 `tos` |
| `LANCE_LOCAL_PATH` | 否 | 本地模式路径（默认 `./lance_data`） |
| `LANCE_TOS_PATH` / `LANCE_TOS_ACCESS_KEY` / `LANCE_TOS_SECRET_KEY` / `LANCE_TOS_ENDPOINT` / `LANCE_TOS_REGION` | tos 模式必填 | TOS 访问参数 |

## 可用工具

工具函数位于 `person_tools` 模块。所有函数的 `user_id` 参数可选，省略时从 `ARKCLAW_ID` 取。

### 1. `list_known_people(since_ts=None, limit=50)` — 列出认识的人

**参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| since_ts | int | 否 | 只统计此时间戳之后的会议；省略则全量 |
| limit | int | 否 | 最多返回 N 个人，默认 50 |
| user_id | str | 否 | 默认从 `ARKCLAW_ID` 获取 |

**返回：** `[{name, mention_count, conversation_count, first_seen_ts, last_seen_ts, sample_context}]`，按最近提及时间倒序。

**适用：** "我最近都认识了哪些人？""这个月见过多少个新联系人？"

### 2. `get_person_profile(name)` — 某人的完整档案

**参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | str | 是 | 姓名或称谓（如"李总""张三"） |
| user_id | str | 否 | 默认从 `ARKCLAW_ID` 获取 |

**返回：**
```json
{
  "name": "李总",
  "conversations": [{"id", "date", "summary_title"}],
  "topics": ["数据中台", "预算审批"],
  "key_facts": ["提到女儿在人大附中", "公司正在做数据中台选型，预算 500 万"],
  "emotional_tendency": ["positive", "engaged"]
}
```

**适用：** "关于李总我们都聊过什么？""上次张三跟我提过什么？"

### 3. `recall_person_context(name)` — 极简回忆包（电梯偶遇场景）

**参数：** 同 `get_person_profile`。

**返回：** 极简数据包，专供"突然遇到熟悉的陌生人"这一高延迟敏感场景：
```json
{
  "name": "李明",
  "last_seen_date": "2026-01-15",
  "last_seen_context": "在张总的私宴上同桌",
  "role_hint": "XX 科技 CTO",
  "top_3_last_topics": ["数据中台选型", "预算 500 万", "女儿考上人大附中"]
}
```

**适用：** "这人是谁来着？""我上次跟他聊了什么？"——对话开场白的实时辅助。

### 4. `find_people_by_topic(keyword)` — 反向查询

**参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| keyword | str | 是 | 话题关键词 |
| user_id | str | 否 | 默认从 `ARKCLAW_ID` 获取 |

**返回：** `[{name, conversation_count, sample_context}]`

**适用：** "谁跟我聊过数据中台？""关于融资估值问题，我都和谁讨论过？"

### 5. `find_common_connections(name_a, name_b)` — 两人的共同点

**参数：**
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name_a | str | 是 | 人物 A |
| name_b | str | 是 | 人物 B |
| user_id | str | 否 | 默认从 `ARKCLAW_ID` 获取 |

**返回：** `{shared_conversations, shared_topics, hint}`

**适用：** "赵总和王总有什么交集？""能不能请某人给我引荐？"

## 查询策略指引

Agent 根据用户提问选择工具：

| 用户提问 | 推荐工具 |
|---------|---------|
| "最近认识了谁？" | `list_known_people(since_ts=N天前)` |
| "某某是谁？/ 我跟他聊过什么？" | `get_person_profile(name)` |
| （实时）"这人突然出现在面前，快速回忆" | `recall_person_context(name)` |
| "谁跟我讨论过 X？" | `find_people_by_topic(keyword)` |
| "A 和 B 有交集吗？" | `find_common_connections(a, b)` |

## 文件结构

```
person-memory/
├── SKILL.md               # 本文件
├── __init__.py
├── config.py              # 环境变量配置（与 conversation-query 一致）
├── lance_conn.py          # LanceDB 连接管理
├── name_extractor.py      # 中文姓名/称谓提取
├── person_memory.py       # 人物档案聚合服务
└── person_tools.py        # Agent 工具层
```

## 已知限制

- 同名合并：如多个"李总"会被合并，Agent 在输出时应标注信息来自 N 场会议。
- 姓名提取基于正则 + 词典，对特殊称呼（英文名、外号）覆盖有限。
- 跨会议声纹识别未实现，未来可扩展。
