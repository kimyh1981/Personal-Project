"""사용법:
    python -m re_analyzer 입력.json [--rules 규정.json] [--json]
    python -m re_analyzer --checklist
"""
import argparse
import json
import sys

from .analyzer import analyze
from .report import checklist, to_json, to_text
from .rules import load_rules


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="re_analyzer", description="부동산 투자·거주 분석기")
    p.add_argument("input", nargs="?", help="분석 조건 JSON 파일")
    p.add_argument("--rules", help="규정 JSON (기본: rules/kr_default.json)")
    p.add_argument("--json", action="store_true", help="JSON 으로 출력")
    p.add_argument("--checklist", action="store_true", help="필수 조건 목록 출력")
    a = p.parse_args(argv)

    if a.checklist:
        print(checklist())
        return 0
    if not a.input:
        p.error("입력 JSON 파일을 지정하세요 (또는 --checklist)")

    with open(a.input, encoding="utf-8") as f:
        data = json.load(f)
    rep = analyze(data, load_rules(a.rules))
    print(to_json(rep) if a.json else to_text(rep))
    return {"진행가능": 0, "조건부": 0, "불가": 1, "입력보완필요": 2}[rep.verdict]


if __name__ == "__main__":
    sys.exit(main())
