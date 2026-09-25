"""부동산 투자·거주 분석기.

지역·입지·주택유형·확보자금·매매단가·필요자금·재건축(이주비 활용)·시기·규제를
필수 조건으로 받아 매수 가능 여부와 리스크를 판정한다. 금액 단위는 만원.
"""
from .analyzer import Report, analyze
from .conditions import Conditions, from_dict
from .rules import load_rules

__all__ = ["analyze", "Report", "Conditions", "from_dict", "load_rules"]
