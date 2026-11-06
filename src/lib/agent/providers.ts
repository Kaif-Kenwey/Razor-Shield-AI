/**
 * RazorShield AI — LLM provider registry.
 *
 * Client-safe metadata only (no secrets, no calls): every provider's
 * identity, default endpoint, model-catalogue support and signup links.
 * The server side (src/app/api/llm/models) uses the same ids to fetch
 * LIVE model catalogues — free-model lists are never hardcoded here,
 * they come from each provider's own pricing metadata at fetch time.
 */

export type ProviderId = "openrouter" | "gemini" | "groq" | "ollama" | "custom";

export interface ProviderMeta {
  id: ProviderId;
  name: string;
  tagline: string;
  description: string;
  /** Default OpenAI-compatible base URL (root — /chat/completions is appended). */
  baseUrl: string;
  /** Whether chat usage needs an API key. Ollama (local) does not. */
  requiresKey: boolean;
  /** Whether this provider exposes a fetchable model catalogue. */
  hasCatalogue: boolean;
  /** Whether the catalogue endpoint itself needs a key. */
  catalogueNeedsKey: boolean;
  /** Official key / signup page for the "Get an API key" link. */
  keyUrl?: string;
  docsUrl?: string;
  /** Short setup hint shown under the key field. */
  setupHint: string;
  /** Free-tier / pricing note — kept factual, provider wording varies. */
  pricingNote: string;
  /** Is the endpoint local to the machine running the app? */
  local: boolean;
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    tagline: "One key, many model families",
    description:
      "Routes to dozens of providers through a single OpenAI-compatible API. The catalogue includes genuinely zero-cost models — fetched live, never hardcoded.",
    baseUrl: "https://openrouter.ai/api/v1",
    requiresKey: true,
    hasCatalogue: true,
    catalogueNeedsKey: false,
    keyUrl: "https://openrouter.ai/keys",
    docsUrl: "https://openrouter.ai/docs",
    setupHint: "Create a key at openrouter.ai/keys — free models work on a $0 balance.",
    pricingNote:
      "Model list is fetched live; FREE labels come from each model's own pricing metadata (prompt+completion = $0). Free models carry provider-specific rate limits.",
    local: false,
  },
  {
    id: "gemini",
    name: "Google Gemini",
    tagline: "Developer API, OpenAI-compatible",
    description:
      "Google's Gemini Developer API exposes an OpenAI-compatible endpoint, so the same client code drives it.",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    requiresKey: true,
    hasCatalogue: true,
    catalogueNeedsKey: true,
    keyUrl: "https://aistudio.google.com/apikey",
    docsUrl: "https://ai.google.dev/gemini-api/docs",
    setupHint: "Get a key from Google AI Studio (aistudio.google.com/apikey).",
    pricingNote:
      "The free API plan covers selected models with changing quotas — FREE labels here reflect the live catalogue metadata, not a blanket claim.",
    local: false,
  },
  {
    id: "groq",
    name: "Groq",
    tagline: "Fast inference, OpenAI-compatible",
    description:
      "LPU-hosted open models with an OpenAI-compatible API. Model catalogue is fetched live from the provider.",
    baseUrl: "https://api.groq.com/openai/v1",
    requiresKey: true,
    hasCatalogue: true,
    catalogueNeedsKey: true,
    keyUrl: "https://console.groq.com/keys",
    docsUrl: "https://console.groq.com/docs",
    setupHint: "Create a key at console.groq.com/keys.",
    pricingNote:
      "Some listed models are billed per token — FREE labels come from live metadata only; Groq plan rate limits apply either way.",
    local: false,
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    tagline: "No cloud, no key",
    description:
      "Runs on the machine hosting Ollama. Models are the ones YOU have installed — the list is fetched from the local server, never assumed.",
    baseUrl: "http://localhost:11434/v1",
    requiresKey: false,
    hasCatalogue: true,
    catalogueNeedsKey: false,
    docsUrl: "https://ollama.com/docs",
    setupHint: "Install Ollama, pull a model (e.g. `ollama pull llama3.2`), then test the connection.",
    pricingNote: "Local inference — nothing leaves the machine. Only installed models appear.",
    local: true,
  },
  {
    id: "custom",
    name: "Custom endpoint",
    tagline: "Any OpenAI-compatible API",
    description:
      "Together AI, Fireworks, vLLM, private gateways — enter the base URL, key, model id and any extra headers yourself.",
    baseUrl: "",
    requiresKey: true,
    hasCatalogue: false,
    catalogueNeedsKey: false,
    setupHint: "Enter the OpenAI-compatible root URL — /chat/completions is appended automatically.",
    pricingNote: "Pricing depends entirely on your provider — check their docs.",
    local: false,
  },
];

export function providerById(id: string): ProviderMeta | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
