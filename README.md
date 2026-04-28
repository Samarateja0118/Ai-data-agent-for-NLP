# MCP Data Analyst Chat App

This project is a student-friendly React + JavaScript demo of an MCP-style analyst assistant.

## What this app demonstrates

- A React chat interface
- Mock business metrics and dashboard data
- Tool-style actions such as `database.query` and `dashboard.open`
- Grounded answers based on structured data
- A visible activity trace so users can see how the answer was produced

## Why this is a strong MCP portfolio project

Real MCP apps are powerful because the model does not just "know" things. It uses tools.

In this demo, we simulate that idea by:

- reading from mock datasets
- selecting a tool flow based on the user question
- returning both a final answer and the list of tool actions used

That makes the UI feel much closer to a real tool-enabled assistant than a plain chatbot.

## Project structure

```text
src/
  App.jsx                 Main UI and state management
  main.jsx                React entry point
  styles.css              Styling and responsive layout
  data/
    mockData.js           Fake metrics, dashboards, and starter prompts
  lib/
    analysisEngine.js     Query-routing and tool-trace logic
```

## Important React ideas used here

### 1. `useState`

`useState` stores values that change over time and should update the UI.

This app uses it for:

- chat messages
- input text
- tool activity feed
- selected dashboard
- loading state

### 2. `useEffect`

`useEffect` runs side effects after React updates the screen.

Here it is used to auto-scroll the chat whenever a new message or tool event appears.

### 3. `useRef`

`useRef` stores a mutable reference to a DOM element without causing rerenders.

Here it points to the end of the chat feed so the app can scroll to it.

### 4. Controlled inputs

The text input is controlled by React state:

- the input value comes from state
- typing updates state with `onChange`

This is a very common React pattern because it gives your component full control over form behavior.

### 5. Conditional rendering

The app shows different UI depending on state:

- `Running tools...` vs `Ready`
- empty tool panel vs live tool cards

This is how React turns state into interface changes.

## Important JavaScript ideas used here

### 1. Array mapping

We use `.map()` to render lists such as:

- metric cards
- starter prompt buttons
- chat messages
- tool activity cards
- dashboard focus tags

### 2. Array sorting

We use `.sort()` on copied arrays to find:

- the fastest-growing region
- the best campaign by ROAS

### 3. String matching

The analysis engine uses `question.toLowerCase()` and `.includes()` to route the question to the right response handler.

This is a simple rule-based approach and a good first step before adding real MCP calls or LLM routing.

### 4. Async functions and `await`

`runAnalystQuery()` is async. It waits between tool events to simulate a real agent using tools over time.

This makes the interface feel alive and teaches an important frontend concept: asynchronous UI workflows.

## How the app works

1. The user submits a question.
2. `App.jsx` adds the user message to chat state.
3. `runAnalystQuery(question)` decides which analysis function to use.
4. That function returns:
   - a list of tool events
   - a grounded response
5. The UI displays the tool events.
6. The assistant answer is appended to the chat.
7. If a dashboard tool is opened, the dashboard panel updates too.

## What to improve next

- connect a real LLM API
- connect a real database through an MCP server
- add charts with a library like Recharts
- add better natural-language intent detection
- stream tool events and assistant output token by token

## Run locally

```bash
npm install
npm run dev
```

## Build for production

```bash
npm run build
```
