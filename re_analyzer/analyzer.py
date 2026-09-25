"""분석 오케스트레이션: 필수조건 검사 → 규제 판정 → 자금 → 재건축 → 시기 → 점수 → 판정."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from . import reconstruction as recon_mod
from .conditions import Conditions, from_dict
from .finance import FundingResult, funding
from .fmt import won
from .rules import is_capital_area, is_land_permit, is_regulated, load_rules
from .validation import Requirement, missing_requirements, value_errors, value_warnings

PYEONG = 3.3058


@dataclass
class Flag:
    level: str      # 차단 / 주의 / 정보
    category: str
    message: str


@dataclass
class Report:
    verdict: str                     # 진행가능 / 조건부 / 불가 / 입력보완필요
    missing: list[Requirement] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    area: dict = field(default_factory=dict)
    unit_price: dict = field(default_factory=dict)
    funding: Optional[FundingResult] = None
    recon: Optional[recon_mod.ReconResult] = None
    timing: dict = field(default_factory=dict)
    scores: dict = field(default_factory=dict)
    flags: list[Flag] = field(default_factory=list)
    rules_as_of: str = ""
    rules_notice: str = ""


def _year_month(s: str) -> float:
    y, m = s.split("-")
    return int(y) + (int(m) - 1) / 12


def _fmt_ym(t: float) -> str:
    months = round(t * 12)
    return f"{months // 12}-{months % 12 + 1:02d}"


def _unit_price(c: Conditions) -> dict:
    area = c.property.area_m2
    price = c.price.asking
    out = {
        "per_m2": round(price / area),
        # 전용면적 기준 평당가 (공급면적 기준 평당가와 다름에 유의)
        "per_pyeong_exclusive": round(price / (area / PYEONG)),
    }
    if c.price.recent_trades:
        avg = sum(c.price.recent_trades) / len(c.price.recent_trades)
        out["recent_avg"] = round(avg)
        out["premium_pct"] = round((price / avg - 1) * 100, 1)
    if c.price.jeonse:
        out["jeonse_ratio_pct"] = round(c.price.jeonse / price * 100, 1)
        out["gap"] = price - c.price.jeonse
    return out


def _clamp(x: float) -> int:
    return int(max(0, min(100, round(x))))


def _residence_score(c: Conditions) -> dict:
    L = c.location
    parts = {}
    if L.job_commute_min is not None:
        parts["통근"] = _clamp(100 - max(0, L.job_commute_min - 20) * 2)
    if L.school_walk_min is not None:
        parts["학교"] = _clamp(100 - max(0, L.school_walk_min - 5) * 5)
    if L.subway_walk_min is not None:
        parts["역세권"] = _clamp(100 - max(0, L.subway_walk_min - 5) * 4)
    base = sum(parts.values()) / len(parts) if parts else 50
    adj = 3 * len(L.amenities) - 5 * len(L.negatives)
    if c.property.type in ("빌라", "단독주택"):
        adj -= 5   # 관리·보안·주차 편의 열위 (평균적 가정)
    return {"score": _clamp(base + adj), "parts": parts, "adj": adj}


def _investment_score(c: Conditions, unit: dict, fund: FundingResult,
                      recon: Optional[recon_mod.ReconResult], regulated: bool) -> dict:
    parts = {}
    if "premium_pct" in unit:           # 실거래 대비 할인일수록 가점
        parts["가격적정성"] = _clamp(60 - unit["premium_pct"] * 4)
    if "jeonse_ratio_pct" in unit:      # 전세가율: 하방 경직성
        parts["전세가율"] = _clamp(unit["jeonse_ratio_pct"] * 1.4)
    if c.location.subway_walk_min is not None:
        parts["환금성"] = _clamp(100 - max(0, c.location.subway_walk_min - 5) * 4)
    liquidity = {"아파트": 80, "오피스텔": 45, "빌라": 35, "단독주택": 40}[c.property.type]
    parts["유형"] = liquidity
    if recon and recon.expected_gain is not None:
        roi = recon.expected_gain / max(recon.total_cash_committed, 1) * 100
        parts["재건축수익"] = _clamp(50 + roi / 2)
    base = sum(parts.values()) / len(parts)
    adj = 3 * len(c.location.amenities) - 5 * len(c.location.negatives)
    if fund.dsr_pct > 35:
        adj -= 5
    return {"score": _clamp(base + adj), "parts": parts, "adj": adj}


def analyze(data: dict | Conditions, rules: Optional[dict] = None) -> Report:
    rules = rules or load_rules()
    c = data if isinstance(data, Conditions) else from_dict(data)
    rep = Report(verdict="입력보완필요", rules_as_of=rules.get("as_of", ""),
                 rules_notice=rules.get("notice", ""))

    rep.missing = missing_requirements(c)
    rep.errors = value_errors(c)
    if rep.missing or rep.errors:
        return rep

    flags = rep.flags
    for w in value_warnings(c):
        flags.append(Flag("주의", "입력", w))

    # --- 지역·규제 판정 ---
    regulated = c.region.regulated if c.region.regulated is not None else \
        is_regulated(rules, c.region.sido, c.region.sigungu)
    land_permit = c.region.land_permit_zone if c.region.land_permit_zone is not None else \
        is_land_permit(rules, c.region.sido, c.region.sigungu, c.property.type)
    capital = is_capital_area(rules, c.region.sido)
    rep.area = {"규제지역": regulated, "토지거래허가구역": land_permit, "수도권": capital}
    if c.region.sido == "경기" and c.region.sigungu and " " not in c.region.sigungu.strip() \
            and c.region.sigungu.endswith("시") and c.region.regulated is None:
        flags.append(Flag("주의", "지역", "구가 있는 시는 '성남시 분당구'처럼 구까지 입력해야 규제지역을 정확히 판정합니다"))

    if land_permit:
        if not c.lives_in or c.price.assume_tenant:
            flags.append(Flag("차단", "규제", f"토지거래허가구역: 허가 후 {rules['land_permit_residence_years']}년 실거주 의무 → "
                                              "갭투자(세입자 승계)·비거주 매수 불가"))
        else:
            flags.append(Flag("주의", "규제", "토지거래허가구역: 계약 전 구청 허가 필요, "
                                              f"{rules['land_permit_residence_years']}년 실거주 의무"))
    if regulated:
        flags.append(Flag("정보", "규제", "규제지역: 자금조달계획서(증빙 포함) 제출, 양도세 비과세 시 2년 거주 요건"))

    # --- 단가 ---
    rep.unit_price = _unit_price(c)
    if rep.unit_price.get("premium_pct", 0) > 5:
        flags.append(Flag("주의", "단가", f"최근 실거래 평균 대비 {rep.unit_price['premium_pct']}% 고가"))

    # --- 자금 ---
    fund = funding(c, rules, regulated, capital)
    rep.funding = fund
    if fund.loan.blocked_reason and c.loan.use_loan and not fund.tenant_deposit:
        flags.append(Flag("주의", "대출", fund.loan.blocked_reason))
    for cond in fund.loan.conditions:
        flags.append(Flag("주의", "대출", cond))
    if fund.tax.heavy:
        flags.append(Flag("주의", "세금", f"취득세 중과 {fund.tax.rate}% (취득 후 {fund.tax.homes_after}주택)"))
    if fund.surplus < 0:
        flags.append(Flag("차단", "자금", f"매수 시 자기자금 {won(-fund.surplus)} 부족"))
    if fund.dsr_pct > rules["loan"]["dsr_limit"]:
        flags.append(Flag("차단", "자금", f"DSR {fund.dsr_pct}% > 한도 {rules['loan']['dsr_limit']}%"))
    if fund.tenant_deposit and fund.price and fund.tenant_deposit / fund.price > 0.8:
        flags.append(Flag("주의", "자금", "전세가율 80% 초과: 역전세·보증금 반환 리스크"))

    # --- 재건축 ---
    if c.is_recon:
        rep.recon = recon_mod.analyze(c, rules, fund, regulated, capital, land_permit)
        for b in rep.recon.blockers:
            flags.append(Flag("차단", "재건축", b))
        r = rep.recon
        savings = c.buyer.annual_savings
        at_reloc = max(fund.surplus, 0) + savings * r.years_until_relocation
        need_reloc = max(r.cash_needed_at_relocation, 0)
        if need_reloc > at_reloc:
            flags.append(Flag("차단", "재건축",
                              f"이주 시 {won(need_reloc)} 필요하나 그때까지 확보 예상 {won(at_reloc)} "
                              f"(매수 후 여유 + 연저축 {won(savings)} × {r.years_until_relocation:.1f}년) → 재원 부족"))
        at_move_in = at_reloc - need_reloc + savings * (r.years_to_move_in - r.years_until_relocation)
        if r.contribution > max(at_move_in, 0):
            flags.append(Flag("주의", "재건축", f"입주 시 분담금 {won(r.contribution)} 중 "
                                                 f"{won(r.contribution - max(at_move_in, 0))} 추가 마련 필요 (중도금 대출 등)"))

    # --- 시기 ---
    now = _year_month(c.timing.purchase_date)
    move_in_years = rep.recon.years_to_move_in if rep.recon else 0.0
    rep.timing = {"매수": c.timing.purchase_date,
                  ("신축 입주(예상)" if rep.recon else "입주가능"): _fmt_ym(now + move_in_years)}
    if rep.recon:
        rep.timing["이주(예상)"] = _fmt_ym(now + rep.recon.years_until_relocation)
    # 재건축 구축은 이주 전까지 바로 거주 가능 → 이주 이후 단계만 입주 지연으로 본다
    can_live_now = rep.recon is None or rep.recon.years_until_relocation > 0
    if c.timing.move_in_by and c.lives_in and not can_live_now:
        target = _year_month(c.timing.move_in_by)
        if now + move_in_years > target:
            flags.append(Flag("주의", "시기", f"희망 입주({c.timing.move_in_by})보다 "
                                              f"약 {now + move_in_years - target:.1f}년 늦게 입주 예상"))
    if c.timing.holding_years is not None:
        if c.timing.holding_years < 2:
            flags.append(Flag("주의", "시기", "2년 미만 보유 시 양도세 단기 중과세율(60~70%)"))
        if rep.recon and c.timing.holding_years < move_in_years:
            flags.append(Flag("주의", "시기", f"보유기간 {c.timing.holding_years}년 < 입주까지 {move_in_years:.1f}년 → "
                                              "준공 전 매도 필요, 지위양도 제한으로 매도 자체가 막힐 수 있음"))

    # --- 점수 ---
    if c.purpose in ("거주", "거주+투자"):
        rep.scores["거주"] = _residence_score(c)
    if c.purpose in ("투자", "거주+투자"):
        rep.scores["투자"] = _investment_score(c, rep.unit_price, fund, rep.recon, regulated)

    levels = {f.level for f in flags}
    rep.verdict = "불가" if "차단" in levels else "조건부" if "주의" in levels else "진행가능"
    return rep
