export const BASE_URL = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/+$/, "");


// Helper: extract safe error message
export function extractErrorMessage(err) {
  if (!err) return "Unknown error";
  if (err.message) return err.message;
  return String(err);
}

async function request(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let errText;
    try {
      errText = await res.text();
    } catch {
      errText = res.statusText || "Unknown error";
    }
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json().catch(() => ({}));
  return { data };
}

export const api = {
  get: (path) => request(path, { method: "GET" }),
  post: (path, body) => request(path, { method: "POST", body }),
};
