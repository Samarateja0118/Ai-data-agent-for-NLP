const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

async function parseErrorMessage(response) {
  try {
    const payload = await response.json();
    return payload.detail || payload.error || `Request failed with status ${response.status}.`;
  } catch {
    return `Request failed with status ${response.status}.`;
  }
}

export async function registerDataset(name, csvText) {
  const response = await fetch(`${API_BASE_URL}/api/dataset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, csvText })
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return response.json();
}

export async function queryDataset({ name, csvText, question, history }) {
  const response = await fetch(`${API_BASE_URL}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, csvText, question, history })
  });

  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }

  return response.json();
}
