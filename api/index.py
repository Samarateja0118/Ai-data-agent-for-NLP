import os
import sys
from pathlib import Path

# Vercel's Python runtime loads this file via importlib without adding its own
# directory to sys.path, so the sibling-module imports below need it added explicitly
# (this is a no-op locally, where uvicorn already runs with cwd=api/).
sys.path.insert(0, str(Path(__file__).resolve().parent))

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

import dataset
import execute
import guardrails
import llm
from models import DatasetUploadRequest, DatasetUploadResponse, QueryPlan, QueryRequest, QueryResponse

load_dotenv()

app = FastAPI(title="CSV Analyst Chat — Query Engine")

allowed_origin = os.environ.get("CORS_ORIGIN", "http://localhost:5173")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[allowed_origin],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/dataset", response_model=DatasetUploadResponse)
def upload_dataset(payload: DatasetUploadRequest):
    try:
        _df, schema = dataset.profile_from_csv(payload.name, payload.csvText)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return {"schema": schema}


@app.post("/api/query", response_model=QueryResponse)
def run_query(payload: QueryRequest):
    try:
        df, schema = dataset.profile_from_csv(payload.name, payload.csvText)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    history = [turn.model_dump() for turn in payload.history]

    try:
        plan = _plan_with_one_retry(schema, history, payload.question)
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error

    if plan.clarificationNeeded:
        return QueryResponse(
            response=plan.clarificationMessage or "Could you rephrase that question?",
            toolEvents=[
                {
                    "type": "llm.parse_intent",
                    "label": "Parse question with OpenAI",
                    "detail": "The question didn't map cleanly to a supported query.",
                }
            ],
            focus=None,
        )

    response_text, tool_events, focus = execute.execute_plan(df, schema, plan)
    return QueryResponse(response=response_text, toolEvents=tool_events, focus=focus)


def _plan_with_one_retry(schema: dict, history: list[dict], question: str) -> QueryPlan:
    raw_plan = llm.get_query_plan(schema, history, question)
    plan, error = _validate_raw_plan(raw_plan, schema)

    if plan is not None:
        return plan

    raw_plan = llm.get_query_plan(schema, history, question, retry_error=error)
    plan, error = _validate_raw_plan(raw_plan, schema)

    if plan is not None:
        return plan

    return QueryPlan(
        operation="overview",
        clarificationNeeded=True,
        clarificationMessage=(
            f"I couldn't map that to a valid query ({error}). Try asking about a specific column, "
            "an average/total, or a breakdown by category."
        ),
    )


def _validate_raw_plan(raw_plan: dict, schema: dict) -> tuple[QueryPlan | None, str | None]:
    try:
        plan = QueryPlan(**raw_plan)
    except ValidationError as error:
        return None, str(error)

    return guardrails.resolve_and_validate(plan, schema)
