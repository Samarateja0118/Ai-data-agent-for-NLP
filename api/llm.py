import json
import os

import httpx

QUERY_PLAN_JSON_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "operation": {
            "type": "string",
            "enum": [
                "overview",
                "list_columns",
                "row_count",
                "missing_values",
                "preview",
                "aggregate",
                "group_aggregate",
                "filter",
            ],
        },
        "column": {"type": ["string", "null"]},
        "columnTypeFilter": {"type": ["string", "null"], "enum": ["number", "string", "all", None]},
        "groupByColumn": {"type": ["string", "null"]},
        "aggregation": {
            "type": ["string", "null"],
            "enum": ["mean", "sum", "median", "min", "max", "count", None],
        },
        "filters": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "column": {"type": "string"},
                    "operator": {
                        "type": "string",
                        "enum": [
                            "equals",
                            "not_equals",
                            "greater_than",
                            "less_than",
                            "greater_or_equal",
                            "less_or_equal",
                            "contains",
                        ],
                    },
                    "value": {"type": "string"},
                },
                "required": ["column", "operator", "value"],
            },
        },
        "limit": {"type": ["integer", "null"]},
        "clarificationNeeded": {"type": "boolean"},
        "clarificationMessage": {"type": ["string", "null"]},
    },
    "required": [
        "operation",
        "column",
        "columnTypeFilter",
        "groupByColumn",
        "aggregation",
        "filters",
        "limit",
        "clarificationNeeded",
        "clarificationMessage",
    ],
}


def _truncate(value: str, max_len: int = 40) -> str:
    text = str(value).replace("\n", " ").replace("\r", " ").strip()
    return text if len(text) <= max_len else text[: max_len - 1] + "…"


def _describe_column(column: dict) -> str:
    samples = ", ".join(_truncate(v) for v in column.get("sampleValues", []))
    if column["type"] == "number":
        stats = column["stats"]
        return (
            f"- {column['name']} (numeric, format={column.get('format', 'number')}): "
            f"min={stats['min']}, max={stats['max']}, mean={round(stats['mean'], 2)}, "
            f"missing={column['missingCount']}, samples=[{samples}]"
        )
    return (
        f"- {column['name']} (text): unique={column['uniqueCount']}, "
        f"missing={column['missingCount']}, samples=[{samples}]"
    )


def build_prompt(schema: dict, history: list[dict], question: str, retry_error: str | None = None) -> str:
    schema_lines = "\n".join(_describe_column(c) for c in schema["columns"])
    history_lines = "\n".join(f"{turn['role']}: {turn['content']}" for turn in history[-6:]) or "(none yet)"

    parts = [
        "You are a data analyst assistant. You translate a user's natural-language question about an "
        "uploaded CSV dataset into a single structured query plan. You never see the raw rows — only the "
        "schema below — so you must only reference columns that are listed.",
        f"Dataset: {schema['name']} ({schema['rowCount']} rows, {schema['columnCount']} columns)",
        f"Columns:\n{schema_lines}",
        f"Recent conversation (use it to resolve follow-up questions like 'now break that down by region'):\n{history_lines}",
        f"Current question: {question}",
        "Rules:",
        "- Only use column names exactly as listed above.",
        "- Use operation 'aggregate' for a single-column stat (mean/sum/median/min/max/count).",
        "- Use 'group_aggregate' when the question asks for a breakdown 'by' or 'per' some category "
        "(set column=the numeric metric, groupByColumn=the category, aggregation=mean or sum).",
        "- Use 'filter' when the question asks to see/list/show rows matching a condition; populate filters[].",
        "- Use 'list_columns' for schema questions; set columnTypeFilter to narrow to number/string/all.",
        "- If the question is ambiguous or cannot be mapped to the schema, set clarificationNeeded=true and "
        "write a short clarificationMessage suggesting a valid rephrasing.",
        "- Always return every field in the schema, using null for fields that do not apply.",
    ]

    if retry_error:
        parts.append(
            f"Your previous answer was invalid: {retry_error}. Correct it and return a valid plan."
        )

    return "\n\n".join(parts)


def call_openai(prompt: str) -> dict:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured on the server.")

    model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    base_url = os.environ.get("AI_BASE_URL", "https://api.openai.com/v1")

    response = httpx.post(
        f"{base_url}/chat/completions",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        json={
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "query_plan",
                    "strict": True,
                    "schema": QUERY_PLAN_JSON_SCHEMA,
                },
            },
        },
        timeout=30.0,
    )

    if response.status_code != 200:
        raise RuntimeError(f"AI request failed: {response.text}")

    payload = response.json()
    text = payload.get("choices", [{}])[0].get("message", {}).get("content")

    if not text:
        raise RuntimeError("AI response did not include structured output.")

    return json.loads(text)


def get_query_plan(schema: dict, history: list[dict], question: str, retry_error: str | None = None) -> dict:
    prompt = build_prompt(schema, history, question, retry_error)
    return call_openai(prompt)
