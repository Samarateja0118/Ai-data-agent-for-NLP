from models import QueryPlan

NUMERIC_OPERATORS = {"greater_than", "less_than", "greater_or_equal", "less_or_equal"}


def _resolve_column(name: str | None, schema: dict) -> str | None:
    if not name:
        return None
    for column in schema["columns"]:
        if column["name"] == name:
            return column["name"]
    lowered = name.strip().lower()
    for column in schema["columns"]:
        if column["name"].strip().lower() == lowered:
            return column["name"]
    return None


def _column_type(name: str, schema: dict) -> str | None:
    for column in schema["columns"]:
        if column["name"] == name:
            return column["type"]
    return None


def resolve_and_validate(plan: QueryPlan, schema: dict) -> tuple[QueryPlan | None, str | None]:
    """Resolve column names against the real schema and reject anything that doesn't fit.

    Returns (resolved_plan, None) on success or (None, error_message) so the caller can
    feed the error back to the LLM for a single self-correction retry.
    """

    if plan.clarificationNeeded:
        return plan, None

    if plan.column is not None:
        resolved = _resolve_column(plan.column, schema)
        if resolved is None:
            return None, f"Column '{plan.column}' does not exist. Valid columns: {_column_list(schema)}."
        plan.column = resolved

    if plan.groupByColumn is not None:
        resolved = _resolve_column(plan.groupByColumn, schema)
        if resolved is None:
            return None, f"Column '{plan.groupByColumn}' does not exist. Valid columns: {_column_list(schema)}."
        plan.groupByColumn = resolved

    if plan.operation == "aggregate":
        if not plan.column or not plan.aggregation:
            return None, "Aggregate operations require both 'column' and 'aggregation'."
        if _column_type(plan.column, schema) != "number":
            return None, f"'{plan.column}' is not numeric, so it can't be aggregated with {plan.aggregation}."

    if plan.operation == "group_aggregate":
        if not plan.column or not plan.groupByColumn:
            return None, "group_aggregate requires both 'column' (numeric metric) and 'groupByColumn'."
        if _column_type(plan.column, schema) != "number":
            return None, f"'{plan.column}' is not numeric, so it can't be grouped and aggregated."
        if not plan.aggregation:
            plan.aggregation = "sum"

    if plan.operation == "filter":
        if not plan.filters:
            return None, "filter operations require at least one entry in 'filters'."
        for condition in plan.filters:
            resolved = _resolve_column(condition.column, schema)
            if resolved is None:
                return None, f"Filter column '{condition.column}' does not exist. Valid columns: {_column_list(schema)}."
            condition.column = resolved
            if condition.operator in NUMERIC_OPERATORS and _column_type(resolved, schema) != "number":
                return None, (
                    f"Filter operator '{condition.operator}' needs a numeric column, "
                    f"but '{resolved}' is text."
                )

    if plan.limit is not None:
        plan.limit = max(1, min(plan.limit, 50))

    return plan, None


def _column_list(schema: dict) -> str:
    return ", ".join(c["name"] for c in schema["columns"])
