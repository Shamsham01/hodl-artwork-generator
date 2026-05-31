import { supabase } from "./supabase";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

async function apiFetch(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function parseFilename(disposition, fallback) {
  if (!disposition) return fallback;
  const match = /filename="?([^"]+)"?/.exec(disposition);
  return match ? match[1] : fallback;
}

async function apiFetchBlob(path, fallbackName) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) {
    let message = "Download failed";
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {
      // non-JSON error body
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const filename = parseFilename(
    res.headers.get("Content-Disposition"),
    fallbackName
  );
  return { blob, filename };
}

export const api = {
  preview: (projectId, selectedTraits, configurationId) =>
    apiFetch("/api/preview", {
      method: "POST",
      body: JSON.stringify({ projectId, selectedTraits, configurationId }),
    }),

  generate: (projectId, editionSize) =>
    apiFetch(`/api/projects/${projectId}/generate`, {
      method: "POST",
      body: JSON.stringify({ editionSize }),
    }),

  regenerate: (projectId, editionSize) =>
    apiFetch(`/api/projects/${projectId}/regenerate`, {
      method: "POST",
      body: JSON.stringify({ editionSize }),
    }),

  getEditions: (jobId, { limit = 48, offset = 0 } = {}) =>
    apiFetch(`/api/jobs/${jobId}/editions?limit=${limit}&offset=${offset}`),

  getJob: (jobId) => apiFetch(`/api/jobs/${jobId}`),

  downloadJob: (jobId) =>
    apiFetchBlob(`/api/jobs/${jobId}/download`, "collection.zip"),

  updateUri: (jobId, payload) =>
    apiFetch(`/api/jobs/${jobId}/update-uri`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  rarity: (jobId) => apiFetch(`/api/jobs/${jobId}/rarity`),

  deleteProject: (projectId) =>
    apiFetch(`/api/projects/${projectId}`, { method: "DELETE" }),

  syncTraits: (projectId, traits) =>
    apiFetch(`/api/projects/${projectId}/sync-traits`, {
      method: "POST",
      body: JSON.stringify({ traits }),
    }),
};
