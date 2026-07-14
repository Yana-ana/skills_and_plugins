---
name: query-speaker-content
description: 根据内容主题检索说话内容记录，并可选按 speaker_id、gender、emotion 过滤。用户想查询某个 speaker 说过什么、某种性别或情绪下是否提到某个主题、查找与某段内容全文匹配或语义相似的历史记录时使用本 skill。重要：如果用户请求里出现人名、中文名、英文名、昵称或称呼，例如“张三”“王总”“老李”“Alex”，并且需要限定到这个人，必须先使用 `get-speaker-id` skill 获取 speaker_id，再使用本 skill；不要直接用人名查询内容库，也不要把人名当成 speaker_id。
---

# 查询 speaker 内容

此 Skill 用于调用 `query_database` 查询内容记录，并可选按 `speaker_id`、`gender`、`emotion` 缩小范围。

## 适用场景

当用户想基于某段文本、主题或语义描述检索内容记录时，使用本 Skill。用户可以额外提供 `speaker_id`、`gender` 或 `emotion` 作为过滤条件。

典型场景：

- 查询某个 `speaker_id` 的人说过什么。
- 查询男性或女性说话人是否提到某个主题。
- 查询某种情绪下是否出现某个内容。
- 查询与某句话语义相似的历史内容。
- 查询内容库中的全文检索结果。

## 人名前置解析规则

如果用户请求里出现人名、中文名、英文名、昵称或称呼，并且语义上是在查这个人说过什么或是否提到某个内容，先使用 `get-speaker-id` skill 获取 `speaker_id`，再继续使用本 Skill 查询内容库。

常见需要先解析人名的输入：

- `查一下张三有没有说过火锅`
- `王总最近有没有提到项目延期`
- `老李开心的时候说过什么`
- `Alex 有没有说过 I love watermelon`

处理顺序：

1. 先用 `get-speaker-id` skill 把人名、昵称或称呼解析成 `speaker_id`。
2. 如果 `get-speaker-id` skill 返回多个候选，先让用户确认具体是哪一个人，不要继续查内容库。
3. 如果 `get-speaker-id` skill 没有查到结果，直接告诉用户没有查到这个人，不要继续查内容库。
4. 如果得到唯一 `speaker_id`，再调用 `query_database`，并把 `speaker_id = '实际 speaker_id'` 加入 `Filter`。

不要直接用人名查询 `speech.lance`，不要把人名填进 `speaker_id`，也不要把人名当作 `Query` 的主要检索内容。`Query` 只放用户真正想检索的主题或内容。

## 数据源

调用 `query_database` 工具。

内容数据集固定为：

- `DataPath`: `tos://xqfz/lance_data/speech.lance`

推荐返回列：

- `content`
- `created_at`
- `speaker_id`
- `gender`
- `emotion`

如果用户需要更多字段，可以在 `Columns` 中加入对应列。

## 固定参数规则

每次调用 `query_database` 时，必须按以下规则填写参数：

- `DataPath`: 固定填 `tos://xqfz/lance_data/speech.lance`。
- `Query`: 填用户想通过全文检索和向量检索查找的内容。
- `FtsColumn`: 固定填 `content`。
- `VectorColumn`: 固定填 `embedding`。
- `Filter`: 按用户提供的信息可选包含 `speaker_id`、`gender`、`emotion` 等条件。
- `Columns`: 默认使用 `["content", "created_at", "speaker_id", "gender", "emotion"]`。

不要把 `speaker_id`、`gender`、`emotion` 填到 `Query` 中。这些字段只用于 `Filter`。

## Query 生成规则

`Query` 填用户真正想检索的文本内容、主题或语义描述。

示例：

用户说：

```text
查一下 speaker_id 是 spk-123 的人有没有说过火锅
```

则 `Query` 应为：

```text
火锅
```

用户说：

```text
查 speaker_id 为 spk-123 的人关于项目延期的记录
```

则 `Query` 应为：

```text
项目延期
```

用户说：

```text
看看 spk-123 有没有提到“我爱吃西瓜”
```

则 `Query` 应为：

```text
我爱吃西瓜
```

用户说：

```text
查一下张三有没有说过火锅
```

先使用 `get-speaker-id` skill 查询 `张三`。假设返回唯一结果 `speaker_id = spk-123`，则本 Skill 的 `Query` 应为：

```text
火锅
```

## 检索列规则

每次调用都固定传：

```json
{
  "FtsColumn": "content",
  "VectorColumn": "embedding"
}
```

除非用户明确说明数据表字段不同，否则不要改成其他列。

## 可选 Filter 规则

`Filter` 根据用户提供的限定条件生成；没有限定条件时可以不传 `Filter`。

单个 `speaker_id`：

```sql
speaker_id = 'spk-123'
```

多个 `speaker_id`：

```sql
speaker_id in ('spk-123', 'spk-456')
```

`gender` 可选值只有 `female` 和 `male`：

```sql
gender = 'female'
```

```sql
gender = 'male'
```

`emotion` 可选值有 `neutral`、`surprise`、`happy`等：

```sql
emotion = 'happy'
```

```sql
emotion in ('neutral', 'surprise')
```

`created_at` 是 Unix 秒级时间戳，使用数字比较，不要加单引号。用户通常会说“今天”“昨天”“5 月之后”“5 月 7 日”“最近一周”等自然语言时间，先把这些时间转换成 Unix 秒级时间戳，再写入 `Filter`。

时间转换规则：

- 用户说“某天”，转换成当天起始时间到次日起始时间的半开区间：`created_at >= 当天0点时间戳 and created_at < 次日0点时间戳`。
- 用户说“某月”，转换成该月起始时间到下月起始时间的半开区间。
- 用户说“某时间之后”，转换成 `created_at >= 起始时间戳`。
- 用户说“某时间之前”，转换成 `created_at < 结束时间戳`。
- 用户说“最近 N 天/周/月”，以当前时间为基准换算起始时间戳。
- 如果用户没有说明年份，默认使用当前年份；如果这样会产生明显不符合语境的未来时间，再结合上下文选择最近的合理年份。
- 如果用户明确指定时区，按用户指定时区转换；否则按 OpenClaw 当前运行环境的本地时区转换。

示例：

```sql
created_at >= 1778124084
```

```sql
created_at >= 1778124084 and created_at < 1780716084
```

如果用户提供多个过滤条件，用 `and` 拼接：

```sql
speaker_id = 'spk-123' and gender = 'female' and emotion = 'happy'
```

如果用户还提供时间等其他过滤条件，继续用 `and` 拼接：

```sql
speaker_id = 'spk-123' and emotion = 'neutral' and created_at >= 1778124084 and created_at < 1780716084
```

所有字符串值都必须用单引号包裹。数值字段例如 `created_at` 不加单引号。字符串值里如果包含单引号，需要转义为两个单引号，例如：

```sql
speaker_id = 'abc''def'
```

## 调用示例

用户输入：

```text
查一下 speaker_id 是 spk-123 的人有没有说过火锅
```

调用 `query_database`：

```json
{
  "DataPath": "tos://xqfz/lance_data/speech.lance",
  "Query": "火锅",
  "FtsColumn": "content",
  "VectorColumn": "embedding",
  "Filter": "speaker_id = 'spk-123'",
  "Columns": ["content", "created_at", "speaker_id", "gender", "emotion"]
}
```

用户输入：

```text
查 speaker_id 为 spk-123 的人关于项目延期的记录，只看 5 条
```

调用 `query_database`：

```json
{
  "DataPath": "tos://xqfz/lance_data/speech.lance",
  "Query": "项目延期",
  "FtsColumn": "content",
  "VectorColumn": "embedding",
  "Filter": "speaker_id = 'spk-123'",
  "Columns": ["content", "created_at", "speaker_id", "gender", "emotion"],
  "TopK": 5
}
```

用户输入：

```text
查 speaker_id 是 spk-123 的人 5 月之后有没有提到西瓜
```

调用 `query_database`：

```json
{
  "DataPath": "tos://xqfz/lance_data/speech.lance",
  "Query": "西瓜",
  "FtsColumn": "content",
  "VectorColumn": "embedding",
  "Filter": "speaker_id = 'spk-123' and created_at >= 1778124084",
  "Columns": ["content", "created_at", "speaker_id", "gender", "emotion"]
}
```

用户输入：

```text
查一下女性说话人有没有开心地提到火锅
```

调用 `query_database`：

```json
{
  "DataPath": "tos://xqfz/lance_data/speech.lance",
  "Query": "火锅",
  "FtsColumn": "content",
  "VectorColumn": "embedding",
  "Filter": "gender = 'female' and emotion = 'happy'",
  "Columns": ["content", "created_at", "speaker_id", "gender", "emotion"]
}
```

## 结果处理

- 如果 `query_database` 返回空结果，告诉用户没有查到符合条件的相关内容。
- 如果返回一条或多条结果，简洁展示命中的内容，优先包含时间和内容。
- 如果结果很多，只展示最相关的几条；不要一次性输出过长内容。
- 如果 `query_database` 返回错误，不要说“没有查到”，应说明查询失败并展示简要错误信息。

## 输出方式

面向用户时保持简洁。

找到结果：

```text
查到 2 条相关内容：
1. 2026-05-07：老王答应我周五去吃火锅，我觉得可以...
2. 2026-05-08：这个项目延期风险比较高...
```

没有结果：

```text
没有查到符合条件的“火锅”相关内容。
```

查询失败：

```text
查询失败：DataPath is invalid。
```
