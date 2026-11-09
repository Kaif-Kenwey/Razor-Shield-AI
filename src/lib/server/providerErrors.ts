/**
 * Shared, honest mapping of provider HTTP failures for the LLM panel.
 *
 * The previous behaviour collapsed every 401 AND 403 into "the endpoint
 * rejected the API key" — which is actively misleading: a 403 is usually
 * NOT about the key at all. Providers answer 403 for region/IP/WAF blocks
 * (Groq, for instance, refuses requests from many datacenter IPs before
 * authentication is even evaluated), suspended organisations, or
 * key-restriction rules. Real "bad key" answers are 401s that carry the
 * provider's own message (e.g. Groq: {"error":{"message":"Invalid API
 * Key","code":"invalid_api_key"}}).
 *
 * This module therefore:
 *   1. extracts the provider's own error message from the response body,
 *   2. maps the status code to wording that distinguishes a rejected KEY
 *      (401) from refused ACCESS (403),
 *   3. surfaces the provider's verbatim message so operators can see the
 *      actual reason instead of a guess.
 *
 * Server-side only — imported exclusively from API routes.
 */

/** Pull the provider's own human-readable message out of an error body. */
export function extractProviderMessage(bodyText: string | null | undefined): string | undefined {
  if (!bodyText) return undefined;
  const trimmed = bodyText.trim();
  if (!trimmed) return undefined;
  try {
    const data: unknown = JSON.parse(trimmed);
    const candidates: unknown[] = [
      (data as { error?: { message?: unknown } })?.error?.message,
      (data as { error?: unknown })?.error, // e.g. error: "Invalid API Key"
      (data as { message?: unknown })?.message,
      (data as { detail?: unknown })?.detail,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) {
        const msg = c.trim();
        return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
      }
    }
    return undefined;
  } catch {
    // Non-JSON body — show a short verbatim snippet when it is plain text.
    const oneLine = trimmed.replace(/\s+/g, " ");
    if (!oneLine || oneLine.startsWith("<")) return undefined; // HTML error pages are noise
    return oneLine.length > 160 ? `${oneLine.slice(0, 160)}…` : oneLine;
  }
}

function withProviderMessage(message: string, providerMessage?: string): string {
  return providerMessage ? `${message} Provider said: “${providerMessage}”` : message;
}

/**
 * Status → operator-facing message. `providerName` personalises the
 * advice when the failure is the network-level 403 case.
 */
export function describeProviderHttpFailure(
  status: number,
  providerMessage?: string,
  providerName?: string,
): string {
  if (status === 401) {
    return withProviderMessage(
      "Authentication failed (HTTP 401) — the endpoint rejected this API key. Check for typos or create a new key.",
      providerMessage,
    );
  }
  if (status === 403) {
    const who = providerName ? providerName : "the provider";
    return withProviderMessage(
      `Access refused (HTTP 403) — ${who} blocked the request itself, which is usually an IP/region or firewall (WAF) block rather than a bad key. ` +
        `Some providers (e.g. Groq) refuse requests from many datacenter IPs entirely — the key can still be valid. ` +
        `If this machine's network is blocked, try a provider that is reachable from it (OpenRouter and Gemini work on most hosts), Ollama, or a custom gateway endpoint.`,
      providerMessage,
    );
  }
  if (status === 404) {
    return withProviderMessage(
      "Endpoint not found (HTTP 404) — check the base URL. It should end at the version root (e.g. /v1); /models and /chat/completions are appended automatically.",
      providerMessage,
    );
  }
  if (status === 429) {
    return withProviderMessage(
      "Rate limited by the provider (HTTP 429) — wait a moment and try again.",
      providerMessage,
    );
  }
  if (status >= 500) {
    return withProviderMessage(
      `Provider unavailable (HTTP ${status}) — their service is having trouble; try again shortly.`,
      providerMessage,
    );
  }
  return withProviderMessage(`Endpoint responded HTTP ${status}.`, providerMessage);
}
