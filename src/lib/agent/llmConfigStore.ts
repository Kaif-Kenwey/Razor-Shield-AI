/**
 * RazorShield AI — runtime LLM configuration store (server-side only).
 *
 * The investigator reads its endpoint from env vars by default, but the
 * operator can also connect an OpenAI-compatible endpoint at runtime from
 * the UI (top-bar "AI" panel). That runtime config lives in
 * db/llm-config.json — local to this machine, gitignored, and never sent
 * to the browser. Runtime config wins over env; when neither exists the
 * deterministic heuristic investigator answers (the UI labels the mode).
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
import type { LlmConfig } from "./llm";

const CONFIG_PATH = path.join(process.cwd(), "db", "llm-config.json");

export const LLM_CONFIG_PATH = CONFIG_PATH;

/** Structurally identical to LlmConfig — safe to hand to the client. */
export type RuntimeLlmConfig = LlmConfig;

/** Reads the runtime config saved from the UI, or null when absent/invalid. */
export function readRuntimeLlmConfig(): RuntimeLlmConfig | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const p = parsed as Record<string, unknown>;
    const baseUrl = typeof p.baseUrl === "string" ? p.baseUrl.trim().replace(/\/+$/, "") : "";
    const apiKey = typeof p.apiKey === "string" ? p.apiKey.trim() : "";
    if (!baseUrl || !apiKey) return null;

    let extraHeaders: Record<string, string> = {};
    if (p.extraHeaders && typeof p.extraHeaders === "object" && !Array.isArray(p.extraHeaders)) {
      extraHeaders = Object.fromEntries(
        Object.entries(p.extraHeaders as Record<string, unknown>).flatMap(([k, v]) =>
          typeof v === "string" && v.length > 0 ? [[k, v] as [string, string]] : [],
        ),
      );
    }

    return {
      baseUrl,
      apiKey,
      model: typeof p.model === "string" ? p.model.trim() : "",
      extraHeaders,
      provider: typeof p.provider === "string" && p.provider.trim() ? p.provider.trim() : "custom",
      routing: typeof p.routing === "string" && p.routing.trim() ? p.routing.trim() : undefined,
    };
  } catch {
    // Missing/unreadable file = no runtime config; env (or heuristics) applies.
    return null;
  }
}

/** Persists the runtime config (null clears it). Atomic-ish via tmp+rename. */
export function writeRuntimeLlmConfig(cfg: RuntimeLlmConfig | null): void {
  mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  const tmp = `${CONFIG_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), "utf8");
  renameSync(tmp, CONFIG_PATH);
}
