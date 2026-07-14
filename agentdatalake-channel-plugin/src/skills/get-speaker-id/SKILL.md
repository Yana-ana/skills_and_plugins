---
name: get-speaker-id
description: 根据人名（中文名/英文名/昵称/称呼）获取对应的 speaker_id。通过调用 query_database 工具检索 name_pinyin，并处理“王总”“老李”“建国”等中文称呼习惯，自动判断使用精确匹配或 SQL LIKE 模糊匹配。当用户需要查找某人的 speaker_id、声纹 ID，或将人名解析为系统标识时使用本 skill。
---

# 获取 speaker_id

此 Skill 用于根据用户提到的人名查询对应的 `speaker_id`。

## 数据源

调用 `query_database` 工具，且只传以下三个参数：

- `DataPath`: `tos://xqfz/lance_data/profile.lance`
- `Columns`: `["name", "speaker_id"]`
- `Filter`: 按下方规则生成

表结构：

- `name`：中文名或英文名
- `name_pinyin`：姓名拼音或英文名归一化字段；中文拼音按音节用空格分隔，例如 `zhang jian guo`
- `speaker_id`

## 人名归一化

用户可能使用中文名、英文名、昵称或口语化称呼。生成查询条件前先做归一化：

- 去掉称呼后缀：`总`、`老师`、`同学`、`哥`、`姐`、`主管`、`经理` 等。
- 处理前缀称呼：`老张`、`小王`、`大刘` 这类称呼去掉 `老`、`小`、`大`，保留核心姓名部分。
- 如果用户只说中文名的后两个字，例如 `建国`，按这两个字转成带空格的拼音后使用模糊匹配，例如 `jian guo`。
- 如果用户给的是完整中文姓名，转换成小写、无声调、按音节空格分隔的拼音，例如 `张建国` -> `zhang jian guo`。
- 如果用户给的是英文名，使用小写英文作为检索词；英文名本身包含空格时保留空格，例如 `Alex Chen` -> `alex chen`。

## Filter 生成规则

根据归一化后的信息选择精确匹配或模糊匹配。

### 完整姓名

如果用户给出的是明确完整姓名，优先使用等值匹配：

```sql
name_pinyin = 'zhang jian guo'
```

英文名也按同样方式优先精确匹配：

```sql
name_pinyin = 'alex'
```

### 部分姓名或口语称呼

如果用户给出的不是完整姓名，或者是后两个字、单字姓氏、`某某总`、`老某` 这类口语称呼，使用 `like` 模糊匹配：

```sql
name_pinyin like '%jian guo%'
```

```sql
name_pinyin like '%zhang%'
```

判断原则：

- `张建国`、`Alex Chen` 这种完整姓名：优先 `=`
- `建国`、`张总`、`老张`、`小王`、`Alex` 但不确定是否完整：优先 `like '%xxx%'`
- 用户明确要求“姓张的”“叫建国的”：使用 `like '%xxx%'`

## 调用示例

```json
{
  "DataPath": "tos://xqfz/lance_data/profile.lance",
  "Filter": "name_pinyin like '%jian guo%'",
  "Columns": ["name", "speaker_id"]
}
```

## 结果处理

- 如果 `query_database` 返回空结果，直接告诉用户没有这个人，不要继续猜测。
- 如果只返回一条结果，直接给出中文人名和 `speaker_id`。
- 如果返回多条结果，说明可能是同音字或称呼不够精确，需要把候选人的中文名列给用户，并请用户确认要找哪一个；在用户确认前不要替用户选。
- 用户确认后，再返回该人的 `speaker_id`。

## 输出方式

面向用户时保持简洁：

- 找到唯一结果：`张建国的 speaker_id 是 xxx。`
- 多个候选：`查到多个同音/相近姓名：张建国、章建国。你要找哪一位？`
- 没有结果：`没有查到这个人。`
