import io
import re
import uuid

import pandas as pd

DATASETS: dict[str, pd.DataFrame] = {}
DATASET_META: dict[str, dict] = {}

_PERCENT_RE = re.compile(r"%")
_CURRENCY_RE = re.compile(r"[$€£¥]")


def load_dataframe(csv_text: str) -> pd.DataFrame:
    df = pd.read_csv(io.StringIO(csv_text), sep=None, engine="python", dtype=str)
    df.columns = _ensure_unique_headers([str(c).strip() or f"Column {i + 1}" for i, c in enumerate(df.columns)])
    df = df.fillna("")
    return df


def _ensure_unique_headers(headers: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    result = []
    for header in headers:
        count = seen.get(header, 0)
        seen[header] = count + 1
        result.append(header if count == 0 else f"{header} {count + 1}")
    return result


def parse_numeric(raw: object) -> float | None:
    if raw is None:
        return None
    value = str(raw).strip()
    if not value:
        return None

    negative = False
    if value.startswith("(") and value.endswith(")"):
        negative = True
        value = value[1:-1]

    value = re.sub(r"[$€£¥,]", "", value)
    value = re.sub(r"\s+", "", value)
    if value.endswith("%"):
        value = value[:-1]

    if not re.match(r"^[-+]?\d*\.?\d+$", value):
        return None

    try:
        parsed = float(value)
    except ValueError:
        return None

    return -parsed if negative else parsed


def _infer_format(values: list[str]) -> str:
    non_empty = [v for v in values if str(v).strip() != ""]
    if not non_empty:
        return "number"

    percent_count = sum(1 for v in non_empty if _PERCENT_RE.search(str(v)))
    currency_count = sum(1 for v in non_empty if _CURRENCY_RE.search(str(v)))

    if percent_count / len(non_empty) >= 0.5:
        return "percent"
    if currency_count / len(non_empty) >= 0.4:
        return "currency"
    return "number"


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    sorted_values = sorted(values)
    mid = len(sorted_values) // 2
    if len(sorted_values) % 2 == 0:
        return (sorted_values[mid - 1] + sorted_values[mid]) / 2
    return sorted_values[mid]


def _profile_column(name: str, raw_values: list[str]) -> dict:
    trimmed = [str(v).strip() for v in raw_values]
    missing_count = sum(1 for v in trimmed if v == "")
    non_empty = [v for v in trimmed if v != ""]
    numeric_values = [n for n in (parse_numeric(v) for v in non_empty) if n is not None]
    unique_count = len(set(non_empty))
    sample_values = list(dict.fromkeys(non_empty))[:3]
    is_numeric = len(non_empty) > 0 and len(numeric_values) / max(len(non_empty), 1) >= 0.8

    if not is_numeric:
        return {
            "name": name,
            "type": "string",
            "missingCount": missing_count,
            "uniqueCount": unique_count,
            "sampleValues": sample_values,
        }

    total = sum(numeric_values)
    return {
        "name": name,
        "type": "number",
        "format": _infer_format(non_empty),
        "missingCount": missing_count,
        "uniqueCount": unique_count,
        "sampleValues": sample_values,
        "stats": {
            "count": len(numeric_values),
            "sum": total,
            "min": min(numeric_values),
            "max": max(numeric_values),
            "mean": total / len(numeric_values),
            "median": _median(numeric_values),
        },
    }


def profile_schema(name: str, df: pd.DataFrame) -> dict:
    columns = [_profile_column(col, df[col].tolist()) for col in df.columns]
    numeric_columns = [c for c in columns if c["type"] == "number"]
    categorical_columns = [c for c in columns if c["type"] != "number"]
    missing_cells = sum(c["missingCount"] for c in columns)
    row_count = len(df)

    label_column = next(
        (c for c in categorical_columns if c["uniqueCount"] >= min(row_count, 3)),
        categorical_columns[0] if categorical_columns else (columns[0] if columns else None),
    )

    return {
        "name": name,
        "rowCount": row_count,
        "columnCount": len(columns),
        "missingCells": missing_cells,
        "columns": columns,
        "numericColumns": numeric_columns,
        "categoricalColumns": categorical_columns,
        "labelColumnName": label_column["name"] if label_column else (columns[0]["name"] if columns else None),
    }


def register_dataset(name: str, csv_text: str) -> tuple[str, dict]:
    if len(csv_text.encode("utf-8")) > 8 * 1024 * 1024:
        raise ValueError("CSV file is too large (max 8MB).")

    df = load_dataframe(csv_text)
    if df.shape[0] < 1 or df.shape[1] < 1:
        raise ValueError("The CSV needs a header row and at least one data row.")

    dataset_id = str(uuid.uuid4())
    schema = profile_schema(name, df)
    DATASETS[dataset_id] = df
    DATASET_META[dataset_id] = schema
    return dataset_id, schema


def get_dataset(dataset_id: str) -> tuple[pd.DataFrame, dict]:
    if dataset_id not in DATASETS:
        raise KeyError(dataset_id)
    return DATASETS[dataset_id], DATASET_META[dataset_id]
