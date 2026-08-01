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

The API is stateless: every `/api/query` request carries the CSV text itself and
re-profiles it with pandas, rather than caching a parsed DataFrame server-side by id.
That costs a re-parse per question (sub-millisecond at this dataset size), but means
any request can land on any server instance with no shared state required — which is
what makes it safe to run as disposable serverless functions on Vercel.

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
cd api
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in OPENAI_API_KEY
uvicorn index:app --reload --port 8000
```

The frontend reads `VITE_API_BASE_URL` (see `.env.example`) — only needed locally, where
the Vite dev server and the API run as separate processes on different origins.

There is no rule-based fallback: if the backend isn't running or the API key isn't
configured, the chat surfaces an honest error instead of silently answering with a
weaker engine. The dashboard panels (metrics, trend chart, category breakdown, preview
table) are all computed client-side and keep working regardless.

## Deploying

The whole app deploys as a single Vercel project — no separate backend host, no CORS:

1. Import this repo on [vercel.com](https://vercel.com) (New Project → this GitHub repo).
   Vercel auto-detects the Vite frontend at the root and, separately, treats `api/index.py`
   as a Python serverless function — both ship from one deployment, same origin, so
   `VITE_API_BASE_URL` can stay unset in production (the client falls back to relative
   `/api/*` requests). `vercel.json` rewrites every `/api/*` request to that one function —
   without it, Vercel's filesystem routing only maps `api/index.py` to the literal path
   `/api`, and FastAPI's own internal routes (`/api/health`, `/api/dataset`, `/api/query`)
   would all 404.
2. Set `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`) in the project's Environment
   Variables.
3. Under Settings → Deployment Protection, make sure Production isn't gated behind
   Vercel SSO — otherwise visitors without a Vercel login hit a sign-in wall instead of
   the demo.
4. Deploy. Check `/api/health` on the deployed URL, then try the demo dataset.

This is the same pattern the `movie-mcp-server` project in this portfolio uses for its
FastAPI backend, and it's why the API had to be made stateless first: Vercel Python
functions are disposable per-invocation, so a server-side cache keyed by an id from a
previous request isn't guaranteed to be there on the next one.

## Evaluating the pipeline

```bash
npm run benchmark
```

Runs 12 known questions plus one multi-turn follow-up against a live backend and checks
both "well-formed" (right operation, non-empty response) and "logically correct" (right
numeric value, within tolerance, since pandas floats may round slightly differently than
exact string matches). Requires the backend to be running first — set `API_BASE_URL` to
point at it if it's not on `http://localhost:8000`.

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

api/
  index.py                    FastAPI app + entrypoint Vercel's Python runtime detects
  dataset.py                   CSV loading + schema profiling (pandas), stateless
  llm.py                       Prompt construction + OpenAI call
  guardrails.py                Schema/type validation + retry logic
  execute.py                   Pandas execution per operation, response formatting
  requirements.txt

scripts/
  queryBenchmark.mjs          Live integration eval against a running backend
```

## Known limitations (intentional, for a portfolio-scoped demo)

- No auth, no persistence — every request re-parses the CSV it's given rather than
  reading from a database.
- Retrieval is schema-based rather than embedding/vector search, which is the right
  scale for structured tabular data — a vector DB would be solving a problem this
  dataset shape doesn't have.

by samarateja
