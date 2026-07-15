---
name: conversation-summary
description: 【对话总结 skill - 通用】基于 conversation_id + users_id，通过插件工具 query_database 查询 conversation 和 conversation_item 数据，组装对话原文，识别场景，并输出 {title, content, scene, knowledge_graph} JSON。
---

# 对话总结 Skill（conversation-summary）

## 功能

根据用户给出的 `conversation_id` 和 `users_id` 总结一段对话，并抽取个人知识图谱数据。

标准流程：
1. 解析用户指令里的 `conversation_id` 和 `users_id`。
2. 调用 `query_database` 查询 `conversation.lance`，校验该对话属于此 `users_id`，并获取 `date` 等元信息。
3. 调用 `query_database` 查询 `conversation_item.lance`，获取该对话下所有 item 的 `content` 和 `meta_data`。
4. 从查询结果组装 transcript，识别 `scene`。
5. 生成最终 JSON：`title`、`content`、`scene`、`knowledge_graph`。

不再直接读取 LanceDB/TOS，也不要在 skill 里写 AK/SK、endpoint 等密钥配置。数据库查询统一走插件工具 `query_database`。

## 用户隔离

`users_id` 必须由 Agent 从用户提示词里解析后显式使用，不能用默认值。

如果用户没有提供 `users_id`，需要回问用户。不要只用 `conversation_id` 查询。

示例指令：

> 帮我总结 conversation_id = 317946511446016 和 users_id = 286743159152640 的对话内容，并抽取知识图谱数据

## 查询方式

必须调用插件工具 `query_database` 两次。因为调用方已经显式提供了 `users_id`，这里不要额外追加 `claw_id` 条件，所以 `UseClawInstanceFilter` 必须传 `false`。

### 1. 查询 conversation 主表

```json
{
  "DataPath": "tos://xqfz/lance_data/conversation.lance",
  "Filter": "id = 317946511446016 and users_id = '286743159152640' and del_flag = 0",
  "Columns": [
    "id",
    "users_id",
    "date",
    "start_timestamp",
    "end_timestamp"
  ],
  "TopK": 1,
  "UseClawInstanceFilter": false
}
```

要求：
- 如果返回 0 条，说明对话不存在或不属于该用户，直接返回错误说明，不要继续查 item。
- `date` 后续必须写入所有 `evidence.source_ref.date`。
- `conversation_id` 后续必须写入所有 `evidence.source_ref.conversation_id`。

### 2. 查询 conversation_item 子表

```json
{
  "DataPath": "tos://xqfz/lance_data/conversation_item.lance",
  "Filter": "conversation_id = 317946511446016 and users_id = '286743159152640' and del_flag = 0",
  "Columns": [
    "conversation_id",
    "users_id",
    "content",
    "meta_data"
  ],
  "TopK": 100,
  "UseClawInstanceFilter": false
}
```

要求：
- 优先使用工具返回的 `details.rows`。
- 如果只能拿到文本结果，则从 `query_database retrieved ...` 后面的 JSON 数组解析 rows。
- item 顺序按工具返回顺序拼接；第一版不额外排序。
- 如果 `meta_data` 是 JSON 且包含 `speaker_transcriptions`，优先按其中的 `speaker` 和 `text` 组装：
  - `[SPK_xxx] 文本`
- 如果没有 `speaker_transcriptions`，退回使用 row 的 `content`。
- `SPK_xxx` 必须原样保留。

## 场景识别

场景字段 `scene` 只输出以下值之一：
- `work`：职场、会议、项目、研发、招聘、创业、商业、任务、客户、销售等。
- `social`：社交、人脉、朋友、闲聊、兴趣、关系推进等。
- `sales`：销售、客户画像、报价、合同、采购、商机、成交、POC、试点等。
- `other`：无法归入以上场景。

如果多类都命中，优先级建议：`sales` > `work` > `social` > `other`。

## 输出格式

最终回复必须是一个合法 JSON 对象，且只能包含以下四个顶层字段：

```json
{
  "title": "12字以内的对话标题",
  "content": "Markdown 总结正文",
  "scene": "work",
  "knowledge_graph": {
    "nodes": [
      {
        "ref_id": "n1",
        "node_type": "person",
        "node_subtype": "speaker",
        "canonical_name": "SPK_12345",
        "confidence": 0.9
      },
      {
        "ref_id": "n2",
        "node_type": "event",
        "node_subtype": "task",
        "canonical_name": "示例事项",
        "confidence": 0.9
      }
    ],
    "edges": [
      {
        "ref_id": "e1",
        "source_ref": "n1",
        "target_ref": "n2",
        "rel_type": "参与",
        "confidence": 0.86
      }
    ],
    "properties": [
      {
        "owner_type": "node",
        "owner_ref": "n2",
        "prop_name": "当前状态",
        "prop_value": "开发中",
        "value_type": "string",
        "confidence": 0.9
      }
    ],
    "evidence": [
      {
        "target_type": "node",
        "target_ref": "n2",
        "source_type": "summary",
        "source_ref": {
          "conversation_id": "317946511446016",
          "date": "20260526",
          "section": "关键信息",
          "reason": "总结中明确提到该事项"
        }
      }
    ]
  }
}
```

## 总结正文要求

`content` 字段内部使用 Markdown。

### work 场景

```markdown
# 🎧 沟通记录摘要

### 📌 重要工作对话
• 时间：YYYY-MM-DD 或 date
• 参与者：SPK_xxx、SPK_xxx

### 📝 概要
• 一段话说明本次对话核心主题

### 🔑 关键信息
• 关键事实、决定、分歧、结论

### 📊 关键数据
• 数字、时间、数量、报价等；无则写“• 无”

### ✅ 行动项
• 某人 → 做什么；无则写“• 无明确分配的行动项”

### 🧩 待确认
• 信息不全或仍需确认的内容；无则写“• 无”

### ⚠️ 风险与责任提醒
• 风险描述；无则写“• 无”
```

### social 场景

```markdown
## 📌 对话核心要点
• 关键信息
• 细节捕捉
• 重点强调

## 🧠 对话对象画像
• 表达习惯
• 话题偏好
• 性格特点

## 💡 关系推进建议
• 建议一
• 建议二
```

### sales 场景

```markdown
### 【1. 基本画像】
...

### 【2. 话题总结】
...

### 【3. 行动策略】
...

### 【4. 意向打分】
...
```

### other 场景

```markdown
### 📝 概要
• ...

### 🔑 关键信息
• ...

### ✅ 行动项
• ...

### 🧩 待确认
• ...
```

## 知识图谱约束

### 类型与字段

- `node_type` 必须且只能是 `person`、`event`、`item`、`organization` 四类之一。
- `node_subtype` 暂不做强枚举，可用简短英文标签，如 `speaker`、`meeting`、`issue`、`task`、`product`、`company`、`other`。
- 不要输出 `aliases` 字段。
- `ref_id` 只在本次 JSON 内有效，节点用 `n1/n2`，边用 `e1/e2`。
- `rel_type` 必须是简短、事实型中文关系谓词，建议 2-6 个字，如 `参与`、`提及`、`涉及`、`包含`、`负责`、`创建`、`依赖`、`阻塞`、`导致`、`建议跟进`。
- 不要把主观判断硬做成边，例如 `认同`、`喜欢`、`支持`、`影响很大`。状态、特点、建议、评分放入 `properties`。

### 引用完整性硬性规则

- `edges.source_ref` 和 `edges.target_ref` 只能填写已经存在的 `nodes.ref_id`，例如 `n1`、`n2`。禁止填写实体名称、事件名称、人物名、`canonical_name` 或普通文本。
- 如果一条边需要指向“出差”“会议”“设备”等实体，必须先在 `nodes` 中创建对应节点，再在边里引用该节点的 `ref_id`。如果不值得建节点，就把信息写入 `properties`，不要生成这条边。
- `properties.owner_ref` 只能填写已经存在的 `nodes.ref_id` 或 `edges.ref_id`，禁止填写实体名称或属性名。
- `evidence.target_ref` 只能填写已经存在的 `nodes.ref_id` 或 `edges.ref_id`，禁止填写实体名称或普通文本。
- 输出前必须自检：所有 `source_ref`、`target_ref`、`owner_ref`、`evidence.target_ref` 都能在本次 JSON 的 `nodes.ref_id` 或 `edges.ref_id` 中找到；找不到就删除该边/属性/证据，或补齐对应节点。

### 证据来源硬性规则

- 每一个 `nodes` 中的节点都必须至少有一条对应的 `evidence`。
- 通过本次对话总结生成的节点，`evidence.source_type` 必须是 `summary`。
- 当 `evidence.source_type` 为 `summary` 时，`source_ref` 必须包含本次查询得到的真实 `conversation_id` 和 `date`，不要省略、不要改写。
- `source_ref.section` 必须指向 `content` 中对应的章节名，如 `概要`、`关键信息`、`行动项`、`风险与责任提醒`、`对话核心要点`。
- `source_ref.reason` 用一句话说明为什么该节点或边来自这段总结。

### JSON 合法性

- 最终回复必须是严格合法 JSON。
- 如果没有可抽取图谱数据，`nodes`、`edges`、`properties`、`evidence` 返回空数组。

## 可选 Python helper

如果运行环境支持加载本 skill 的 Python 文件，可以使用：

```python
from tools import build_summary_input
from tools import parse_query_database_rows

conversation_rows = parse_query_database_rows(conversation_result)
item_rows = parse_query_database_rows(item_result)
payload = build_summary_input(
    conversation_id=317946511446016,
    users_id=286743159152640,
    conversation_rows=conversation_rows,
    item_rows=item_rows,
)
```

这里的 `conversation_rows` 和 `item_rows` 必须来自 `query_database` 的返回结果。helper 只负责解析 rows、拼接 transcript、识别 scene、生成 prompt，不会直连数据库。

