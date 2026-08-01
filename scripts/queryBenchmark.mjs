import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8000';
const datasetPath = path.resolve(__dirname, '../public/demo-retail-data.csv');
const csvText = fs.readFileSync(datasetPath, 'utf8');

async function post(pathname, body) {
  const response = await fetch(`${API_BASE_URL}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${pathname} failed (${response.status}): ${text}`);
  }

  return response.json();
}

const cases = [
  {
    query: 'Summarize this dataset',
    expectedLastEvent: 'profile.generate',
    validate: (response) =>
      response.includes('11 rows and 7 columns') &&
      response.includes('Revenue, Orders, ConversionRate') &&
      response.includes('no missing values')
  },
  {
    query: 'Which columns are numeric?',
    expectedLastEvent: 'schema.inspect',
    validate: (response) =>
      response.includes('Revenue (numeric)') &&
      response.includes('Orders (numeric)') &&
      response.includes('ConversionRate (numeric)') &&
      response.includes('ReturningCustomers (numeric)')
  },
  {
    query: 'How many rows are there?',
    expectedLastEvent: 'table.scan',
    validate: (response) => response.includes('11 rows and 7 columns')
  },
  {
    query: 'Are there missing values?',
    expectedLastEvent: 'data.quality',
    validate: (response) => response.includes('There are no missing values')
  },
  {
    query: 'Show me sample rows',
    expectedLastEvent: 'table.preview',
    validate: (response) =>
      response.includes('Row 1: Month: January') && response.includes('Row 3: Month: March')
  },
  {
    query: 'What is the average revenue?',
    expectedLastEvent: 'pandas.mean',
    validate: (response) => containsNumberNear(response, 109454.55)
  },
  {
    query: 'What is the total revenue?',
    expectedLastEvent: 'pandas.sum',
    validate: (response) => containsNumberNear(response, 1204000)
  },
  {
    query: 'What is the median orders?',
    expectedLastEvent: 'pandas.median',
    validate: (response) => containsNumberNear(response, 1612)
  },
  {
    query: 'What is the highest revenue?',
    expectedLastEvent: 'pandas.max',
    validate: (response) => containsNumberNear(response, 128400) && response.includes('November')
  },
  {
    query: 'What is the lowest orders?',
    expectedLastEvent: 'pandas.min',
    validate: (response) => containsNumberNear(response, 1204) && response.includes('January')
  },
  {
    query: 'Show total revenue by region',
    expectedLastEvent: 'group.aggregate',
    validate: (response) => response.includes('North America') && containsNumberNear(response, 420600)
  },
  {
    query: 'Show average orders by channel',
    expectedLastEvent: 'group.aggregate',
    validate: (response) => response.includes('Display') && containsNumberNear(response, 1638.5)
  },
  {
    query: 'Show rows where Region equals North America',
    expectedLastEvent: 'filter.apply',
    validate: (response) => response.includes('North America') && /Found \d+ matching rows/.test(response)
  }
];

function containsNumberNear(text, expected, tolerance = 1) {
  const matches = text.match(/-?\d[\d,]*\.?\d*/g) || [];
  return matches.some((match) => Math.abs(parseFloat(match.replace(/,/g, '')) - expected) <= tolerance);
}

function isWellFormed(result, expectedLastEvent) {
  if (!result || typeof result.response !== 'string' || result.response.trim().length === 0) {
    return false;
  }

  if (!Array.isArray(result.toolEvents) || result.toolEvents.length === 0) {
    return false;
  }

  return result.toolEvents[result.toolEvents.length - 1]?.type === expectedLastEvent;
}

async function main() {
  const { datasetId } = await post('/api/dataset', {
    name: 'demo-retail-data.csv',
    csvText
  });

  const failures = [];
  let wellFormedCount = 0;
  let logicCorrectCount = 0;

  for (const testCase of cases) {
    let result;

    try {
      result = await post('/api/query', { datasetId, question: testCase.query, history: [] });
    } catch (error) {
      failures.push({ query: testCase.query, wellFormed: false, logicCorrect: false, response: error.message, events: [] });
      continue;
    }

    const wellFormed = isWellFormed(result, testCase.expectedLastEvent);
    const logicCorrect = testCase.validate(result.response);

    if (wellFormed) wellFormedCount += 1;
    if (logicCorrect) logicCorrectCount += 1;

    if (!wellFormed || !logicCorrect) {
      failures.push({
        query: testCase.query,
        wellFormed,
        logicCorrect,
        response: result.response,
        events: result.toolEvents.map((event) => event.type)
      });
    }
  }

  // Multi-turn follow-up: relies on conversation history to resolve "that" and "it".
  const first = await post('/api/query', {
    datasetId,
    question: 'What is the average revenue?',
    history: []
  });
  const followUp = await post('/api/query', {
    datasetId,
    question: 'Now break that down by channel',
    history: [
      { role: 'user', content: 'What is the average revenue?' },
      { role: 'assistant', content: first.response }
    ]
  });
  const multiTurnOk =
    isWellFormed(followUp, 'group.aggregate') && /Revenue/i.test(followUp.response) && /Search|Email|Social|Display/.test(followUp.response);

  const totalCases = cases.length + 1;
  const wellFormedTotal = wellFormedCount + (multiTurnOk ? 1 : 0);
  const logicTotal = logicCorrectCount + (multiTurnOk ? 1 : 0);

  if (!multiTurnOk) {
    failures.push({
      query: 'Now break that down by channel (multi-turn follow-up)',
      wellFormed: isWellFormed(followUp, 'group.aggregate'),
      logicCorrect: multiTurnOk,
      response: followUp.response,
      events: followUp.toolEvents.map((event) => event.type)
    });
  }

  const formatAccuracy = ((wellFormedTotal / totalCases) * 100).toFixed(1);
  const logicAccuracy = ((logicTotal / totalCases) * 100).toFixed(1);

  console.log(`API: ${API_BASE_URL}`);
  console.log(`Benchmark queries: ${totalCases} (12 single-turn + 1 multi-turn follow-up)`);
  console.log(`Well-formed responses: ${wellFormedTotal}/${totalCases} (${formatAccuracy}%)`);
  console.log(`Logically correct responses: ${logicTotal}/${totalCases} (${logicAccuracy}%)`);

  if (failures.length > 0) {
    console.log('\nFailures:');

    for (const failure of failures) {
      console.log(`- Query: ${failure.query}`);
      console.log(`  Well-formed: ${failure.wellFormed}`);
      console.log(`  Logic correct: ${failure.logicCorrect}`);
      console.log(`  Events: ${failure.events.join(', ')}`);
      console.log(`  Response: ${failure.response}`);
    }

    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
