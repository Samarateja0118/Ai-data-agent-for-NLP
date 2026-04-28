const DELIMITERS = [',', ';', '\t', '|'];

function countDelimiter(line, delimiter) {
  let count = 0;
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      count += 1;
    }
  }

  return count;
}

function detectDelimiter(text) {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);

  const best = DELIMITERS.map((delimiter) => ({
    delimiter,
    score: lines.reduce((total, line) => total + countDelimiter(line, delimiter), 0)
  })).sort((left, right) => right.score - left.score)[0];

  return best && best.score > 0 ? best.delimiter : ',';
}

function parseCsvRows(text, delimiter) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let currentValue = '';
  let currentRow = [];
  let inQuotes = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];

    if (char === '"') {
      if (inQuotes && normalized[index + 1] === '"') {
        currentValue += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      currentRow.push(currentValue);
      currentValue = '';
    } else if (char === '\n' && !inQuotes) {
      currentRow.push(currentValue);
      rows.push(currentRow);
      currentRow = [];
      currentValue = '';
    } else {
      currentValue += char;
    }
  }

  currentRow.push(currentValue);
  rows.push(currentRow);

  return rows.filter((row, index) => {
    if (index === 0) {
      return true;
    }

    return row.some((value) => String(value).trim() !== '');
  });
}

function ensureUniqueHeaders(headers) {
  const used = new Map();

  return headers.map((header, index) => {
    const trimmed = header.trim() || `Column ${index + 1}`;
    const seen = used.get(trimmed) ?? 0;
    used.set(trimmed, seen + 1);

    return seen === 0 ? trimmed : `${trimmed} ${seen + 1}`;
  });
}

export function parseNumericValue(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return null;
  }

  let value = String(rawValue).trim();

  if (!value) {
    return null;
  }

  let isNegative = false;

  if (value.startsWith('(') && value.endsWith(')')) {
    isNegative = true;
    value = value.slice(1, -1);
  }

  value = value.replace(/[$€£¥,]/g, '').replace(/\s+/g, '');

  if (value.endsWith('%')) {
    value = value.slice(0, -1);
  }

  if (!/^[-+]?\d*\.?\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return isNegative ? -parsed : parsed;
}

function inferFormat(values) {
  const nonEmpty = values.filter((value) => String(value).trim() !== '');

  if (nonEmpty.length === 0) {
    return 'number';
  }

  const percentCount = nonEmpty.filter((value) => String(value).includes('%')).length;
  const currencyCount = nonEmpty.filter((value) => /[$€£¥]/.test(String(value))).length;

  if (percentCount / nonEmpty.length >= 0.5) {
    return 'percent';
  }

  if (currencyCount / nonEmpty.length >= 0.4) {
    return 'currency';
  }

  return 'number';
}

function getMedian(values) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function buildColumnProfile(name, values) {
  const trimmedValues = values.map((value) => String(value ?? '').trim());
  const missingCount = trimmedValues.filter((value) => value === '').length;
  const nonEmptyValues = trimmedValues.filter((value) => value !== '');
  const numericValues = nonEmptyValues
    .map((value) => parseNumericValue(value))
    .filter((value) => value !== null);
  const uniqueCount = new Set(nonEmptyValues).size;
  const sampleValues = [...new Set(nonEmptyValues)].slice(0, 3);
  const isNumeric =
    nonEmptyValues.length > 0 && numericValues.length / Math.max(nonEmptyValues.length, 1) >= 0.8;

  if (!isNumeric) {
    return {
      name,
      type: 'string',
      missingCount,
      uniqueCount,
      sampleValues
    };
  }

  const sum = numericValues.reduce((total, value) => total + value, 0);
  const min = Math.min(...numericValues);
  const max = Math.max(...numericValues);
  const mean = sum / numericValues.length;
  const median = getMedian(numericValues);

  return {
    name,
    type: 'number',
    format: inferFormat(nonEmptyValues),
    missingCount,
    uniqueCount,
    sampleValues,
    stats: {
      count: numericValues.length,
      sum,
      min,
      max,
      mean,
      median
    }
  };
}

export function buildDatasetFromCsv(fileName, text) {
  const delimiter = detectDelimiter(text);
  const parsedRows = parseCsvRows(text, delimiter);

  if (parsedRows.length < 2) {
    throw new Error('The CSV needs a header row and at least one data row.');
  }

  const headers = ensureUniqueHeaders(parsedRows[0]);
  const rowArrays = parsedRows.slice(1).map((row) =>
    headers.map((_, index) => String(row[index] ?? '').trim())
  );

  const rows = rowArrays.map((row) =>
    headers.reduce((record, header, index) => {
      record[header] = row[index] ?? '';
      return record;
    }, {})
  );

  const columns = headers.map((header, index) =>
    buildColumnProfile(
      header,
      rowArrays.map((row) => row[index] ?? '')
    )
  );

  const numericColumns = columns.filter((column) => column.type === 'number');
  const categoricalColumns = columns.filter((column) => column.type !== 'number');
  const missingCells = columns.reduce((total, column) => total + column.missingCount, 0);
  const labelColumn =
    categoricalColumns.find((column) => column.uniqueCount >= Math.min(rows.length, 3)) ??
    categoricalColumns[0] ??
    columns[0];

  return {
    name: fileName,
    delimiter,
    rows,
    columns,
    numericColumns,
    categoricalColumns,
    rowCount: rows.length,
    columnCount: columns.length,
    missingCells,
    previewRows: rows.slice(0, 8),
    labelColumnName: labelColumn?.name ?? headers[0]
  };
}
