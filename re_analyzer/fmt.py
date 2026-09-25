"""금액 표기."""


def won(v) -> str:
    """만원 단위 정수 → '12억 3,400만원'."""
    if v is None:
        return "-"
    v = int(round(v))
    sign = "-" if v < 0 else ""
    v = abs(v)
    eok, man = divmod(v, 10000)
    if eok and man:
        return f"{sign}{eok}억 {man:,}만원"
    if eok:
        return f"{sign}{eok}억원"
    return f"{sign}{man:,}만원"
