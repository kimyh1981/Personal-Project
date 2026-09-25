"""재건축: 조합원 지위양도 제한, 이주비 활용 자금흐름, 입주 예상시점."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .conditions import RECON_STAGES, Conditions
from .finance import FundingResult, interest_paid, remaining_balance
from .fmt import won
from .rules import bracket


def stage_index(stage: Optional[str]) -> int:
    return RECON_STAGES.index(stage) if stage in RECON_STAGES else 0


@dataclass
class ReconResult:
    stage: str
    years_to_move_in: float
    years_until_relocation: float  # 매수 후 구축에 거주·임대 가능한 기간(추정)
    transfer_blocked: bool
    relocation_loan: int
    relocation_base: int
    relocation_timing: str
    # 이주 시점에 추가로 필요한 현금 (+필요, −여유)
    cash_needed_at_relocation: int
    contribution: int
    total_cash_committed: int      # 매수 시 + 이주 시 + 입주 시 자기자금 합계
    interest_until_move_in: int
    loan_balance_at_relocation: int
    expected_gain: Optional[int]
    notes: list = field(default_factory=list)
    blockers: list = field(default_factory=list)


def analyze(c: Conditions, rules: dict, fund: FundingResult,
            regulated: bool, capital: bool, land_permit: bool) -> ReconResult:
    R = rules["reconstruction"]
    r = c.reconstruction
    stage = r.stage or "해당없음"
    idx = stage_index(stage)
    notes, blockers = [], []

    years = float(R["stage_years_to_move_in"].get(stage, 0))
    years_until_relocation = max(years - 4.0, 0.0) if idx < stage_index("이주철거") else 0.0
    balance = round(remaining_balance(fund.loan_used, c.loan.rate, c.loan.years, years_until_relocation))

    # 조합원 지위양도 제한 (투기과열지구 재건축: 조합설립인가 이후)
    transfer_blocked = False
    restrict_from = stage_index(R["transfer_restriction_stage_regulated"])
    if regulated and idx >= restrict_from and stage != "준공":
        ex = R["transfer_exception"]
        held, lived = r.owner_held_years or 0, r.owner_lived_years or 0
        if held >= ex["held_years"] and lived >= ex["lived_years"]:
            notes.append(f"조합원 지위양도 제한 단계이나 매도인 {held}년 보유·{lived}년 거주로 "
                         "1세대1주택 장기보유 예외 요건 충족 가능 (조합 확인 필수)")
        else:
            transfer_blocked = True
            blockers.append(f"투기과열지구 재건축 '{stage}' 이후 매수 → 조합원 지위 승계 불가, "
                            "현금청산 대상 위험 (매도인 예외요건 확인 전 계약 금지)")

    # 이주비 대출
    base = r.prior_asset_value
    if base is None:
        base = round(c.price.asking * 0.8)
        notes.append("종전자산 감정가 미입력 → 매매가의 80%로 가정")
    ltv = r.relocation_loan_ltv if r.relocation_loan_ltv is not None else R["relocation_loan_ltv"]
    reloc = round(base * ltv / 100)
    homes_after = (c.buyer.owned_homes or 0) + 1
    if (capital or regulated) and homes_after >= 2 and not c.buyer.will_sell_existing:
        reloc = 0
        blockers.append("수도권·규제지역 다주택 조합원은 이주비 대출이 제한될 수 있음 → 이주비 0으로 가정")
    elif capital or regulated:
        cap = bracket(rules["loan"]["amount_cap_by_price"], c.price.asking)["cap"]
        if reloc > cap:
            notes.append(f"이주비에도 주담대 금액상한 적용 가정 → {won(cap)}으로 제한")
            reloc = cap
        # 매수 시 받은 주담대가 있으면 이주비 대출로 대환·상계되는 것이 일반적
        if balance:
            notes.append(f"이주 시점 주담대 잔액 {won(balance)}은 이주비 대출로 상환(대환)해야 함 → 순증액만 활용 가능")
    notes.append(R["relocation_loan_note"])

    if idx >= stage_index("이주철거"):
        timing = "이미 이주 단계 이후 (이주비 수령 여부·승계 가능 여부 확인)"
    elif idx >= stage_index("관리처분인가"):
        timing = "관리처분인가 후 이주 개시 시 (통상 6개월~1년 내)"
    else:
        timing = f"관리처분인가 이후 (현재 '{stage}', 약 {max(years - 4.0, 0):.1f}년 후 예상)"

    # 이주 시점 현금흐름
    net_reloc = reloc - balance                 # 기존 주담대 대환 후 순수령액
    if fund.tenant_deposit:
        # 세입자 전세금 반환에 이주비 사용
        cash_at_reloc = fund.tenant_deposit - net_reloc
        notes.append(f"이주 시 세입자 보증금 {won(fund.tenant_deposit)} 반환 → 이주비 순수령 "
                     f"{won(net_reloc)}으로 충당, 차액 {won(cash_at_reloc)} 자기자금 필요")
    elif c.lives_in:
        # 실거주자는 이주비(대환 후 순수령)로 공사기간 임시거주 보증금을 마련
        temp = r.temp_housing_deposit
        if temp is None:
            temp = c.price.jeonse or 0
            notes.append(f"임시거주 보증금 미입력 → 현재 전세 시세 {won(temp)}으로 가정")
        cash_at_reloc = temp - net_reloc
        if net_reloc < 0:
            notes.append(f"이주비({won(reloc)})가 기존 주담대보다 작아 이주 시 {won(-net_reloc)} 상환 필요")
        notes.append(f"실거주자: 임시거주 보증금 {won(temp)} − 이주비 순수령 {won(net_reloc)} "
                     f"= 이주 시 자기자금 {won(cash_at_reloc)}")
    else:
        cash_at_reloc = -max(net_reloc, 0)

    if land_permit and idx >= stage_index("이주철거"):
        blockers.append("토지거래허가구역 실거주 의무가 있으나 이미 이주·철거 단계 → 실거주 불가, 허가 불가 가능성")
    elif land_permit and years < rules.get("land_permit_residence_years", 2) + 1 and idx > 0:
        notes.append("토허구역 실거주 2년 의무 기간 중 이주가 시작될 수 있음 → 구청 허가 조건 확인")

    contribution = r.expected_contribution or 0
    total_cash = fund.required_cash + max(cash_at_reloc, 0) + max(contribution, 0)
    # 이주 전은 원리금균등 이자, 이주 후는 이주비 대출 이자(단순) 가정
    interest = round(interest_paid(fund.loan_used, c.loan.rate, c.loan.years, years_until_relocation)
                     + max(reloc, balance) * c.loan.rate / 100 * (years - years_until_relocation))

    gain = None
    if r.new_unit_value:
        cost = fund.total_cost + contribution + interest
        gain = r.new_unit_value - cost
    notes.append(R["excess_profit_note"])

    return ReconResult(stage, years, years_until_relocation, transfer_blocked, reloc, base, timing, cash_at_reloc,
                       contribution, total_cash, interest, balance, gain, notes, blockers)
