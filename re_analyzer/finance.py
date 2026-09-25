"""자금 계산: 취득세, 중개보수, 대출한도(LTV·금액상한·DSR), 필요자금."""
from __future__ import annotations

from dataclasses import dataclass, field

from .conditions import Conditions
from .rules import bracket


def annual_payment(principal: float, rate_pct: float, years: int) -> float:
    """원리금균등 연간 상환액."""
    if principal <= 0:
        return 0.0
    r = rate_pct / 100 / 12
    n = years * 12
    if r == 0:
        return principal / years
    monthly = principal * r / (1 - (1 + r) ** -n)
    return monthly * 12


def principal_for_payment(annual: float, rate_pct: float, years: int) -> float:
    """연간 상환 가능액으로 빌릴 수 있는 원금."""
    if annual <= 0:
        return 0.0
    r = rate_pct / 100 / 12
    n = years * 12
    if r == 0:
        return annual * years
    return (annual / 12) * (1 - (1 + r) ** -n) / r


def remaining_balance(principal: float, rate_pct: float, years: int, elapsed: float) -> float:
    """원리금균등 상환 시 elapsed 년 경과 후 잔액."""
    if principal <= 0:
        return 0.0
    k = min(round(elapsed * 12), years * 12)
    r = rate_pct / 100 / 12
    n = years * 12
    if r == 0:
        return principal * (1 - k / n)
    return principal * ((1 + r) ** n - (1 + r) ** k) / ((1 + r) ** n - 1)


def interest_paid(principal: float, rate_pct: float, years: int, elapsed: float) -> float:
    """elapsed 년 동안 낸 이자 합계."""
    k = min(round(elapsed * 12), years * 12)
    paid = annual_payment(principal, rate_pct, years) / 12 * k
    return paid - (principal - remaining_balance(principal, rate_pct, years, elapsed))


# ----------------------------------------------------------------- 세금·비용

@dataclass
class TaxResult:
    homes_after: int
    rate: float              # 취득세율(%)
    heavy: bool
    acquisition_tax: int
    education_tax: int
    rural_tax: int
    reduction: int
    total: int
    note: str = ""


def acquisition_tax(c: Conditions, rules: dict, regulated: bool) -> TaxResult:
    t = rules["acquisition_tax"]
    price = c.price.asking
    homes_after = (c.buyer.owned_homes or 0) + 1
    # 일시적 2주택: 기존주택 처분 조건이면 1주택 세율
    effective = homes_after
    note = ""
    if homes_after == 2 and c.buyer.will_sell_existing:
        effective = 1
        note = "일시적 2주택(기존주택 기한 내 처분 조건)으로 일반세율 적용"

    heavy_rate = None
    table = t["heavy"]["regulated" if regulated else "unregulated"]
    for key, val in table.items():
        if key.endswith("+"):
            if effective >= int(key[:-1]):
                heavy_rate = val
        elif effective == int(key):
            heavy_rate = val
    if c.property.type == "오피스텔":
        # 오피스텔은 주택 수와 무관하게 4% 적용(주거용 신고 시 주택 수에는 포함)
        heavy_rate, note = 4.0, "오피스텔 취득세 4% 적용"

    if heavy_rate:
        rate = heavy_rate
        heavy = heavy_rate > 3.0
    else:
        heavy = False
        row = bracket(t["standard_brackets"], price)
        if row["rate"] == "linear":
            # 6억~9억: (취득가액 × 2/3억 − 3) %
            rate = round(price * 2 / 30000 - 3, 2)
        else:
            rate = row["rate"]

    acq = price * rate / 100
    edu = price * (t["education_tax_heavy"] if heavy else rate * t["education_tax_ratio_standard"]) / 100
    rural = 0.0
    if (c.property.area_m2 or 0) > 85:
        rt = t["rural_tax_over_85m2"]
        rural = price * rt.get(str(rate), rt["standard"]) / 100

    reduction = 0
    ftr = t.get("first_time_reduction")
    if (ftr and c.buyer.first_time_buyer and (c.buyer.owned_homes or 0) == 0
            and price <= ftr["price_up_to"]):
        reduction = int(min(acq, ftr["cap"]))

    total = acq + edu + rural - reduction
    return TaxResult(homes_after, rate, heavy, round(acq), round(edu), round(rural),
                     reduction, round(total), note)


def brokerage_fee(price: int, rules: dict) -> int:
    row = bracket(rules["brokerage"], price)
    fee = price * row["rate"] / 100
    if row.get("max"):
        fee = min(fee, row["max"])
    return round(fee * (1 + rules.get("brokerage_vat", 0) / 100))


# ----------------------------------------------------------------- 대출

@dataclass
class LoanResult:
    ltv_pct: float
    by_ltv: int
    by_cap: int | None
    by_dsr: int
    stress_rate: float
    max_loan: int
    blocked_reason: str = ""
    conditions: list = field(default_factory=list)


def loan_limit(c: Conditions, rules: dict, regulated: bool, capital: bool) -> LoanResult:
    L = rules["loan"]
    price = c.price.asking
    owned = c.buyer.owned_homes or 0
    conds, blocked = [], ""

    if not c.loan.use_loan:
        return LoanResult(0, 0, None, 0, c.loan.rate, 0, "대출 미사용")

    # LTV
    first = c.buyer.first_time_buyer and owned == 0
    if regulated:
        ltv = L["ltv"]["regulated_first_time" if first else "regulated"]
    elif first:
        ltv = L["ltv"]["capital_first_time" if capital else "unregulated_first_time"]
    else:
        ltv = L["ltv"]["unregulated"]

    if (capital or regulated) and owned >= 2:
        ltv, blocked = L["ltv"]["capital_multi_home"], "수도권·규제지역 2주택 이상 보유자 주택구입 목적 주담대 불가"
    elif (capital or regulated) and owned == 1 and L.get("one_home_requires_sale_in_capital"):
        if c.buyer.will_sell_existing:
            conds.append("1주택자: 기존주택 처분 약정(통상 6개월 내) 이행 조건")
        else:
            ltv, blocked = 0, "수도권·규제지역 1주택자는 기존주택 처분 약정 없이 주담대 불가"

    # 수도권 주담대 전입의무 → 비거주 목적이면 사실상 대출 불가
    if capital and ltv > 0 and not c.lives_in:
        months = L.get("move_in_required_months")
        if months:
            ltv, blocked = 0, f"수도권 주담대는 {months}개월 내 전입 의무 → 비거주(갭) 매수에는 주담대 사용 불가"
    elif capital and ltv > 0 and L.get("move_in_required_months"):
        conds.append(f"대출 실행 후 {L['move_in_required_months']}개월 내 전입 의무")

    by_ltv = round(price * ltv / 100)

    by_cap = None
    if L.get("amount_cap_applies_to") == "capital_or_regulated" and (capital or regulated):
        by_cap = bracket(L["amount_cap_by_price"], price)["cap"]

    stress_add = L["stress_rate_add"]["capital_or_regulated" if (capital or regulated) else "other"]
    stress_rate = c.loan.rate + stress_add
    income = c.buyer.annual_income or 0
    room = income * L["dsr_limit"] / 100 - c.buyer.existing_debt_annual_payment
    by_dsr = round(principal_for_payment(room, stress_rate, c.loan.years))

    candidates = [by_ltv, by_dsr] + ([by_cap] if by_cap is not None else [])
    max_loan = max(0, min(candidates))
    return LoanResult(ltv, by_ltv, by_cap, by_dsr, stress_rate, max_loan, blocked, conds)


# ----------------------------------------------------------------- 필요자금

@dataclass
class FundingResult:
    price: int
    tax: TaxResult
    brokerage: int
    misc: int
    total_cost: int           # 매매가 + 세금 + 비용
    loan: LoanResult
    loan_used: int
    tenant_deposit: int       # 승계 전세보증금
    required_cash: int        # 자기자금 필요액
    available_cash: int
    surplus: int              # +여유 / −부족
    annual_debt_service: int  # 실제 금리 기준 연 원리금
    monthly_debt_service: int
    dsr_pct: float


def funding(c: Conditions, rules: dict, regulated: bool, capital: bool) -> FundingResult:
    price = c.price.asking
    tax = acquisition_tax(c, rules, regulated)
    fee = brokerage_fee(price, rules)
    misc = round(price * rules.get("misc_cost_rate", 0) / 100)
    total_cost = price + tax.total + fee + misc

    tenant = c.price.jeonse if (c.price.assume_tenant and c.price.jeonse) else 0
    loan = loan_limit(c, rules, regulated, capital)
    # 세입자 승계 시 주담대와 병행 불가(선순위 임차인)로 보수적으로 가정
    loan_used = 0 if tenant else loan.max_loan
    loan_used = min(loan_used, max(0, price - tenant))

    required = total_cost - loan_used - tenant
    cash = c.buyer.cash or 0
    pay = annual_payment(loan_used, c.loan.rate, c.loan.years)
    income = c.buyer.annual_income or 0
    dsr = (pay + c.buyer.existing_debt_annual_payment) / income * 100 if income else 0.0
    return FundingResult(price, tax, fee, misc, round(total_cost), loan, round(loan_used),
                         tenant, round(required), cash, round(cash - required),
                         round(pay), round(pay / 12), round(dsr, 1))
