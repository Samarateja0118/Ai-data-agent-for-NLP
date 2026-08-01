import pandas as pd

from dataset import parse_numeric
from formatting import format_value
from models import QueryPlan

AGGREGATION_LABELS = {"mean": "average", "sum": "sum", "median": "median", "min": "min", "max": "max", "count": "count"}
GROUP_AGGREGATION_LABELS = {"mean": "average", "sum": "total"}


def _column_meta(schema: dict, name: str) -> dict:
    return next(c for c in schema["columns"] if c["name"] == name)


def _numeric_series(df: pd.DataFrame, column: str) -> pd.Series:
    return df[column].map(parse_numeric)


def _base_events(plan: QueryPlan) -> list[dict]:
    return [
        {
            "type": "llm.parse_intent",
            "label": "Parse question with OpenAI",
            "detail": f"Mapped the question to a '{plan.operation}' query plan.",
        },
        {
            "type": "schema.validate",
            "label": "Validate against schema",
            "detail": "Checked requested columns and types against the uploaded dataset.",
        },
    ]


def _row_label(df: pd.DataFrame, schema: dict, row_index: int) -> str:
    label_column = schema.get("labelColumnName")
    if label_column and label_column in df.columns:
        value = df.iloc[row_index][label_column]
        if str(value).strip():
            return str(value)
    return f"Row {row_index + 1}"


def _preview_lines(df: pd.DataFrame, schema: dict, rows: pd.DataFrame, max_cols: int = 4) -> list[str]:
    columns = [c["name"] for c in schema["columns"][:max_cols]]
    lines = []
    for position, (_, row) in enumerate(rows.iterrows()):
        pairs = ", ".join(f"{col}: {row[col] or 'blank'}" for col in columns)
        lines.append(f"Row {position + 1}: {pairs}")
    return lines


def execute_overview(df: pd.DataFrame, schema: dict, plan: QueryPlan):
    numeric_names = [c["name"] for c in schema["numericColumns"][:3]]
    numeric_summary = (
        f"Numeric columns include {', '.join(numeric_names)}."
        if numeric_names
        else "There are no strongly numeric columns in this file."
    )
    missing_sorted = sorted(
        (c for c in schema["columns"] if c["missingCount"] > 0),
        key=lambda c: c["missingCount"],
        reverse=True,
    )
    missing_summary = (
        f"The most incomplete column is {missing_sorted[0]['name']} with {missing_sorted[0]['missingCount']} missing values."
        if missing_sorted
        else "There are no missing values in the dataset."
    )
    response = (
        f"{schema['name']} contains {schema['rowCount']:,} rows and {schema['columnCount']} columns. "
        f"{numeric_summary} {missing_summary}"
    )
    events = _base_events(plan) + [
        {"type": "profile.generate", "label": "Generate dataset summary", "detail": "Profiling numeric and categorical columns."}
    ]
    return response, events, None


def execute_list_columns(df: pd.DataFrame, schema: dict, plan: QueryPlan):
    type_filter = plan.columnTypeFilter or "all"
    if type_filter == "number":
        columns = schema["numericColumns"]
        label = "numeric"
    elif type_filter == "string":
        columns = schema["categoricalColumns"]
        label = "categorical"
    else:
        columns = schema["columns"]
        label = "available"

    if columns:
        names = ", ".join(f"{c['name']}{' (numeric)' if c['type'] == 'number' else ''}" for c in columns)
        response = f"The {label} columns are: {names}."
    else:
        response = f"I could not find any {label} columns in this dataset."

    events = _base_events(plan) + [
        {"type": "schema.inspect", "label": "Read column definitions", "detail": f"Listing {label} columns from the uploaded CSV."}
    ]
    return response, events, None


def execute_row_count(df: pd.DataFrame, schema: dict, plan: QueryPlan):
    response = f"This file has {schema['rowCount']:,} rows and {schema['columnCount']} columns."
    events = _base_events(plan) + [
        {"type": "table.scan", "label": "Count dataset rows", "detail": "Reviewing row and column totals."}
    ]
    return response, events, None


def execute_missing_values(df: pd.DataFrame, schema: dict, plan: QueryPlan):
    if schema["missingCells"] == 0:
        response = "There are no missing values in this dataset."
    else:
        top = sorted(
            (c for c in schema["columns"] if c["missingCount"] > 0),
            key=lambda c: c["missingCount"],
            reverse=True,
        )[:3]
        names = ", ".join(f"{c['name']} ({c['missingCount']})" for c in top)
        response = f"The dataset has {schema['missingCells']:,} missing cells. The highest-missing columns are {names}."

    events = _base_events(plan) + [
        {"type": "data.quality", "label": "Check missing values", "detail": "Counting blank cells by column."}
    ]
    return response, events, None


def execute_preview(df: pd.DataFrame, schema: dict, plan: QueryPlan):
    rows = df.head(3)
    response = " ".join(_preview_lines(df, schema, rows))
    events = _base_events(plan) + [
        {"type": "table.preview", "label": "Preview sample rows", "detail": "Reading the first few rows of the CSV."}
    ]
    return response, events, None


def execute_aggregate(df: pd.DataFrame, schema: dict, plan: QueryPlan):
    column = plan.column
    meta = _column_meta(schema, column)
    values = _numeric_series(df, column).dropna()
    op = plan.aggregation

    events = _base_events(plan) + [
        {"type": "schema.inspect", "label": f"Resolve column: {column}", "detail": "Matching the question to a numeric field."}
    ]

    if op in ("max", "min"):
        idx = values.idxmax() if op == "max" else values.idxmin()
        label = _row_label(df, schema, df.index.get_loc(idx))
        word = "highest" if op == "max" else "lowest"
        response = f"The {word} {column} is {format_value(values[idx], meta.get('format'))} in {label}."
        events.append(
            {
                "type": f"pandas.{op}",
                "label": f"Find {word} in {column}",
                "detail": f"Scanned {len(values)} numeric values with pandas.",
            }
        )
        return response, events, {"chartColumn": column}

    stat_value = {
        "mean": values.mean,
        "sum": values.sum,
        "median": values.median,
        "count": values.count,
    }[op]()

    word = AGGREGATION_LABELS[op]
    response = f"The {word} {column} is {format_value(stat_value, meta.get('format') if op != 'count' else 'number')}."
    events.append(
        {"type": f"pandas.{op}", "label": f"Compute {op} for {column}", "detail": f"Ran df['{column}'].{op}() over {len(values)} values."}
    )
    return response, events, {"chartColumn": column}


def execute_group_aggregate(df: pd.DataFrame, schema: dict, plan: QueryPlan):
    column = plan.column
    group_by = plan.groupByColumn
    meta = _column_meta(schema, column)
    op = plan.aggregation if plan.aggregation in ("mean", "sum") else "sum"

    working = df[[group_by]].copy()
    working["__value__"] = _numeric_series(df, column)
    working = working.dropna(subset=["__value__"])

    grouped = working.groupby(group_by)["__value__"].agg(op).sort_values(ascending=False)

    events = _base_events(plan) + [
        {
            "type": "group.aggregate",
            "label": f"Aggregate {column} by {group_by}",
            "detail": f"Ran df.groupby('{group_by}')['{column}'].{op}() across grouped categories.",
        }
    ]

    if grouped.empty:
        return f"I couldn't find numeric values for {column} to group by {group_by}.", events, None

    word = GROUP_AGGREGATION_LABELS.get(op, "total")
    top_label = grouped.index[0]
    top_value = grouped.iloc[0]
    top_three = ", ".join(f"{label} ({format_value(value, meta.get('format'))})" for label, value in grouped.head(3).items())

    response = (
        f"Grouped by {group_by}, {top_label} has the highest {word} {column} at "
        f"{format_value(top_value, meta.get('format'))}. The top groups are {top_three}."
    )
    return response, events, {"chartColumn": column, "categoryColumn": group_by}


def _filter_mask(df: pd.DataFrame, schema: dict, condition) -> pd.Series:
    column_type = _column_meta(schema, condition.column)["type"]

    if condition.operator in ("greater_than", "less_than", "greater_or_equal", "less_or_equal"):
        series = _numeric_series(df, condition.column)
        target = parse_numeric(condition.value)
        if condition.operator == "greater_than":
            return series > target
        if condition.operator == "less_than":
            return series < target
        if condition.operator == "greater_or_equal":
            return series >= target
        return series <= target

    series = df[condition.column].astype(str).str.strip().str.lower()
    target = str(condition.value).strip().lower()

    if condition.operator == "equals":
        return series == target
    if condition.operator == "not_equals":
        return series != target
    return series.str.contains(target, na=False)


def _describe_filters(filters) -> str:
    words = {
        "equals": "equals",
        "not_equals": "does not equal",
        "greater_than": "is greater than",
        "less_than": "is less than",
        "greater_or_equal": "is at least",
        "less_or_equal": "is at most",
        "contains": "contains",
    }
    return " and ".join(f"{f.column} {words[f.operator]} {f.value}" for f in filters)


def execute_filter(df: pd.DataFrame, schema: dict, plan: QueryPlan):
    mask = pd.Series(True, index=df.index)
    for condition in plan.filters:
        mask &= _filter_mask(df, schema, condition)

    matched = df[mask]
    limit = plan.limit or 5
    description = _describe_filters(plan.filters)

    events = _base_events(plan) + [
        {
            "type": "filter.apply",
            "label": "Filter rows",
            "detail": f"Applied a pandas boolean mask for: {description}.",
        }
    ]

    if matched.empty:
        return f"No rows matched where {description}.", events, None

    lines = _preview_lines(df, schema, matched.head(limit))
    response = f"Found {len(matched):,} matching rows where {description}. {' '.join(lines)}"
    return response, events, None


HANDLERS = {
    "overview": execute_overview,
    "list_columns": execute_list_columns,
    "row_count": execute_row_count,
    "missing_values": execute_missing_values,
    "preview": execute_preview,
    "aggregate": execute_aggregate,
    "group_aggregate": execute_group_aggregate,
    "filter": execute_filter,
}


def execute_plan(df: pd.DataFrame, schema: dict, plan: QueryPlan):
    handler = HANDLERS[plan.operation]
    return handler(df, schema, plan)
