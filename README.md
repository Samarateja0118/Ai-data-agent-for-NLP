# CSV Analyst Chat

A React frontend + Python (FastAPI/pandas) backend that lets you upload a CSV and ask
analyst-style questions about it in plain English. An OpenAI-powered planner turns each
question into a structured query — not raw code, not free-text guessing — which is
validated against the dataset's real schema and then executed with pandas.

## How a question turns into an answer

```
question + schema summary + last 3 turns
        │
        ▼
  OpenAI (structured-output "query plan":
  operation, column, groupByColumn, aggregation, filters[], ...)
        │
        ▼
  guardrails.py — reject/self-correct plans that reference columns
  that don't exist or apply the wrong operator to the wrong type
  (one retry with the validation error fed back to the model)
        │
        ▼
  execute.py — pandas groupby/agg/boolean-mask execution against
  the real DataFrame, formatted into a response + a tool-trace timeline
```

The model never sees the raw rows — only column names, types, a few sample values, and
summary stats. That keeps the prompt small regardless of dataset size and is the
"retrieval" in this pipeline: only the relevant *schema segment* is retrieved into
context, not the dataset itself. Conversation history (last 3 turns) is included so
follow-ups like *"now break that down by channel"* resolve without repeating the metric.

## What it does

After uploading a CSV, the app can:

- detect the delimiter automatically
- infer numeric vs categorical columns (client-side, instant, for the dashboard)
- calculate missing values, averages, medians, mins, maxes, and totals
- generate a trend chart and category breakdown from the parsed columns
- answer open-ended questions via the LLM + pandas pipeline, including:
  - `Summarize this dataset`
  - `What is the average revenue?`
  - `Show total sales by region`
  - `Show rows where Region equals North America` (filtering — new; the old rule-based
    version couldn't do this at all)
  - `Now break that down by channel` (multi-turn follow-up)

It also includes a built-in demo dataset so anyone visiting the project can try it
without preparing a file first (as long as the backend is running with a configured
`OPENAI_API_KEY` — see below).

## Tech stack

- React, Vite, JavaScript (dashboard + chat UI, client-side CSV parsing for the
  instant-feedback panels)
- Python, FastAPI, pandas (query planning + execution engine)
- OpenAI API (structured outputs via `response_format: json_schema`)

## Run locally

Two processes: the Vite frontend and the Python query engine.

```bash
# frontend
npm install
npm run dev

# backend (separate terminal)
cd python-service
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in OPENAI_API_KEY
uvicorn main:app --reload --port 8000
```

The frontend reads `VITE_API_BASE_URL` (defaults to `http://localhost:8000`, see `.env.example`).

There is no rule-based fallback: if `python-service` isn't running or the API key isn't
configured, the chat surfaces an honest error instead of silently answering with a
weaker engine. The dashboard panels (metrics, trend chart, category breakdown, preview
table) are all computed client-side and keep working regardless.

## Evaluating the pipeline

```bash
npm run benchmark
```

Runs 12 known questions plus one multi-turn follow-up against a live `python-service`
instance and checks both "well-formed" (right operation, non-empty response) and
"logically correct" (right numeric value, within tolerance, since pandas floats may
round slightly differently than exact string matches). Requires the backend to be
running first.

## Guardrails

`guardrails.py` resolves every column name the model returns against the dataset's
actual schema (case-insensitive match), rejects operations paired with the wrong column
type (e.g. aggregating a text column, or a numeric comparison filter on a text column),
and clamps result limits. On a validation failure, the error is fed back to the model
for one self-correction attempt before falling back to a clarification message — never
a raw error or a hallucinated column reference.

## Project structure

```text
public/
  demo-retail-data.csv       Built-in demo CSV

src/
  App.jsx                    Main UI, state management, calls the backend for chat
  main.jsx                   React entry point
  styles.css                 Styling and responsive layout
  lib/
    csvUtils.js               Client-side CSV parsing/typing/profiling (dashboard only)
    analysisEngine.js         Starter-prompt suggestions
    queryClient.js             Fetch wrappers for /api/dataset and /api/query

python-service/
  main.py                     FastAPI app, in-memory dataset cache, the two routes
  dataset.py                   CSV loading + schema profiling (pandas)
  llm.py                       Prompt construction + OpenAI call
  guardrails.py                Schema/type validation + retry logic
  execute.py                   Pandas execution per operation, response formatting
  requirements.txt

scripts/
  queryBenchmark.mjs          Live integration eval against a running backend
```

## Known limitations (intentional, for a portfolio-scoped demo)

- Datasets are cached in-memory in the Python process — they don't survive a restart.
  A production version would use Redis or a similar store.
- No auth, no persistence, no deployment config — this repo is meant to be run locally.
- Retrieval is schema-based rather than embedding/vector search, which is the right
  scale for structured tabular data — a vector DB would be solving a problem this
  dataset shape doesn't have.

by samarateja
