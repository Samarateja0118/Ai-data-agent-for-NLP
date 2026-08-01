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
