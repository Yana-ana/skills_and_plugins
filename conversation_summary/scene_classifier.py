"""
场景分类器：基于关键词的轻量规则判断对话场景

返回值固定 3 类（可扩展）：
  work    - 职场场景
  social  - 社交场景
  other   - 其他

扩展方式：
  from scene_classifier import register_keywords
  register_keywords("study", ["作业", "考试", "课程"], label="学习场景")
"""

import logging
from typing import Dict, List, Tuple

logger = logging.getLogger(__name__)

# scene_key -> (label, keywords)
_SCENE_RULES: Dict[str, Tuple[str, List[str]]] = {
    "work": ("职场场景", [
        "项目", "需求", "会议", "排期", "上线", "Bug", "bug", "PRD",
        "客户", "周报", "OKR", "KPI", "汇报", "评审", "开发", "测试",
        "部署", "代码", "接口", "API", "产品", "运营", "市场",
        "老板", "经理", "总监", "同事", "下属", "方案", "预算",
        "审批", "任务", "交付", "进度", "排班", "出差",
        "创业", "创业者", "创始人", "公司", "商业", "业务", "战略",
        "招聘", "人才", "候选人", "岗位", "offer", "Offer", "竞拍",
        "硅谷", "AI人才", "融资", "投资", "股权", "团队", "决策",
    ]),
    "social": ("社交场景", [
        "朋友", "聚会", "聊天", "见面", "约", "饭局", "酒局",
        "合作伙伴", "认识", "介绍", "人脉", "关系", "微信",
        "请教", "学习", "分享", "饭", "茶", "咖啡", "周末",
        "家人", "父母", "孩子", "情绪", "想法", "感受",
        "兴趣", "爱好",
    ]),
    "sales": ("销售场景", [
        "销售", "成交", "商机", "意向", "报价", "报价单", "询价", "议价",
        "折扣", "合同", "签约", "续约", "采购", "采购周期", "招标", "投标",
        "客户留存", "转化", "漏斗", "客单价", "ROI", "试点", "POC", "demo",
        "演示", "方案", "案例", "拜访", "跟进", "回访", "决策人", "KP", "KA",
        "痛点", "需求确认", "立项", "回款", "回扣",
    ]),
}

_DEFAULT_SCENE = "other"
_DEFAULT_LABEL = "其他场景"


def register_keywords(scene_key: str, keywords: List[str], label: str) -> None:
    """注册或扩展一个场景的关键词列表"""
    if not scene_key or not keywords:
        return
    existing = _SCENE_RULES.get(scene_key)
    if existing:
        _SCENE_RULES[scene_key] = (label or existing[0],
                                    sorted(set(existing[1] + keywords)))
    else:
        _SCENE_RULES[scene_key] = (label or scene_key, list(keywords))


def classify(text: str) -> Tuple[str, str, Dict[str, int]]:
    """
    根据文本判断场景。

    Args:
        text: 对话原文 / transcript

    Returns:
        (scene_key, scene_label, scores)
        scores 是各场景的命中关键词数，便于调试与可观测性
    """
    if not text:
        return _DEFAULT_SCENE, _DEFAULT_LABEL, {}

    scores: Dict[str, int] = {}
    for scene_key, (_, kws) in _SCENE_RULES.items():
        scores[scene_key] = sum(1 for kw in kws if kw in text)

    best_scene, best_score = max(scores.items(), key=lambda x: x[1])
    if best_score == 0:
        logger.debug("scene classify: no keyword matched, fallback to other")
        return _DEFAULT_SCENE, _DEFAULT_LABEL, scores

    label = _SCENE_RULES[best_scene][0]
    logger.info(f"scene classify: {best_scene} ({label}), scores={scores}")
    return best_scene, label, scores
