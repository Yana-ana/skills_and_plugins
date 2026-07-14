"""
中文姓名/称谓提取

策略：
1. 称谓模式：<姓>+<后缀>，后缀词典覆盖"总/经理/老师/工/律师/会计/医生/主任/..."
2. 英文名后加中文职称："Mike 总"
3. 完整中文姓名（2-3 字）基于常见姓氏词典

输出 normalize 后的 name 作为跨会议主键。
"""

import re
from typing import List, Set

# 中文姓氏（常见 100+）
COMMON_SURNAMES = set(
    "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜"
    "戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史"
    "唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟"
    "平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项"
    "祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田"
    "樊胡凌霍虞万支柯咎管卢莫房缪干解应宗丁宣贲邓郁单杭洪包诸左石崔"
    "吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴糜松井段富巫"
)

# 职位/敬称后缀
TITLE_SUFFIXES = [
    # 长后缀优先（避免"总经理"被截成"总"）
    "总经理", "副总经理", "副总裁", "总裁", "董事长", "董事",
    "主任", "老师", "教授", "律师", "会计", "医生", "工程师",
    "经理", "总监", "总", "老板", "校长", "院长", "处长", "科长",
    "部长", "局长", "秘书", "助理", "工",
]

_TITLE_SUFFIXES_SORTED = sorted(TITLE_SUFFIXES, key=len, reverse=True)
_SUFFIX_PATTERN = "|".join(re.escape(s) for s in _TITLE_SUFFIXES_SORTED)

# 姓 + 称谓："李总" "张经理" "王律师"
SURNAME_TITLE_RE = re.compile(rf"([{''.join(COMMON_SURNAMES)}])({_SUFFIX_PATTERN})")

# 英文名 + 中文称谓："Mike 总" "David 经理"
ENGLISH_TITLE_RE = re.compile(rf"([A-Z][a-z]{{1,15}})\s*({_SUFFIX_PATTERN})")

# 完整中文姓名（2-3 字）
FULL_NAME_RE = re.compile(rf"([{''.join(COMMON_SURNAMES)}])([\u4e00-\u9fa5]{{1,2}})")

# 排除词 (高频误匹配)
# 来源:
#   - "李总": 注释保留, 实际是合法姓名后缀, 不应排除... 这里不排
#   - 副词/疑问词被误匹配为姓+名 (如"干什"被识别成姓"干"+ 名"什")
EXCLUDE_NAMES = {
    "总算", "总之", "总是", "总共", "总结", "总的",  # "总"单字误判
    # 副词 / 疑问词 (FULL_NAME_RE 用 [姓][\u4e00-\u9fa5]{1,2} 匹配, 容易把动词当姓)
    "干什", "干嘛", "干啥", "干吗",
    "为什", "为啥", "怎么", "什么",
    "应该", "可能", "知道", "认为", "感觉", "觉得", "因为", "所以", "而是",
    "于是", "如果", "已经", "还是", "或者", "其实", "也许", "肯定", "一直",
    "现在", "今天", "明天", "昨天", "刚才", "刚刚", "马上", "立刻",
}

# 排除整个 token 的前置/后置规则 (FULL_NAME_RE 命中后再过滤)
# 当姓后第一个字是常见动词/虚词/疑问词字时, 整体丢弃.
# 取舍: 这些字也可能出现在合法人名里, 但在中文转录文本里出现在"姓+尾"位置时,
# 误判为人名的概率远高于真名. 宁可漏召回少数边缘人名, 也不让 LLM 看到大量噪音.
EXCLUDE_NAME_SECOND_CHAR = set(
    "的了呢吧吗呀啊呵哈嗯哦"        # 语气虚词
    "在能要会有过着且就也都"        # 常见副词/助动词
    "是非"                          # 判断
    "什么么了哪些"                  # 疑问/复数
    "想说看来去到走"                # 常见动词字
)


def extract_names(text: str) -> List[str]:
    """
    从一段文本中提取所有可能的姓名称谓。

    返回：去重后的 list，保留原始大小写。
    """
    if not text:
        return []

    found: Set[str] = set()

    # 1) 姓 + 称谓
    for m in SURNAME_TITLE_RE.finditer(text):
        name = m.group(0)
        if name not in EXCLUDE_NAMES:
            found.add(name)

    # 2) 英文名 + 称谓
    for m in ENGLISH_TITLE_RE.finditer(text):
        name = f"{m.group(1)}{m.group(2)}"
        found.add(name)

    # 3) 完整中文姓名（要求紧邻非汉字边界，降低误识别）
    for m in FULL_NAME_RE.finditer(text):
        full = m.group(0)
        if full in EXCLUDE_NAMES:
            continue
        if len(full) >= 2 and full[1] in EXCLUDE_NAME_SECOND_CHAR:
            continue
        # 前后必须是非汉字（标点/空格/行首行尾）
        start, end = m.span()
        prev_ok = (start == 0) or not _is_han(text[start - 1])
        next_ok = (end == len(text)) or not _is_han(text[end])
        if prev_ok and next_ok and len(full) >= 2:
            found.add(full)

    return sorted(found)


def _is_han(ch: str) -> bool:
    return "\u4e00" <= ch <= "\u9fa5"


def normalize_name(name: str) -> str:
    """name 主键规范化：去空白，保留大小写（英文名敏感）。"""
    return name.strip()
