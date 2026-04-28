import { parseNumericValue } from './csvUtils';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2
});

const numberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2
});

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function formatValue(value, format = 'number') {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'N/A';
  }

  if (format === 'currency') {
    return currencyFormatter.format(value);
  }

  if (format === 'percent') {
    return `${numberFormatter.format(value)}%`;
  }

  return numberFormatter.format(value);
}

function getQuestionColumnMatches(question, dataset, type) {
  const normalizedQuestion = normalizeText(question);

  return dataset.columns
    .filter((column) => !type || column.type === type)
    .map((column) => {
      const normalizedName = normalizeText(column.name);
      const exactMatch = normalizedQuestion.includes(normalizedName) ? 10 : 0;
      const tokenMatches = normalizedName
        .split(' ')
        .filter((token) => token.length > 2 && normalizedQuestion.includes(token)).length;

      return {
        column,
        score: exactMatch + tokenMatches
      };
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score);
}

function getNumericValues(dataset, columnName) {
  return dataset.rows
    .map((row, index) => ({
      index,
      label: row[dataset.labelColumnName] || `Row ${index + 1}`,
      value: parseNumericValue(row[columnName])
    }))
    .filter((entry) => entry.value !== null);
}

function getTopMissingColumns(dataset) {
  return [...dataset.columns]
    .filter((column) => column.missingCount > 0)
    .sort((left, right) => right.missingCount - left.missingCount)
    .slice(0, 3);
}

function buildOverviewAnswer(dataset) {
  const numericNames = dataset.numericColumns.slice(0, 3).map((column) => column.name);
  const topMissing = getTopMissingColumns(dataset);
  const numericSummary =
    numericNames.length > 0
      ? `Numeric columns include ${numericNames.join(', ')}.`
      : 'There are no strongly numeric columns in this file.';
  const missingSummary =
    topMissing.length > 0
      ? `The most incomplete column is ${topMissing[0].name} with ${topMissing[0].missingCount} missing values.`
      : 'There are no missing values in the dataset.';

  return {
    toolEvents: [
      {
        type: 'schema.inspect',
        label: 'Inspect CSV schema',
        detail: `Found ${dataset.columnCount} columns across ${dataset.rowCount} rows.`
      },
      {
        type: 'profile.generate',
        label: 'Generate dataset summary',
        detail: 'Profiling numeric and categorical columns.'
      }
    ],
    response: `${dataset.name} contains ${numberFormatter.format(dataset.rowCount)} rows and ${dataset.columnCount} columns. ${numericSummary} ${missingSummary}`
  };
}

function buildColumnListAnswer(dataset, typeFilter) {
  const columns =
    typeFilter === 'number'
      ? dataset.numericColumns
      : typeFilter === 'string'
        ? dataset.categoricalColumns
        : dataset.columns;

  const typeLabel =
    typeFilter === 'number'
      ? 'numeric'
      : typeFilter === 'string'
        ? 'categorical'
        : 'available';

  return {
    toolEvents: [
      {
        type: 'schema.inspect',
        label: 'Read column definitions',
        detail: `Listing ${typeLabel} columns from the uploaded CSV.`
      }
    ],
    response:
      columns.length > 0
        ? `The ${typeLabel} columns are: ${columns
            .map((column) => `${column.name}${column.type === 'number' ? ' (numeric)' : ''}`)
            .join(', ')}.`
        : `I could not find any ${typeLabel} columns in this dataset.`
  };
}

function buildRowCountAnswer(dataset) {
  return {
    toolEvents: [
      {
        type: 'table.scan',
        label: 'Count dataset rows',
        detail: 'Reviewing row and column totals.'
      }
    ],
    response: `This file has ${numberFormatter.format(dataset.rowCount)} rows and ${dataset.columnCount} columns.`
  };
}

function buildMissingAnswer(dataset) {
  const topMissing = getTopMissingColumns(dataset);

  return {
    toolEvents: [
      {
        type: 'data.quality',
        label: 'Check missing values',
        detail: 'Counting blank cells by column.'
      }
    ],
    response:
      dataset.missingCells === 0
        ? 'There are no missing values in this dataset.'
        : `The dataset has ${numberFormatter.format(dataset.missingCells)} missing cells. The highest-missing columns are ${topMissing
            .map((column) => `${column.name} (${column.missingCount})`)
            .join(', ')}.`
  };
}

function buildPreviewAnswer(dataset) {
  const preview = dataset.previewRows.slice(0, 3);
  const sampleLines = preview.map((row, index) => {
    const pairs = dataset.columns
      .slice(0, 4)
      .map((column) => `${column.name}: ${row[column.name] || 'blank'}`)
      .join(', ');

    return `Row ${index + 1}: ${pairs}`;
  });

  return {
    toolEvents: [
      {
        type: 'table.preview',
        label: 'Preview sample rows',
        detail: 'Reading the first few rows of the CSV.'
      }
    ],
    response: sampleLines.join(' ')
  };
}

function buildNumericAnswer(question, dataset) {
  const numericMatch = getQuestionColumnMatches(question, dataset, 'number')[0];

  if (!numericMatch) {
    return null;
  }

  const questionText = normalizeText(question);
  const column = numericMatch.column;
  const stats = column.stats;
  let operation = 'mean';
  let value = stats.mean;
  let detail = `Calculating average for ${column.name}.`;

  if (questionText.includes('total') || questionText.includes('sum')) {
    operation = 'sum';
    value = stats.sum;
    detail = `Summing values in ${column.name}.`;
  } else if (questionText.includes('median')) {
    operation = 'median';
    value = stats.median;
    detail = `Computing the median for ${column.name}.`;
  } else if (
    questionText.includes('max') ||
    questionText.includes('highest') ||
    questionText.includes('largest') ||
    questionText.includes('top')
  ) {
    operation = 'max';
    const rows = getNumericValues(dataset, column.name);
    const top = [...rows].sort((left, right) => right.value - left.value)[0];

    return {
      toolEvents: [
        {
          type: 'schema.inspect',
          label: `Resolve column: ${column.name}`,
          detail: 'Matching the question to a numeric field.'
        },
        {
          type: 'aggregation.max',
          label: `Find maximum in ${column.name}`,
          detail: `Scanning ${rows.length} numeric values.`
        }
      ],
      response: `The highest ${column.name} is ${formatValue(top.value, column.format)} in ${top.label}.`,
      focus: {
        chartColumn: column.name
      }
    };
  } else if (
    questionText.includes('min') ||
    questionText.includes('lowest') ||
    questionText.includes('smallest')
  ) {
    operation = 'min';
    const rows = getNumericValues(dataset, column.name);
    const bottom = [...rows].sort((left, right) => left.value - right.value)[0];

    return {
      toolEvents: [
        {
          type: 'schema.inspect',
          label: `Resolve column: ${column.name}`,
          detail: 'Matching the question to a numeric field.'
        },
        {
          type: 'aggregation.min',
          label: `Find minimum in ${column.name}`,
          detail: `Scanning ${rows.length} numeric values.`
        }
      ],
      response: `The lowest ${column.name} is ${formatValue(bottom.value, column.format)} in ${bottom.label}.`,
      focus: {
        chartColumn: column.name
      }
    };
  }

  return {
    toolEvents: [
      {
        type: 'schema.inspect',
        label: `Resolve column: ${column.name}`,
        detail: 'Matching the question to a numeric field.'
      },
      {
        type: `aggregation.${operation}`,
        label: `Compute ${operation} for ${column.name}`,
        detail
      }
    ],
    response: `The ${operation === 'mean' ? 'average' : operation} ${column.name} is ${formatValue(
      value,
      column.format
    )}.`,
    focus: {
      chartColumn: column.name
    }
  };
}

function buildGroupedAnswer(question, dataset) {
  const questionText = normalizeText(question);

  if (!questionText.includes(' by ') && !questionText.includes(' per ')) {
    return null;
  }

  const numericMatch = getQuestionColumnMatches(question, dataset, 'number')[0];
  const categoricalMatch = getQuestionColumnMatches(question, dataset, 'string')[0];

  if (!numericMatch || !categoricalMatch) {
    return null;
  }

  const numericColumn = numericMatch.column;
  const categoricalColumn = categoricalMatch.column;
  const mode =
    questionText.includes('average') || questionText.includes('mean') ? 'mean' : 'sum';
  const groups = new Map();

  dataset.rows.forEach((row) => {
    const groupKey = row[categoricalColumn.name] || 'Blank';
    const numericValue = parseNumericValue(row[numericColumn.name]);

    if (numericValue === null) {
      return;
    }

    const current = groups.get(groupKey) ?? { sum: 0, count: 0 };
    current.sum += numericValue;
    current.count += 1;
    groups.set(groupKey, current);
  });

  const rankedGroups = [...groups.entries()]
    .map(([label, values]) => ({
      label,
      value: mode === 'mean' ? values.sum / values.count : values.sum
    }))
    .sort((left, right) => right.value - left.value);

  if (rankedGroups.length === 0) {
    return null;
  }

  const topGroup = rankedGroups[0];
  const topThree = rankedGroups
    .slice(0, 3)
    .map((group) => `${group.label} (${formatValue(group.value, numericColumn.format)})`)
    .join(', ');

  return {
    toolEvents: [
      {
        type: 'schema.inspect',
        label: `Resolve columns: ${numericColumn.name} and ${categoricalColumn.name}`,
        detail: 'Matching numeric and grouping fields from the question.'
      },
      {
        type: 'group.aggregate',
        label: `Aggregate ${numericColumn.name} by ${categoricalColumn.name}`,
        detail: `Computing ${mode} values across grouped categories.`
      }
    ],
    response: `Grouped by ${categoricalColumn.name}, ${topGroup.label} has the highest ${
      mode === 'mean' ? 'average' : 'total'
    } ${numericColumn.name} at ${formatValue(topGroup.value, numericColumn.format)}. The top groups are ${topThree}.`,
    focus: {
      chartColumn: numericColumn.name,
      categoryColumn: categoricalColumn.name
    }
  };
}

function buildFallbackAnswer(dataset) {
  const numericColumn = dataset.numericColumns[0]?.name;
  const categoryColumn = dataset.categoricalColumns[0]?.name;
  const examples = [
    'Summarize this dataset',
    'Which columns are numeric?',
    numericColumn ? `What is the average ${numericColumn}?` : null,
    numericColumn && categoryColumn ? `Show total ${numericColumn} by ${categoryColumn}` : null
  ].filter(Boolean);

  return {
    toolEvents: [
      {
        type: 'schema.inspect',
        label: 'Inspect supported question types',
        detail: 'Checking what this dataset can answer reliably.'
      }
    ],
    response: `I can answer questions about row counts, columns, missing values, previews, numeric summaries, and grouped comparisons. Try one of these: ${examples.join(' | ')}.`
  };
}

export function buildStarterPrompts(dataset) {
  if (!dataset) {
    return [
      'Summarize this dataset',
      'Which columns are numeric?',
      'How many rows are there?',
      'Show me sample rows'
    ];
  }

  const numericColumn = dataset.numericColumns[0]?.name;
  const categoryColumn = dataset.categoricalColumns[0]?.name;

  return [
    'Summarize this dataset',
    'Which columns are numeric?',
    numericColumn ? `What is the average ${numericColumn}?` : 'How many rows are there?',
    numericColumn && categoryColumn
      ? `Show total ${numericColumn} by ${categoryColumn}`
      : 'Show me sample rows'
  ];
}

export async function runAnalystQuery(question, dataset) {
  if (!dataset) {
    return {
      toolEvents: [
        {
          type: 'input.required',
          label: 'Upload a CSV first',
          detail: 'No dataset is loaded yet.'
        }
      ],
      response: 'Upload a CSV file first, then I can summarize it, inspect columns, and answer questions from the uploaded data.'
    };
  }

  const normalizedQuestion = normalizeText(question);
  let result = buildFallbackAnswer(dataset);
  const isDimensionCountQuestion =
    normalizedQuestion.includes('how many') &&
    !normalizedQuestion.includes('numeric') &&
    !normalizedQuestion.includes('categorical') &&
    !normalizedQuestion.includes('string') &&
    (normalizedQuestion.includes('row') ||
      normalizedQuestion.includes('record') ||
      normalizedQuestion.includes('column'));

  if (
    normalizedQuestion.includes('summary') ||
    normalizedQuestion.includes('summarize') ||
    normalizedQuestion.includes('overview')
  ) {
    result = buildOverviewAnswer(dataset);
  } else if (isDimensionCountQuestion) {
    result = buildRowCountAnswer(dataset);
  } else if (
    normalizedQuestion.includes('column') ||
    normalizedQuestion.includes('field') ||
    normalizedQuestion.includes('schema')
  ) {
    if (normalizedQuestion.includes('numeric') || normalizedQuestion.includes('number')) {
      result = buildColumnListAnswer(dataset, 'number');
    } else if (
      normalizedQuestion.includes('text') ||
      normalizedQuestion.includes('string') ||
      normalizedQuestion.includes('categorical')
    ) {
      result = buildColumnListAnswer(dataset, 'string');
    } else {
      result = buildColumnListAnswer(dataset);
    }
  } else if (normalizedQuestion.includes('row') || normalizedQuestion.includes('record')) {
    result = buildRowCountAnswer(dataset);
  } else if (
    normalizedQuestion.includes('missing') ||
    normalizedQuestion.includes('blank') ||
    normalizedQuestion.includes('null')
  ) {
    result = buildMissingAnswer(dataset);
  } else if (
    normalizedQuestion.includes('sample') ||
    normalizedQuestion.includes('preview') ||
    normalizedQuestion.includes('show me rows')
  ) {
    result = buildPreviewAnswer(dataset);
  } else {
    result = buildGroupedAnswer(question, dataset) ?? buildNumericAnswer(question, dataset) ?? result;
  }

  const timeline = [];

  for (const event of result.toolEvents) {
    await sleep(260);
    timeline.push(event);
  }

  await sleep(180);

  return {
    ...result,
    toolEvents: timeline
  };
}
