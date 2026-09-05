/**
 * RazorShield AI — Dataset Studio API client.
 *
 * Typed wrappers around the dataset analysis endpoints. Kept separate from
 * the mock-backed `services/api.ts` because this data is real: whatever the
 * analyst uploads is scored server-side and persisted in SQLite.
 */

import type {
  AnalyzeRequest,
  AnalyzeResponse,
  DatasetAnalysis,
  DatasetSummary,
} from "@/types/dataset";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const message =
      (body as { error?: string } | null)?.error ?? `Dataset API ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

export const datasetApi = {
  analyze(req: AnalyzeRequest): Promise<AnalyzeResponse> {
    return fetch("/api/datasets/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }).then((r) => jsonOrThrow<AnalyzeResponse>(r));
  },

  list(): Promise<{ datasets: DatasetSummary[] }> {
    return fetch("/api/datasets").then((r) => jsonOrThrow<{ datasets: DatasetSummary[] }>(r));
  },

  get(id: string): Promise<{ analysis: DatasetAnalysis }> {
    return fetch(`/api/datasets/${encodeURIComponent(id)}`).then((r) =>
      jsonOrThrow<{ analysis: DatasetAnalysis }>(r),
    );
  },

  remove(id: string): Promise<{ ok: boolean }> {
    return fetch(`/api/datasets/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) =>
      jsonOrThrow<{ ok: boolean }>(r),
    );
  },
};
