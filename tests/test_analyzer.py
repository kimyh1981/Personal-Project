import json
import unittest
from pathlib import Path

from re_analyzer import analyze, load_rules
from re_analyzer.conditions import from_dict
from re_analyzer.finance import (acquisition_tax, annual_payment, principal_for_payment,
                                 remaining_balance)
from re_analyzer.rules import is_land_permit, is_regulated
from re_analyzer.validation import missing_requirements

EXAMPLES = Path(__file__).resolve().parent.parent / "examples"
RULES = load_rules()


def base(**over):
    d = {
        "purpose": "거주",
        "region": {"sido": "인천", "sigungu": "부평구"},
        "location": {"job_commute_min": 30, "school_walk_min": 5},
        "property": {"type": "아파트", "area_m2": 84},
        "price": {"asking": 50000},
        "buyer": {"cash": 30000, "owned_homes": 0, "annual_income": 8000},
        "timing": {"purchase_date": "2026-11"},
    }
    for k, v in over.items():
        if isinstance(v, dict):
            d[k].update(v)
        else:
            d[k] = v
    return d


class TestRequirements(unittest.TestCase):
    def test_incomplete_example_reports_missing(self):
        rep = analyze(json.loads((EXAMPLES / "incomplete.json").read_text()))
        self.assertEqual(rep.verdict, "입력보완필요")
        paths = {m.path for m in rep.missing}
        for p in ("region.sigungu", "buyer.annual_income", "reconstruction.stage",
                  "price.jeonse", "timing.holding_years"):
            self.assertIn(p, paths)

    def test_purpose_specific(self):
        live = {m.path for m in missing_requirements(from_dict({"purpose": "거주"}))}
        inv = {m.path for m in missing_requirements(from_dict({"purpose": "투자"}))}
        self.assertIn("location.job_commute_min", live)
        self.assertNotIn("location.job_commute_min", inv)
        self.assertIn("price.recent_trades", inv)

    def test_complete_input_passes(self):
        self.assertEqual(missing_requirements(from_dict(base())), [])

    def test_bad_values(self):
        rep = analyze(base(property={"type": "상가"}))
        self.assertEqual(rep.verdict, "입력보완필요")
        self.assertTrue(rep.errors)


class TestRegion(unittest.TestCase):
    def test_regulated(self):
        self.assertTrue(is_regulated(RULES, "서울", "노원구"))
        self.assertTrue(is_regulated(RULES, "경기", "성남시 분당구"))
        self.assertTrue(is_regulated(RULES, "경기", "하남시"))
        self.assertFalse(is_regulated(RULES, "경기", "성남시"))       # 구까지 필요
        self.assertFalse(is_regulated(RULES, "경기", "고양시 일산동구"))
        self.assertFalse(is_regulated(RULES, "인천", "부평구"))

    def test_land_permit_only_apartments(self):
        self.assertTrue(is_land_permit(RULES, "서울", "강남구", "아파트"))
        self.assertFalse(is_land_permit(RULES, "서울", "강남구", "빌라"))


class TestFinance(unittest.TestCase):
    def test_payment_roundtrip(self):
        pay = annual_payment(30000, 4.0, 30)
        self.assertAlmostEqual(principal_for_payment(pay, 4.0, 30), 30000, places=3)
        self.assertAlmostEqual(remaining_balance(30000, 4.0, 30, 30), 0, places=3)
        self.assertAlmostEqual(remaining_balance(30000, 4.0, 30, 0), 30000, places=3)

    def test_acquisition_tax_brackets(self):
        def rate(price, homes=0, regulated=False, **buyer):
            c = from_dict(base(price={"asking": price}, buyer={"owned_homes": homes, **buyer}))
            return acquisition_tax(c, RULES, regulated).rate
        self.assertEqual(rate(50000), 1.0)
        self.assertEqual(rate(75000), 2.0)          # 6~9억 선형: 7.5억 → 2%
        self.assertEqual(rate(100000), 3.0)
        self.assertEqual(rate(50000, homes=1, regulated=True), 8.0)
        self.assertEqual(rate(50000, homes=1, regulated=True, will_sell_existing=True), 1.0)
        self.assertEqual(rate(50000, homes=1, regulated=False), 1.0)
        self.assertEqual(rate(50000, homes=2, regulated=False), 8.0)
        self.assertEqual(rate(50000, homes=2, regulated=True), 12.0)

    def test_first_time_reduction(self):
        c = from_dict(base(buyer={"first_time_buyer": True}))
        self.assertEqual(acquisition_tax(c, RULES, False).reduction, 200)

    def test_capital_loan_cap_and_multi_home_block(self):
        rep = analyze(base(region={"sido": "서울", "sigungu": "마포구"},
                           price={"asking": 200000}, buyer={"cash": 200000, "annual_income": 50000}))
        self.assertEqual(rep.funding.loan.by_cap, 40000)
        self.assertEqual(rep.funding.loan.max_loan, 40000)
        rep = analyze(base(buyer={"owned_homes": 2, "cash": 60000}))
        self.assertEqual(rep.funding.loan.max_loan, 0)

    def test_capital_non_resident_cannot_borrow(self):
        rep = analyze(base(purpose="투자", location={"subway_walk_min": 5},
                           price={"recent_trades": [50000], "jeonse": 30000},
                           timing={"holding_years": 5}))
        self.assertEqual(rep.funding.loan.max_loan, 0)
        self.assertIn("전입", rep.funding.loan.blocked_reason)

    def test_shortfall_blocks(self):
        rep = analyze(base(buyer={"cash": 1000}))
        self.assertEqual(rep.verdict, "불가")
        self.assertLess(rep.funding.surplus, 0)


class TestRegulationAndRecon(unittest.TestCase):
    def test_gap_in_land_permit_zone_blocked(self):
        rep = analyze(json.loads((EXAMPLES / "recon_gap_seoul.json").read_text()))
        self.assertEqual(rep.verdict, "불가")
        msgs = " ".join(f.message for f in rep.flags if f.level == "차단")
        self.assertIn("토지거래허가구역", msgs)
        self.assertIn("조합원 지위", msgs)

    def test_transfer_exception(self):
        d = json.loads((EXAMPLES / "recon_gap_seoul.json").read_text())
        d["reconstruction"]["owner_lived_years"] = 5
        rep = analyze(d)
        self.assertFalse(rep.recon.transfer_blocked)

    def test_live_in_recon_uses_relocation_loan(self):
        rep = analyze(json.loads((EXAMPLES / "recon_live_seoul.json").read_text()))
        r = rep.recon
        self.assertGreater(r.years_until_relocation, 0)
        self.assertLess(r.loan_balance_at_relocation, rep.funding.loan_used)
        # 임시거주 보증금 − (이주비 − 잔액)
        self.assertEqual(r.cash_needed_at_relocation,
                         28000 - (r.relocation_loan - r.loan_balance_at_relocation))
        self.assertNotIn("불가", rep.verdict)

    def test_all_examples_run(self):
        for p in EXAMPLES.glob("*.json"):
            analyze(json.loads(p.read_text()))


if __name__ == "__main__":
    unittest.main()
