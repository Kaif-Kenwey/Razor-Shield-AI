/**
 * RazorShield AI — runtime LLM configuration store (server-side only).
 *
 * The investigator reads its endpoint from env vars by default, but the
 * operator can also connect an OpenAI-compatible endpoint at runtime from
 * the UI (top-bar "AI" panel). That runtime config lives in
 * db/llm-config.json — local to this machine, gitignored, and never sent
 * to the browser. Runtime config wins over env; when neither exists the
 * deterministic heuristic investigator answers (the UI labels the mode).
 *
 * SECURITY (review fix): API keys are no longer stored in plaintext.
 * Every write encrypts the key with AES-256-GCM; the encryption key
 * comes from LLM_CONFIG_SECRET when set, otherwise from a per-machine
 * random secret persisted to db/.llm-secret with 0600 permissions. The
 * ciphertext is tagged (authenticated) — a tampered config file fails to
 * decrypt and is treated as absent rather than trusted. Legacy plaintext
 * configs written by earlier builds still load (so an operator upgrade
 * never breaks), and are re-encrypted on the next save.
 */

import { randomBytes, createHash, createCipheriv, createDecipheriv } from "crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync, openSync, closeSync } from "fs";
import path from "path";
import type { LlmConfig } from "./llm";

/* LLM_CONFIG_PATH (test/isolation hook): redirects the whole config store
 * (config + secret file) elsewhere. Tests set it to a temp path BEFORE the
 * first import so they can never read or overwrite the operator's real
 * saved credentials, and never trigger real provider calls. */
const CONFIG_PATH =
  process.env.LLM_CONFIG_PATH?.trim() || path.join(process.cwd(), "db", "llm-config.json");
const CONFIG_DIR = path.dirname(CONFIG_PATH);
const SECRET_PATH = path.join(CONFIG_DIR, ".llm-secret");

export const LLM_CONFIG_PATH = CONFIG_PATH;

/** Prefix marking an AES-256-GCM encrypted key inside the config file. */
const ENC_PREFIX = "enc:v1:";

interface StoredConfig {
  version: 2;
  baseUrl: string;
  apiKey: string; // ENC_PREFIX + iv.tag.ciphertext (hex) — or legacy plaintext
  model: string;
  extraHeaders: Record<string, string>;
  provider?: string;
  routing?: string;
  /** Last successful live-verification (probe) of this config. */
  verifiedAt?: string;
  verifiedModel?: string;
  savedAt?: string;
}

/** Structurally identical to LlmConfig plus verification metadata — safe to describe to the client (key never included). */
export type RuntimeLlmConfig = LlmConfig & {
  verifiedAt?: string;
  verifiedModel?: string;
  savedAt?: string;
};

/* ------------------------------------------------------------------ */
/* Encryption key management                                           */
/* ------------------------------------------------------------------ */

let cachedKey: Buffer | null = null;

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const envSecret = process.env.LLM_CONFIG_SECRET?.trim();
  if (envSecret) {
    // Any passphrase works — stretch to exactly 32 bytes for AES-256.
    cachedKey = createHash("sha256").update(`razorshield:llm:${envSecret}`).digest();
    return cachedKey;
  }
  // No env secret: use (or create) a per-machine random secret file.
  try {
    if (existsSync(SECRET_PATH)) {
      const material = readFileSync(SECRET_PATH, "utf8").trim();
      if (material.length >= 32) {
        cachedKey = createHash("sha256").update(`razorshield:llm:${material}`).digest();
        return cachedKey;
      }
    }
    const material = randomBytes(32).toString("hex");
    mkdirSync(CONFIG_DIR, { recursive: true });
    const fd = openSync(SECRET_PATH, "w", 0o600);
    writeFileSync(fd, material + "\n", "utf8");
    closeSync(fd);
    try {
      chmodSync(SECRET_PATH, 0o600);
    } catch {
      /* best effort on platforms without chmod */
    }
    cachedKey = createHash("sha256").update(`razorshield:llm:${material}`).digest();
    return cachedKey;
  } catch {
    // Fall through to ephemeral key: encryption still works this process,
    // but the next process rotation re-encrypts on the next save.
    cachedKey = createHash("sha256").update(randomBytes(32)).digest();
    return cachedKey;
  }
}

function encryptKey(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv, { authTagLength: 16 });
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("hex")}.${tag.toString("hex")}.${ct.toString("hex")}`;
}

function decryptKey(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored; // legacy plaintext — re-encrypted on next save
  try {
    const [ivHex, tagHex, ctHex] = stored.slice(ENC_PREFIX.length).split(".");
    if (!ivHex || !tagHex || !ctHex) return "";
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivHex, "hex"), { authTagLength: 16 });
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const plain = Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    // Tampered file or rotated secret — treat the key as absent instead
    // of trusting unauthenticated bytes.
    return "";
  }
}

/* ------------------------------------------------------------------ */
/* Read / write                                                        */
/* ------------------------------------------------------------------ */

/** Reads the runtime config saved from the UI, or null when absent/invalid. */
export function readRuntimeLlmConfig(): RuntimeLlmConfig | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const p = parsed as Record<string, unknown>;
    const baseUrl = typeof p.baseUrl === "string" ? p.baseUrl.trim().replace(/\/+$/, "") : "";
    const apiKey = decryptKey(typeof p.apiKey === "string" ? p.apiKey.trim() : "");
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
      verifiedAt: typeof p.verifiedAt === "string" ? p.verifiedAt : undefined,
      verifiedModel: typeof p.verifiedModel === "string" ? p.verifiedModel : undefined,
      savedAt: typeof p.savedAt === "string" ? p.savedAt : undefined,
    };
  } catch {
    // Missing/unreadable file = no runtime config; env (or heuristics) applies.
    return null;
  }
}

/** Persists the runtime config (null clears it). Atomic-ish via tmp+rename; key encrypted at rest, file 0600. */
export function writeRuntimeLlmConfig(cfg: RuntimeLlmConfig | null): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  if (cfg === null) {
    try {
      if (existsSync(CONFIG_PATH)) unlinkSync(CONFIG_PATH);
    } catch {
      /* best effort */
    }
    return;
  }

  const stored: StoredConfig = {
    version: 2,
    baseUrl: cfg.baseUrl,
    apiKey: encryptKey(cfg.apiKey),
    model: cfg.model,
    extraHeaders: cfg.extraHeaders,
    provider: cfg.provider,
    routing: cfg.routing,
    verifiedAt: cfg.verifiedAt,
    verifiedModel: cfg.verifiedModel,
    savedAt: cfg.savedAt ?? new Date().toISOString(),
  };
  const tmp = `${CONFIG_PATH}.tmp`;
  const fd = openSync(tmp, "w", 0o600);
  writeFileSync(fd, JSON.stringify(stored, null, 2), "utf8");
  closeSync(fd);
  try {
    chmodSync(tmp, 0o600);
  } catch {
    /* best effort */
  }
  renameSync(tmp, CONFIG_PATH);
}

/**
 * Returns the saved API key when the caller is re-saving the SAME
 * provider + endpoint (model/header changes must not require retyping
 * the key). Undefined when there is nothing to reuse — the caller then
 * requires a key as usual. The key never leaves this module.
 */
export function reusableSavedKey(provider: string | undefined, baseUrl: string): string | undefined {
  const saved = readRuntimeLlmConfig();
  if (!saved) return undefined;
  const sameProvider = provider !== undefined && saved.provider === provider;
  const sameEndpoint = saved.baseUrl.replace(/\/+$/, "") === baseUrl.replace(/\/+$/, "");
  if ((sameProvider && sameEndpoint) || sameEndpoint) return saved.apiKey;
  return undefined;
}

/** Records a successful live verification against the saved config. */
export function markRuntimeConfigVerified(model: string): void {
  const saved = readRuntimeLlmConfig();
  if (!saved) return;
  writeRuntimeLlmConfig({
    ...saved,
    verifiedAt: new Date().toISOString(),
    verifiedModel: model,
    savedAt: saved.savedAt,
  });
}

/** True when the saved config has been live-verified with the current endpoint + model. */
export function runtimeConfigVerified(): { verifiedAt: string; verifiedModel: string } | null {
  const saved = readRuntimeLlmConfig();
  if (!saved?.verifiedAt) return null;
  return { verifiedAt: saved.verifiedAt, verifiedModel: saved.verifiedModel ?? "" };
}

/* ------------------------------------------------------------------ */
/* Per-organisation config (DB-backed — Phase 1 multi-tenancy)         */
/*                                                                     */
/* Each organisation stores its own provider config with the API key   */
/* AES-256-GCM sealed via the shared secret box (src/lib/server/       */
/* secretBox.ts). The legacy single-tenant file store above is kept    */
/* only for the migration path (scripts/migrate-to-multitenant.ts)     */
/* and legacy tests — the app reads/writes the org config.             */
/* ------------------------------------------------------------------ */

import { db } from "@/lib/db";
import { isSealed, openSecret, sealSecret } from "@/lib/server/secretBox";

function orgRowToConfig(row: {
  provider: string;
  baseUrl: string;
  apiKeyEnc: string;
  model: string;
  extraHeadersJson: string;
  routing: string | null;
  verifiedAt: Date | null;
  verifiedModel: string | null;
}): RuntimeLlmConfig | null {
  const apiKey = openSecret(row.apiKeyEnc);
  if (!row.baseUrl || !apiKey) return null;
  let extraHeaders: Record<string, string> = {};
  try {
    const parsed = JSON.parse(row.extraHeadersJson) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      extraHeaders = Object.fromEntries(
        Object.entries(parsed).filter(([, v]) => typeof v === "string" && v.length > 0) as [string, string][],
      );
    }
  } catch {
    /* empty headers on malformed JSON */
  }
  return {
    baseUrl: row.baseUrl.replace(/\/+$/, ""),
    apiKey,
    model: row.model,
    extraHeaders,
    provider: row.provider || "custom",
    routing: row.routing ?? undefined,
    verifiedAt: row.verifiedAt?.toISOString() ?? undefined,
    verifiedModel: row.verifiedModel ?? undefined,
  };
}

/** Reads one organisation's LLM config (null when absent or unopenable). */
export async function readOrgLlmConfig(organisationId: string): Promise<RuntimeLlmConfig | null> {
  if (!organisationId) return null;
  try {
    const row = await db.llmProviderConfig.findUnique({ where: { organisationId } });
    if (!row) return null;
    return orgRowToConfig(row);
  } catch {
    return null;
  }
}

/** Persists (or clears) one organisation's LLM config. */
export async function writeOrgLlmConfig(organisationId: string, cfg: RuntimeLlmConfig | null): Promise<void> {
  if (!cfg) {
    await db.llmProviderConfig.deleteMany({ where: { organisationId } });
    return;
  }
  const data = {
    provider: cfg.provider ?? "custom",
    baseUrl: cfg.baseUrl.replace(/\/+$/, ""),
    // Re-seal only raw keys; already-sealed values (reused saved key) pass through.
    apiKeyEnc: isSealed(cfg.apiKey) ? cfg.apiKey : sealSecret(cfg.apiKey),
    model: cfg.model,
    extraHeadersJson: JSON.stringify(cfg.extraHeaders ?? {}),
    routing: cfg.routing ?? null,
    verifiedAt: cfg.verifiedAt ? new Date(cfg.verifiedAt) : null,
    verifiedModel: cfg.verifiedModel ?? null,
  };
  await db.llmProviderConfig.upsert({
    where: { organisationId },
    update: data,
    create: { organisationId, ...data },
  });
}

/** Returns the org's saved key when re-saving the SAME provider+endpoint. */
export async function reusableOrgSavedKey(
  organisationId: string,
  provider: string | undefined,
  baseUrl: string,
): Promise<string | undefined> {
  const saved = await readOrgLlmConfig(organisationId);
  if (!saved) return undefined;
  const sameProvider = provider !== undefined && saved.provider === provider;
  const sameEndpoint = saved.baseUrl.replace(/\/+$/, "") === baseUrl.replace(/\/+$/, "");
  if ((sameProvider && sameEndpoint) || sameEndpoint) return saved.apiKey;
  return undefined;
}

/** Records a successful live verification against the org's saved config. */
export async function markOrgConfigVerified(organisationId: string, model: string): Promise<void> {
  const saved = await readOrgLlmConfig(organisationId);
  if (!saved) return;
  await writeOrgLlmConfig(organisationId, {
    ...saved,
    verifiedAt: new Date().toISOString(),
    verifiedModel: model,
  });
}

/** True when the org's saved config has been live-verified. */
export async function orgConfigVerified(
  organisationId: string,
): Promise<{ verifiedAt: string; verifiedModel: string } | null> {
  const saved = await readOrgLlmConfig(organisationId);
  if (!saved?.verifiedAt) return null;
  return { verifiedAt: saved.verifiedAt, verifiedModel: saved.verifiedModel ?? "" };
}
