"""분석 결과를 사람이 읽는 텍스트/JSON 으로 변환."""
from __future__ import annotations

import dataclasses
import json

from .analyzer import Report
from .fmt import won
from .validation import REQUIREMENTS


def checklist() -> str:
    """필수 조건 전체 목록."""
    lines = ["# 필수 조건 체크리스트", ""]
    for scope in ("공통", "거주", "투자", "재건축", "세입자승계"):
        reqs = [r for r in REQUIREMENTS if r.scope == scope]
        if not reqs:
            continue
        lines.append(f"## {scope}{' 필수' if scope == '공통' else ' 목적/상황 시 필수'}")
        for r in reqs:
            lines.append(f"- [{r.category}] {r.label} (`{r.path}`) — {r.why}")
        lines.append("")
    return "\n".join(lines)


def to_text(rep: Report) -> str:
    L = []
    L.append(f"■ 판정: {rep.verdict}")
    L.append(f"  (규정 기준일 {rep.rules_as_of} — {rep.rules_notice})")
    if rep.missing or rep.errors:
        L.append("")
        L.append("■ 누락된 필수 조건")
        for r in rep.missing:
            L.append(f"  - [{r.category}] {r.label}  ←  {r.path}  ({r.why})")
        for e in rep.errors:
            L.append(f"  - 입력 오류: {e}")
        return "\n".join(L)

    L.append("")
    L.append("■ 지역 판정: " + ", ".join(f"{k} {'O' if v else 'X'}" for k, v in rep.area.items()))

    u = rep.unit_price
    L.append("")
    L.append("■ 매매단가")
    L.append(f"  ㎡당 {won(u['per_m2'])} / 전용 평당 {won(u['per_pyeong_exclusive'])}")
    if "recent_avg" in u:
        L.append(f"  최근 실거래 평균 {won(u['recent_avg'])} 대비 {u['premium_pct']:+}%")
    if "jeonse_ratio_pct" in u:
        L.append(f"  전세가율 {u['jeonse_ratio_pct']}% / 갭 {won(u['gap'])}")

    f = rep.funding
    L.append("")
    L.append("■ 필요자금")
    L.append(f"  매매가            {won(f.price)}")
    L.append(f"  취득세 등         {won(f.tax.total)}  (세율 {f.tax.rate}%, 취득 후 {f.tax.homes_after}주택"
             f"{', 생애최초 감면 ' + won(f.tax.reduction) if f.tax.reduction else ''})")
    if f.tax.note:
        L.append(f"                    {f.tax.note}")
    L.append(f"  중개보수(VAT)     {won(f.brokerage)}")
    L.append(f"  기타 부대비용     {won(f.misc)}")
    L.append(f"  = 총 소요         {won(f.total_cost)}")
    lo = f.loan
    cap = f", 금액상한 {won(lo.by_cap)}" if lo.by_cap is not None else ""
    L.append(f"  대출한도          {won(lo.max_loan)}  (LTV {lo.ltv_pct}% {won(lo.by_ltv)}{cap}, "
             f"DSR(스트레스 {lo.stress_rate:.2f}%) {won(lo.by_dsr)})")
    if lo.blocked_reason:
        L.append(f"                    ※ {lo.blocked_reason}")
    L.append(f"  대출 사용         {won(f.loan_used)}  (월 {won(f.monthly_debt_service)}, DSR {f.dsr_pct}%)")
    if f.tenant_deposit:
        L.append(f"  전세보증금 승계   {won(f.tenant_deposit)}")
    L.append(f"  자기자금 필요     {won(f.required_cash)}")
    L.append(f"  보유 자기자금     {won(f.available_cash)}")
    L.append(f"  → {'여유' if f.surplus >= 0 else '부족'} {won(abs(f.surplus))}")

    if rep.recon:
        r = rep.recon
        L.append("")
        L.append(f"■ 재건축 ({r.stage})")
        L.append(f"  신축 입주까지 약 {r.years_to_move_in}년 (구축 거주·임대 가능 약 {r.years_until_relocation:.1f}년)")
        L.append(f"  이주 시점: {r.relocation_timing}")
        L.append(f"  이주비 대출 {won(r.relocation_loan)} (종전자산 {won(r.relocation_base)} 기준), "
                 f"이주 시점 주담대 잔액 {won(r.loan_balance_at_relocation)}")
        L.append(f"  이주 시 추가 현금 {won(r.cash_needed_at_relocation)} / 입주 시 분담금 {won(r.contribution)}")
        L.append(f"  총 투입 자기자금 {won(r.total_cash_committed)} / 입주까지 이자 {won(r.interest_until_move_in)}")
        if r.expected_gain is not None:
            L.append(f"  예상 차익(세전, 신축시세 − 총비용) {won(r.expected_gain)}")
        for n in r.notes:
            L.append(f"  · {n}")

    L.append("")
    L.append("■ 시기: " + ", ".join(f"{k} {v}" for k, v in rep.timing.items()))

    if rep.scores:
        L.append("")
        L.append("■ 점수 (0~100)")
        for k, s in rep.scores.items():
            parts = ", ".join(f"{pk} {pv}" for pk, pv in s["parts"].items())
            L.append(f"  {k} {s['score']}  ({parts}; 가감 {s['adj']:+})")

    if rep.flags:
        L.append("")
        L.append("■ 검토 사항")
        order = {"차단": 0, "주의": 1, "정보": 2}
        for fl in sorted(rep.flags, key=lambda x: order[x.level]):
            L.append(f"  [{fl.level}] ({fl.category}) {fl.message}")
    return "\n".join(L)


def to_json(rep: Report) -> str:
    def conv(o):
        if dataclasses.is_dataclass(o):
            d = {}
            for fld in dataclasses.fields(o):
                v = getattr(o, fld.name)
                d[fld.name] = conv(v)
            return d
        if isinstance(o, list):
            return [conv(x) for x in o]
        if isinstance(o, dict):
            return {k: conv(v) for k, v in o.items()}
        if callable(o):
            return None
        return o
    d = conv(rep)
    d["missing"] = [{"path": m.path, "label": m.label, "category": m.category}
                    for m in rep.missing]
    return json.dumps(d, ensure_ascii=False, indent=2)
