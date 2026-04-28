import React, { useEffect, useRef, useState } from 'react';
import { buildStarterPrompts, runAnalystQuery } from './lib/analysisEngine';
import { buildDatasetFromCsv, parseNumericValue } from './lib/csvUtils';

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2
});

const numberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2
});

const initialMessages = [
  {
    id: 1,
    role: 'assistant',
    content:
      'Upload a CSV file and I will profile the dataset, surface key numbers, and answer questions directly from the uploaded rows.'
  }
];

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

function buildMetricCards(dataset) {
  if (!dataset) {
    return [
      { label: 'rows', value: '0', note: 'Upload a file to begin' },
      { label: 'columns', value: '0', note: 'Schema appears after parsing' },
      { label: 'numeric fields', value: '0', note: 'Detected automatically' },
      { label: 'missing cells', value: '0', note: 'Data quality checks live here' }
    ];
  }

  return [
    {
      label: 'rows',
      value: numberFormatter.format(dataset.rowCount),
      note: `Loaded from ${dataset.name}`
    },
    {
      label: 'columns',
      value: String(dataset.columnCount),
      note: `${dataset.categoricalColumns.length} text-like, ${dataset.numericColumns.length} numeric`
    },
    {
      label: 'numeric fields',
      value: String(dataset.numericColumns.length),
      note:
        dataset.numericColumns.length > 0
          ? `Leading metric: ${dataset.numericColumns[0].name}`
          : 'No numeric columns detected'
    },
    {
      label: 'missing cells',
      value: numberFormatter.format(dataset.missingCells),
      note:
        dataset.missingCells === 0
          ? 'No blanks found'
          : 'Use chat to ask about missing data'
    }
  ];
}

function buildTrendChart(dataset, columnName) {
  if (!dataset || !columnName) {
    return null;
  }

  const values = dataset.rows
    .map((row, index) => ({
      index,
      label: row[dataset.labelColumnName] || `Row ${index + 1}`,
      value: parseNumericValue(row[columnName])
    }))
    .filter((item) => item.value !== null)
    .slice(0, 12);

  if (values.length === 0) {
    return null;
  }

  const width = 520;
  const height = 180;
  const padding = 18;
  const min = Math.min(...values.map((item) => item.value));
  const max = Math.max(...values.map((item) => item.value));
  const range = max - min || 1;

  const points = values.map((item, index) => {
    const x = padding + (index * (width - padding * 2)) / Math.max(values.length - 1, 1);
    const y = height - padding - ((item.value - min) / range) * (height - padding * 2);

    return {
      ...item,
      x,
      y
    };
  });

  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');

  return {
    width,
    height,
    points,
    path,
    min,
    max
  };
}

function buildCategoryBreakdown(dataset, columnName) {
  if (!dataset || !columnName) {
    return [];
  }

  const counts = new Map();

  dataset.rows.forEach((row) => {
    const label = row[columnName] || 'Blank';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 6);
}

function getUploadMessage(dataset) {
  const numericColumn = dataset.numericColumns[0]?.name;
  const categoryColumn = dataset.categoricalColumns[0]?.name;
  const examples = [
    'Summarize this dataset',
    'Which columns are numeric?',
    numericColumn ? `What is the average ${numericColumn}?` : null,
    numericColumn && categoryColumn ? `Show total ${numericColumn} by ${categoryColumn}` : null
  ].filter(Boolean);

  return `Loaded ${dataset.name} with ${numberFormatter.format(dataset.rowCount)} rows and ${dataset.columnCount} columns. Ask questions like: ${examples.join(' | ')}.`;
}

export default function App() {
  const [dataset, setDataset] = useState(null);
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState('');
  const [toolFeed, setToolFeed] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [selectedNumericColumn, setSelectedNumericColumn] = useState('');
  const [selectedCategoryColumn, setSelectedCategoryColumn] = useState('');
  const chatEndRef = useRef(null);

  const metricCards = buildMetricCards(dataset);
  const starterPrompts = buildStarterPrompts(dataset);
  const selectedNumericProfile =
    dataset?.numericColumns.find((column) => column.name === selectedNumericColumn) ??
    dataset?.numericColumns[0] ??
    null;
  const selectedCategoryProfile =
    dataset?.categoricalColumns.find((column) => column.name === selectedCategoryColumn) ??
    dataset?.categoricalColumns[0] ??
    null;
  const trendChart = selectedNumericProfile
    ? buildTrendChart(dataset, selectedNumericProfile.name)
    : null;
  const categoryBreakdown = selectedCategoryProfile
    ? buildCategoryBreakdown(dataset, selectedCategoryProfile.name)
    : [];
  const previewColumns = dataset?.columns.slice(0, 6) ?? [];
  const maxCategoryCount = Math.max(...categoryBreakdown.map((item) => item.count), 1);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, toolFeed]);

  async function loadDataset(fileName, text) {
    setIsImporting(true);
    setUploadError('');

    try {
      const nextDataset = buildDatasetFromCsv(fileName, text);

      setDataset(nextDataset);
      setSelectedNumericColumn(nextDataset.numericColumns[0]?.name ?? '');
      setSelectedCategoryColumn(nextDataset.categoricalColumns[0]?.name ?? '');
      setToolFeed([
        {
          type: 'file.read',
          label: `Read file: ${fileName}`,
          detail: `Loaded ${text.length.toLocaleString()} characters from the uploaded CSV.`
        },
        {
          type: 'schema.inspect',
          label: 'Infer column schema',
          detail: `Detected ${nextDataset.columnCount} columns and ${nextDataset.numericColumns.length} numeric fields.`
        },
        {
          type: 'profile.generate',
          label: 'Build dataset profile',
          detail: `Prepared summary stats for ${nextDataset.rowCount} rows.`
        }
      ]);
      setMessages([
        {
          id: Date.now(),
          role: 'assistant',
          content: getUploadMessage(nextDataset)
        }
      ]);
    } catch (error) {
      setUploadError(error.message || 'Could not parse that CSV file.');
    } finally {
      setIsImporting(false);
    }
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const text = await file.text();
    await loadDataset(file.name, text);
    event.target.value = '';
  }

  async function handleLoadDemoDataset() {
    const response = await fetch('/demo-retail-data.csv');
    const text = await response.text();
    await loadDataset('demo-retail-data.csv', text);
  }

  async function handleSubmit(event, nextQuestion) {
    event?.preventDefault();

    const question = (nextQuestion ?? input).trim();

    if (!question || isRunning) {
      return;
    }

    setMessages((current) => [
      ...current,
      {
        id: Date.now(),
        role: 'user',
        content: question
      }
    ]);
    setInput('');
    setToolFeed([]);
    setIsRunning(true);

    const result = await runAnalystQuery(question, dataset);

    result.toolEvents.forEach((toolEvent) => {
      setToolFeed((current) => [...current, toolEvent]);
    });

    if (result.focus?.chartColumn) {
      setSelectedNumericColumn(result.focus.chartColumn);
    }

    if (result.focus?.categoryColumn) {
      setSelectedCategoryColumn(result.focus.categoryColumn);
    }

    setMessages((current) => [
      ...current,
      {
        id: Date.now() + 1,
        role: 'assistant',
        content: result.response
      }
    ]);
    setIsRunning(false);
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />

      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">React + JavaScript + CSV Analysis</p>
          <h1>Ask Questions About Any CSV</h1>
          <p className="hero-text">
            Upload a dataset, inspect the schema, and ask analyst-style questions
            against the file you loaded. This version is generic, so the app adapts
            to your columns instead of being tied to one demo dataset.
          </p>
        </div>

        <article className="panel upload-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Dataset Intake</p>
              <h2>{dataset ? dataset.name : 'Upload a CSV file'}</h2>
            </div>
            <span className={`status-pill ${isImporting ? 'live' : ''}`}>
              {isImporting ? 'Parsing file...' : dataset ? 'Dataset ready' : 'Awaiting upload'}
            </span>
          </div>

          <p className="upload-copy">
            Supports comma, semicolon, tab, and pipe-delimited files with a header row.
          </p>

          <label className="upload-dropzone">
            <input
              type="file"
              accept=".csv,text/csv,.tsv,text/tab-separated-values"
              onChange={handleFileChange}
            />
            <span>{dataset ? 'Replace CSV' : 'Choose CSV file'}</span>
            <small>
              {dataset
                ? 'Upload another file to swap the current dataset.'
                : 'Your file stays in the browser and is profiled locally.'}
            </small>
          </label>

          <button
            type="button"
            className="secondary-action"
            onClick={handleLoadDemoDataset}
            disabled={isImporting}
          >
            Load demo dataset
          </button>

          {uploadError ? <p className="upload-error">{uploadError}</p> : null}
        </article>
      </header>

      <section className="summary-grid">
        {metricCards.map((card) => (
          <article className="metric-card" key={card.label}>
            <span className="metric-label">{card.label}</span>
            <strong>{card.value}</strong>
            <span className="metric-delta">{card.note}</span>
          </article>
        ))}
      </section>

      <section className="analytics-grid">
        <article className="panel analytics-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Trend View</p>
              <h2>
                {selectedNumericProfile ? selectedNumericProfile.name : 'No numeric column yet'}
              </h2>
            </div>

            {dataset && dataset.numericColumns.length > 0 ? (
              <select
                className="panel-control"
                value={selectedNumericProfile?.name ?? ''}
                onChange={(event) => setSelectedNumericColumn(event.target.value)}
              >
                {dataset.numericColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          {trendChart ? (
            <>
              <div className="chart-shell">
                <svg
                  className="sparkline"
                  viewBox={`0 0 ${trendChart.width} ${trendChart.height}`}
                  role="img"
                  aria-label={`${selectedNumericProfile.name} chart`}
                >
                  <defs>
                    <linearGradient id="datasetSparkFill" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="rgba(255, 208, 117, 0.45)" />
                      <stop offset="100%" stopColor="rgba(255, 208, 117, 0)" />
                    </linearGradient>
                  </defs>
                  <path
                    d={`${trendChart.path} L ${
                      trendChart.points[trendChart.points.length - 1].x
                    } ${trendChart.height - 18} L ${trendChart.points[0].x} ${
                      trendChart.height - 18
                    } Z`}
                    fill="url(#datasetSparkFill)"
                  />
                  <path d={trendChart.path} fill="none" stroke="var(--accent)" strokeWidth="4" />
                  {trendChart.points.map((point) => (
                    <circle
                      key={`${point.index}-${point.value}`}
                      cx={point.x}
                      cy={point.y}
                      r="4.5"
                      fill="var(--accent-cool)"
                      stroke="rgba(9, 20, 17, 0.9)"
                      strokeWidth="2"
                    />
                  ))}
                </svg>

                <div className="chart-labels">
                  {trendChart.points.map((point) => (
                    <span key={`${point.label}-${point.index}`}>{point.index + 1}</span>
                  ))}
                </div>
              </div>

              <div className="chart-footnote">
                Showing the first {trendChart.points.length} numeric rows from{' '}
                <strong>{selectedNumericProfile.name}</strong>.
              </div>
            </>
          ) : (
            <p className="empty-state">
              Upload a dataset with numeric columns to unlock charts here.
            </p>
          )}
        </article>

        <article className="panel analytics-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Column Profile</p>
              <h2>{selectedNumericProfile ? selectedNumericProfile.name : 'Numeric summary'}</h2>
            </div>
          </div>

          {selectedNumericProfile ? (
            <div className="profile-grid">
              <article className="insight-card">
                <span className="metric-label">Average</span>
                <strong>{formatValue(selectedNumericProfile.stats.mean, selectedNumericProfile.format)}</strong>
                <p>Mean value across valid numeric rows.</p>
              </article>
              <article className="insight-card">
                <span className="metric-label">Median</span>
                <strong>
                  {formatValue(selectedNumericProfile.stats.median, selectedNumericProfile.format)}
                </strong>
                <p>Middle value after sorting the column.</p>
              </article>
              <article className="insight-card">
                <span className="metric-label">Range</span>
                <strong>
                  {formatValue(selectedNumericProfile.stats.min, selectedNumericProfile.format)} to{' '}
                  {formatValue(selectedNumericProfile.stats.max, selectedNumericProfile.format)}
                </strong>
                <p>Minimum and maximum observed values.</p>
              </article>
              <article className="insight-card">
                <span className="metric-label">Coverage</span>
                <strong>{numberFormatter.format(selectedNumericProfile.stats.count)} rows</strong>
                <p>{selectedNumericProfile.missingCount} missing values in this field.</p>
              </article>
            </div>
          ) : (
            <p className="empty-state">
              Once a numeric column is detected, its key stats will appear here.
            </p>
          )}
        </article>

        <article className="panel analytics-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Category Breakdown</p>
              <h2>
                {selectedCategoryProfile ? selectedCategoryProfile.name : 'No text column yet'}
              </h2>
            </div>

            {dataset && dataset.categoricalColumns.length > 0 ? (
              <select
                className="panel-control"
                value={selectedCategoryProfile?.name ?? ''}
                onChange={(event) => setSelectedCategoryColumn(event.target.value)}
              >
                {dataset.categoricalColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          {categoryBreakdown.length > 0 ? (
            <div className="distribution-list">
              {categoryBreakdown.map((item) => (
                <article className="bar-row" key={item.label}>
                  <div className="bar-meta">
                    <div>
                      <strong>{item.label}</strong>
                      <p>{item.count} rows</p>
                    </div>
                    <span>{item.count}</span>
                  </div>
                  <div className="bar-track">
                    <span
                      className="bar-fill"
                      style={{ width: `${(item.count / maxCategoryCount) * 100}%` }}
                    />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">
              Upload a dataset with at least one text column to see category counts.
            </p>
          )}
        </article>
      </section>

      <main className="workspace">
        <section className="panel chat-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Analyst Chat</p>
              <h2>Ask questions against the uploaded CSV</h2>
            </div>
            <span className={`status-pill ${isRunning ? 'live' : ''}`}>
              {isRunning ? 'Analyzing...' : 'Ready'}
            </span>
          </div>

          <div className="prompt-row">
            {starterPrompts.map((prompt) => (
              <button
                type="button"
                className="prompt-chip"
                key={prompt}
                onClick={(event) => handleSubmit(event, prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>

          <div className="chat-feed">
            {messages.map((message) => (
              <article
                className={`message message-${message.role}`}
                key={message.id}
              >
                <span className="message-role">{message.role}</span>
                <p>{message.content}</p>
              </article>
            ))}
            <div ref={chatEndRef} />
          </div>

          <form className="composer" onSubmit={handleSubmit}>
            <label className="sr-only" htmlFor="question">
              Ask a question
            </label>
            <input
              id="question"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about columns, averages, missing values, grouped totals, or sample rows..."
            />
            <button type="submit" disabled={isRunning}>
              Analyze
            </button>
          </form>
        </section>

        <section className="panel side-panel">
          <div className="stack trace-stack">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Tool Activity</p>
                <h2>Analysis trace</h2>
              </div>
            </div>

            <div className="tool-feed">
              {toolFeed.length === 0 ? (
                <p className="empty-state">
                  Upload a file or ask a question to see the analysis steps here.
                </p>
              ) : (
                toolFeed.map((item, index) => (
                  <article className="tool-card" key={`${item.label}-${index}`}>
                    <span className="tool-type">{item.type}</span>
                    <strong>{item.label}</strong>
                    <p>{item.detail}</p>
                  </article>
                ))
              )}
            </div>
          </div>

          <div className="stack">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Schema</p>
                <h2>{dataset ? 'Column inventory' : 'Awaiting upload'}</h2>
              </div>
            </div>

            <div className="schema-list">
              {dataset ? (
                dataset.columns.map((column) => (
                  <article className="schema-card" key={column.name}>
                    <div className="schema-head">
                      <strong>{column.name}</strong>
                      <span className={`schema-badge schema-${column.type}`}>
                        {column.type}
                      </span>
                    </div>
                    <p>
                      {column.uniqueCount} unique values, {column.missingCount} missing
                    </p>
                  </article>
                ))
              ) : (
                <p className="empty-state">
                  Schema details appear here after the CSV is parsed.
                </p>
              )}
            </div>
          </div>
        </section>
      </main>

      <section className="panel preview-panel">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Preview Table</p>
            <h2>{dataset ? 'First rows from the uploaded CSV' : 'No dataset loaded'}</h2>
          </div>
        </div>

        {dataset ? (
          <div className="table-wrap">
            <table className="preview-table">
              <thead>
                <tr>
                  {previewColumns.map((column) => (
                    <th key={column.name}>{column.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataset.previewRows.map((row, index) => (
                  <tr key={`preview-row-${index}`}>
                    {previewColumns.map((column) => (
                      <td key={`${index}-${column.name}`}>{row[column.name] || 'blank'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">
            Upload a CSV to preview the data table and ask dataset-specific questions.
          </p>
        )}
      </section>
    </div>
  );
}
