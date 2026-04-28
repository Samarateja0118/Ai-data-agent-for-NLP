# CSV Analyst Chat

A React + JavaScript app that lets you upload a CSV, inspect its schema, preview the rows, and ask analyst-style questions about the data.

This project is designed as a portfolio-ready frontend for showing:

- CSV upload and parsing in the browser
- schema inference for numeric and text columns
- lightweight dataset profiling
- chart and table generation from uploaded data
- a chat-like analysis flow with visible tool traces

## What it does

After uploading a CSV, the app can:

- detect the delimiter automatically
- infer numeric vs categorical columns
- calculate missing values, averages, medians, mins, maxes, and totals
- generate a trend chart from numeric columns
- show category breakdowns for text columns
- answer questions like:
  - `Summarize this dataset`
  - `Which columns are numeric?`
  - `What is the average revenue?`
  - `Show total sales by region`

It also includes a built-in demo dataset so anyone visiting the project can try it without preparing a file first.

## Tech stack

- React
- Vite
- JavaScript
- CSS

## Run locally

```bash
npm install
npm run dev
```

## Build for production

```bash
npm run build
```

## Project structure

```text
public/
  demo-retail-data.csv       Built-in demo CSV

src/
  App.jsx                    Main UI and state management
  main.jsx                   React entry point
  styles.css                 Styling and responsive layout
  lib/
    csvUtils.js              CSV parsing, typing, and profiling utilities
    analysisEngine.js        Question routing and dataset-aware answers
```

## Key implementation ideas

### 1. CSV parsing without a heavy library

The parser handles:

- delimiter detection
- quoted values
- duplicate header cleanup
- numeric parsing for values like currency and percentages

This makes the project easier to study because the data pipeline is visible in the code.

### 2. Schema inference

Each column is profiled to determine whether it behaves like:

- a numeric field
- a categorical/text field

For numeric columns, the app computes:

- count
- sum
- mean
- median
- min
- max

### 3. Rule-based question routing

The chat experience is currently rule-based rather than LLM-powered.

That means the app matches user questions to:

- summary requests
- row/column counts
- missing-value checks
- numeric aggregations
- grouped comparisons

This is a strong learning step before connecting a real AI backend.

### 4. SVG chart rendering

The trend chart is generated with inline SVG from parsed numeric data, which makes it easier to understand how chart coordinates are calculated from values.

## Example demo flow

1. Open the app
2. Click `Load demo dataset`
3. Ask:
   - `Summarize this dataset`
   - `What is the average revenue?`
   - `Show total revenue by region`

## Future improvements

- connect a real LLM API for deeper natural-language understanding
- support larger CSVs with pagination or worker-based parsing
- add filters and sorting for the preview table
- add downloadable summaries or chart exports
- support follow-up questions with conversational memory

## Why this is a good portfolio project

This repo shows more than just UI work. It demonstrates:

- frontend state management
- data parsing and transformation
- user-driven file workflows
- analytics-style interface design
- explainable tool-based reasoning

That makes it a strong project for frontend, product engineering, or AI-adjacent internships and roles.
