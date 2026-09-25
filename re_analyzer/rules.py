"""규제·세율 규정 로딩과 지역 판정.

규정 값은 코드가 아니라 rules/*.json 에 둔다. 정책이 바뀌면 JSON 만 교체하면 된다.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

DEFAULT_RULES = Path(__file__).parent / "rules" / "kr_default.json"


def load_rules(path: Optional[str | Path] = None) -> dict:
    with open(path or DEFAULT_RULES, encoding="utf-8") as f:
        return json.load(f)


def _in_area_table(table: dict, sido: Optional[str], sigungu: Optional[str]) -> bool:
    if not sido:
        return False
    areas = table.get(sido, [])
    if "*" in areas:
        return True
    if not sigungu:
        return False
    # "하남시" 는 "하남시 ..." 전체를 포함하지만, "성남시" 입력은 일부 구만
    # 지정돼 있으므로 일치로 보지 않는다(구까지 입력해야 판정 가능).
    sigungu = sigungu.strip()
    return any(sigungu == a or sigungu.startswith(a + " ") for a in areas)


def is_regulated(rules: dict, sido, sigungu) -> bool:
    return _in_area_table(rules["regulated_areas"], sido, sigungu)


def is_land_permit(rules: dict, sido, sigungu, property_type) -> bool:
    if property_type not in rules.get("land_permit_property_types", []):
        return False
    return _in_area_table(rules["land_permit_areas"], sido, sigungu)


def is_capital_area(rules: dict, sido) -> bool:
    return sido in rules.get("capital_area", [])


def bracket(table: list, price: float) -> dict:
    for row in table:
        if row["price_up_to"] is None or price <= row["price_up_to"]:
            return row
    return table[-1]
