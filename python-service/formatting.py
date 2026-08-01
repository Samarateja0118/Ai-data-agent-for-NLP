def _trim_number(value: float, decimals: int = 2) -> str:
    text = f"{value:,.{decimals}f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def format_value(value: float | None, fmt: str = "number") -> str:
    if value is None:
        return "N/A"

    if fmt == "currency":
        return f"${value:,.2f}"

    if fmt == "percent":
        return f"{_trim_number(value)}%"

    return _trim_number(value)
