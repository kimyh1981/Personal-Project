"""필수 조건 정의와 누락·오류 검사.

필수 조건은 세 층위로 나뉜다.
  - 공통 필수: 목적과 무관하게 분석이 불가능해지는 항목
  - 목적별 필수: 투자/거주 목적에 따라 추가로 필요한 항목
  - 상황별 필수: 재건축 대상, 세입자 승계 등 특정 상황에서만 필요한 항목
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable

from .conditions import PROPERTY_TYPES, PURPOSES, RECON_STAGES, Conditions


@dataclass(frozen=True)
class Requirement:
    path: str                    # 예: "price.asking"
    label: str                   # 사용자에게 보여줄 이름
    category: str                # 지역/입지/주택유형/자금/단가/재건축/시기/규제
    why: str                     # 왜 필요한가
    when: Callable[[Conditions], bool] = lambda c: True
    scope: str = "공통"


def _is_invest(c: Conditions) -> bool:
    return c.purpose in ("투자", "거주+투자")


def _is_live(c: Conditions) -> bool:
    return c.purpose in ("거주", "거주+투자")


REQUIREMENTS: tuple[Requirement, ...] = (
    # --- 공통 필수 ---
    Requirement("purpose", "매수 목적(거주/투자/거주+투자)", "목적",
                "목적에 따라 대출·세금·실거주 의무·평가 기준이 모두 달라짐"),
    Requirement("region.sido", "시·도", "지역", "규제지역·토지거래허가구역·수도권 대출규제 판정"),
    Requirement("region.sigungu", "시·군·구", "지역", "규제지역 판정은 시·군·구(일부 구) 단위"),
    Requirement("property.type", "주택 유형", "주택유형",
                "아파트/단독/빌라별로 토허제 적용·환금성·재건축 가능성이 다름"),
    Requirement("property.area_m2", "전용면적(㎡)", "주택유형", "85㎡ 초과 농특세, 평당가 산출"),
    Requirement("price.asking", "매매가", "단가", "필요자금·세금·대출한도 계산의 기준"),
    Requirement("buyer.cash", "확보 가능 자기자금", "자금", "필요자금 대비 부족액 판정"),
    Requirement("buyer.owned_homes", "현재 보유 주택 수(세대 기준)", "자금",
                "취득세 중과, 다주택자 대출 금지, 처분조건 판정"),
    Requirement("buyer.annual_income", "세대 연소득", "자금", "DSR 기반 대출한도 산정"),
    Requirement("timing.purchase_date", "매수 예정 시점(YYYY-MM)", "시기",
                "규정 적용 시점, 입주·보유기간 계산"),
    # --- 목적별 필수 ---
    Requirement("location.job_commute_min", "주요 업무지구 통근시간(분)", "입지",
                "거주 만족도 핵심 지표", _is_live, "거주"),
    Requirement("location.school_walk_min", "초등학교 도보시간(분)", "입지",
                "거주 수요·학군", _is_live, "거주"),
    Requirement("location.subway_walk_min", "역까지 도보시간(분)", "입지",
                "환금성과 가격 방어력의 핵심 지표", _is_invest, "투자"),
    Requirement("price.recent_trades", "동일 평형 최근 실거래가", "단가",
                "매매가 적정성(고평가/저평가) 판단", _is_invest, "투자"),
    Requirement("price.jeonse", "전세 시세", "단가",
                "전세가율·갭 규모·하방 리스크 판단", _is_invest, "투자"),
    Requirement("timing.holding_years", "계획 보유기간(년)", "시기",
                "재건축 입주 시점·양도세 비과세 요건과 맞는지 판단", _is_invest, "투자"),
    # --- 상황별 필수 ---
    Requirement("reconstruction.stage", "정비사업 단계", "재건축",
                "이주비 시점·조합원 지위양도 제한·입주 예상시점 판정",
                lambda c: c.property.reconstruction_target, "재건축"),
    Requirement("reconstruction.prior_asset_value", "종전자산 감정가(또는 추정치)", "재건축",
                "이주비 대출 한도 산정",
                lambda c: c.is_recon and c.reconstruction.stage in
                ("사업시행인가", "관리처분인가", "이주철거"), "재건축"),
    Requirement("reconstruction.expected_contribution", "예상 분담금", "재건축",
                "입주 시 추가 필요자금", lambda c: c.is_recon, "재건축"),
    Requirement("price.jeonse", "승계 전세보증금", "자금",
                "세입자 승계 시 필요자금 차감", lambda c: c.price.assume_tenant, "세입자승계"),
)


def _get(c: Conditions, path: str):
    obj = c
    for part in path.split("."):
        obj = getattr(obj, part)
    return obj


def _empty(v) -> bool:
    return v is None or v == "" or (isinstance(v, (list, tuple)) and not v)


def missing_requirements(c: Conditions) -> list[Requirement]:
    """해당 입력에 적용되는 필수 조건 중 비어 있는 것."""
    out, seen = [], set()
    for req in REQUIREMENTS:
        if req.path in seen:
            continue
        # purpose 가 없으면 목적별 조건은 판단 불가 → 공통만 검사
        try:
            applies = req.when(c)
        except Exception:
            applies = False
        if applies and _empty(_get(c, req.path)):
            out.append(req)
            seen.add(req.path)
    return out


_DATE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def value_errors(c: Conditions) -> list[str]:
    """형식·범위 오류."""
    errs = []
    if c.purpose is not None and c.purpose not in PURPOSES:
        errs.append(f"purpose 는 {PURPOSES} 중 하나여야 합니다: {c.purpose!r}")
    if c.property.type is not None and c.property.type not in PROPERTY_TYPES:
        errs.append(f"property.type 은 {PROPERTY_TYPES} 중 하나여야 합니다: {c.property.type!r}")
    if c.reconstruction.stage is not None and c.reconstruction.stage not in RECON_STAGES:
        errs.append(f"reconstruction.stage 는 {RECON_STAGES} 중 하나여야 합니다")
    for path in ("timing.purchase_date", "timing.move_in_by"):
        v = _get(c, path)
        if v is not None and not _DATE.match(str(v)):
            errs.append(f"{path} 는 YYYY-MM 형식이어야 합니다: {v!r}")
    for path in ("price.asking", "buyer.cash", "buyer.annual_income", "property.area_m2"):
        v = _get(c, path)
        if v is not None and v <= 0:
            errs.append(f"{path} 는 0보다 커야 합니다")
    if c.buyer.owned_homes is not None and c.buyer.owned_homes < 0:
        errs.append("buyer.owned_homes 는 0 이상이어야 합니다")
    return errs


def value_warnings(c: Conditions) -> list[str]:
    """분석은 가능하지만 확인이 필요한 입력."""
    warns = []
    if c.price.jeonse and c.price.asking and c.price.jeonse >= c.price.asking:
        warns.append("전세가가 매매가 이상입니다 (깡통전세 위험 또는 입력 오류)")
    return warns
