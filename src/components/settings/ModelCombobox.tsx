"use client";

/**
 * Model picker for the AI configuration panel.
 *
 * A searchable command palette (cmdk) inside a Popover that renders the
 * LIVE catalogue state returned by POST /api/llm/models. Every state the
 * server can produce is rendered honestly:
 *
 *   loading          → skeleton rows (never a fake list)
 *   needs-auth       → "add your key" notice (catalogue needs a key)
 *   unsupported      → the server's note (custom endpoints)
 *   error            → the server's friendly error, verbatim
 *   ready            → the fetched models (FREE only when free === true)
 *
 * The FREE badge is driven purely by model.free from the provider's own
 * pricing metadata — paid models are never labelled free. Nothing here
 * hardcodes a model list.
 */

import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ChevronsUpDown,
  KeyRound,
  Loader2,
  RefreshCw,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** One catalogue entry — structurally identical to the server's CatalogueModel. */
export interface CatalogueModel {
  id: string;
  name: string;
  free: boolean;
  contextLength?: number;
  providerName?: string;
  note?: string;
}

/** Everything POST /api/llm/models can answer, collapsed to render states. */
export type ModelCatalogueState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "needs-auth" }
  | { kind: "unsupported"; note: string }
  | { kind: "error"; message: string }
  | { kind: "ready"; models: CatalogueModel[] };

/**
 * OpenRouter-only virtual option: the investigator routes to a free model
 * automatically. Saved as model "openrouter/free" with routing "openrouter/free".
 */
export const AUTOMATIC_FREE_MODEL_ID = "openrouter/free";

const AUTOMATIC_SEARCH_VALUE = "automatic free model openrouter/free";

/** 131072 → "131k", 1048576 → "1M" — compact context-length label. */
export function formatContext(n: number | undefined): string | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000) {
    const m = Math.round(n / 100_000) / 10;
    return `${Number.isInteger(m) ? m.toString() : m.toFixed(1)}M`;
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

/** FREE badge — rendered only for model.free === true. */
function FreeBadge() {
  return (
    <span className="shrink-0 rounded-sm border border-risk-low/40 bg-risk-low/10 px-1 py-px text-[9px] font-semibold tracking-wider text-risk-low">
      FREE
    </span>
  );
}

function TinyChip({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-sm border border-line bg-surface-2 px-1 py-px text-[9px] text-slate-500">
      {children}
    </span>
  );
}

function CatalogueSkeleton() {
  return (
    <div className="space-y-3 p-3" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3 w-3/5 bg-surface-3" />
          <Skeleton className="h-2.5 w-2/5 bg-surface-3" />
        </div>
      ))}
    </div>
  );
}

function StateNotice({
  icon: Icon,
  tone,
  title,
  body,
}: {
  icon: LucideIcon;
  tone: "intel" | "error";
  title: string;
  body?: string;
}) {
  return (
    <div className="flex items-start gap-2.5 px-3.5 py-6">
      <Icon
        className={cn("mt-0.5 h-4 w-4 shrink-0", tone === "intel" ? "text-intel" : "text-risk-critical")}
        aria-hidden
      />
      <div className="min-w-0">
        <p className={cn("text-[12px] leading-snug", tone === "intel" ? "text-slate-200" : "text-risk-critical")}>
          {title}
        </p>
        {body && <p className="mt-1 text-[10.5px] leading-snug text-slate-500">{body}</p>}
      </div>
    </div>
  );
}

function ModelRow({
  m,
  selected,
  onPick,
}: {
  m: CatalogueModel;
  selected: boolean;
  onPick: (id: string) => void;
}) {
  const ctx = formatContext(m.contextLength);
  return (
    <CommandItem
      value={`${m.name} ${m.id}`}
      onSelect={() => onPick(m.id)}
      className="gap-2 py-2"
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[12px] font-medium text-slate-200">{m.name}</span>
          {m.free && <FreeBadge />}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono text-[10px] text-slate-500">{m.id}</span>
          {m.providerName && <TinyChip>{m.providerName}</TinyChip>}
          {ctx && (
            <span className="ml-auto shrink-0 font-mono text-[9.5px] text-slate-600">{ctx} ctx</span>
          )}
        </div>
      </div>
      <Check
        className={cn("h-3.5 w-3.5 shrink-0", selected ? "text-intel" : "opacity-0")}
        aria-hidden
      />
    </CommandItem>
  );
}

export interface ModelComboboxProps {
  state: ModelCatalogueState;
  /** Selected model id ("" = nothing selected). */
  value: string;
  onSelect: (modelId: string) => void;
  onRefresh: () => void;
  freeOnly: boolean;
  onFreeOnlyChange: (freeOnly: boolean) => void;
  /** OpenRouter-only: show the "Automatic Free Model" virtual option first. */
  showAutomaticOption: boolean;
}

export function ModelCombobox({
  state,
  value,
  onSelect,
  onRefresh,
  freeOnly,
  onFreeOnlyChange,
  showAutomaticOption,
}: ModelComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const needle = search.trim().toLowerCase();

  const visibleModels = useMemo<CatalogueModel[]>(() => {
    if (state.kind !== "ready") return [];
    return state.models.filter((m) => {
      if (freeOnly && !m.free) return false;
      if (!needle) return true;
      return (
        m.name.toLowerCase().includes(needle) ||
        m.id.toLowerCase().includes(needle) ||
        (m.providerName?.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [state, freeOnly, needle]);

  const automaticVisible =
    showAutomaticOption && (!needle || AUTOMATIC_SEARCH_VALUE.includes(needle));

  const selectedModel = state.kind === "ready" ? state.models.find((m) => m.id === value) : undefined;
  const label =
    value === AUTOMATIC_FREE_MODEL_ID
      ? "Automatic Free Model"
      : value
        ? (selectedModel?.name ?? value)
        : null;
  const loading = state.kind === "loading";

  function pick(id: string) {
    onSelect(id);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={label ? `Model: ${label} — open the model picker` : "Open the model picker"}
          disabled={state.kind === "needs-auth" || state.kind === "unsupported"}
          className={cn(
            "h-9 w-full justify-between border-line bg-surface-1 px-3 text-left font-normal hover:bg-surface-2",
            !label && "text-slate-500"
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-intel" aria-hidden />
            ) : null}
            <span className={cn("truncate text-[12px]", label ? "text-slate-200" : "text-slate-500")}>
              {loading ? "Loading models…" : (label ?? "Search and select a model")}
            </span>
            {selectedModel?.free && !loading && <FreeBadge />}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[var(--radix-popover-trigger-width)] border-line bg-surface-1 p-0"
      >
        {/* Toolbar — free-only filter + manual refresh, both inside the picker */}
        <div className="flex items-center justify-between gap-2 border-b border-line px-2.5 py-2">
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-400">
            <Switch
              checked={freeOnly}
              onCheckedChange={onFreeOnlyChange}
              disabled={state.kind !== "ready"}
              aria-label="Show free models only"
              className="data-[state=checked]:bg-intel/80 data-[state=unchecked]:bg-surface-3"
            />
            Free only
          </label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh the model list from the provider"
            className="h-7 gap-1.5 rounded-sm px-2 text-[11px] text-slate-400 hover:bg-surface-2 hover:text-slate-200"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-3 w-3" aria-hidden />
            )}
            Refresh models
          </Button>
        </div>

        <Command shouldFilter={false} className="bg-transparent">
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search by name or model id…"
            className="text-[12px] text-slate-200 placeholder:text-slate-600"
          />
          <CommandList className="max-h-72">
            {state.kind === "loading" && <CatalogueSkeleton />}

            {state.kind === "needs-auth" && (
              <StateNotice
                icon={KeyRound}
                tone="intel"
                title="Add your API key below to load the model list."
                body="The catalogue request needs the key — it is sent to the provider once and never stored in the browser."
              />
            )}

            {state.kind === "unsupported" && (
              <StateNotice icon={Sparkles} tone="intel" title={state.note} />
            )}

            {state.kind === "error" && (
              <StateNotice
                icon={AlertTriangle}
                tone="error"
                title={state.message}
                body="Hit “Refresh models” to try again."
              />
            )}

            {state.kind === "ready" && (
              <>
                <CommandEmpty>
                  <span className="text-[11.5px] text-slate-500">
                    No models match “{search}”
                    {freeOnly ? " with “Free only” on" : ""} — clear the filter and try again.
                  </span>
                </CommandEmpty>

                {automaticVisible && (
                  <CommandGroup heading="Recommended" className="text-slate-500">
                    <CommandItem
                      value={AUTOMATIC_SEARCH_VALUE}
                      onSelect={() => pick(AUTOMATIC_FREE_MODEL_ID)}
                      className="gap-2 py-2"
                    >
                      <span
                        className="mt-0.5 shrink-0 rounded-sm border border-intel/30 bg-intel/10 p-1"
                        aria-hidden
                      >
                        <Sparkles className="h-3.5 w-3.5 text-intel" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-[12px] font-medium text-slate-100">
                            Automatic Free Model
                          </span>
                          <FreeBadge />
                        </div>
                        <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                          <span className="truncate font-mono text-[10px] text-slate-500">
                            {AUTOMATIC_FREE_MODEL_ID}
                          </span>
                          <span className="truncate text-[10px] text-slate-600">
                            routes to a free model automatically
                          </span>
                        </div>
                      </div>
                      <Check
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          value === AUTOMATIC_FREE_MODEL_ID ? "text-intel" : "opacity-0"
                        )}
                        aria-hidden
                      />
                    </CommandItem>
                  </CommandGroup>
                )}

                {automaticVisible && visibleModels.length > 0 && <CommandSeparator className="bg-line" />}

                {visibleModels.length > 0 && (
                  <CommandGroup
                    heading={freeOnly ? `Free models (${visibleModels.length})` : `All models (${visibleModels.length})`}
                    className="text-slate-500"
                  >
                    {visibleModels.map((m) => (
                      <ModelRow key={m.id} m={m} selected={m.id === value} onPick={pick} />
                    ))}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
