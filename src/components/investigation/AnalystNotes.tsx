"use client";

/**
 * ANALYST NOTEBOOK — an append-only per-case notebook.
 * The analyst voice between the AI's conclusion and the final bounded
 * action: call notes, customer confirmations, escalations. Entries are
 * SERVER-PERSISTED (CaseNote table, audited as NOTE_ADDED) and stamped
 * with the signed-in analyst identity — the notebook is part of the case
 * record, so it survives reloads, other browsers and demo-data clears.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CornerDownLeft, Loader2, NotebookPen, Zap } from "lucide-react";
import { useAppStore, type CaseNote } from "@/store/appStore";
import { useAddCaseNote, useCaseNotes } from "@/hooks/useLedger";
import { useToast } from "@/hooks/use-toast";
import { ANALYSTS } from "@/data/mockData";
import { isTypingTarget } from "@/components/layout/KeyboardShortcuts";
import { relativeTime, timeHHMMSS } from "@/lib/format";
import { cn } from "@/lib/utils";

const MAX_NOTE = 240;

/** One-tap composer presets — the phrases analysts actually log on live demos. */
const QUICK_CHIPS: { label: string; text: string }[] = [
  { label: "Called customer", text: "Called customer on file number — call picked up, identity verified." },
  { label: "Confirmed travel", text: "Customer confirmed travel; location anomaly explained." },
  { label: "Escalated to L3", text: "Escalated to L3 fraud desk for chargeback review." },
  { label: "Requested docs", text: "Requested supporting documents; holding action pending response." },
  { label: "OTP verified", text: "Step-up OTP verified with the customer on record." },
];

export function AnalystNotes({ txnId }: { txnId: string }) {
  const storeNotes = useAppStore((s) => s.caseNotes[txnId]);
  const setCaseNotes = useAppStore((s) => s.setCaseNotes);
  const signedInId = useAppStore((s) => s.signedInAnalystId);
  const highlightNoteId = useAppStore((s) => s.highlightNoteId);
  const setHighlightNoteId = useAppStore((s) => s.setHighlightNoteId);
  const notesQuery = useCaseNotes(txnId);
  const addNote = useAddCaseNote(txnId);
  const { toast } = useToast();
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightRef = useRef<HTMLLIElement | null>(null);

  /* SERVER SOURCE OF TRUTH — the query result feeds the list AND the
   * store cache (case-file export, printing and the investigations list
   * read the store). A failed fetch keeps the cached entries visible. */
  const list: CaseNote[] = notesQuery.data ?? storeNotes ?? [];

  useEffect(() => {
    if (!notesQuery.data) return;
    const cached = storeNotes ?? [];
    if (cached.length !== notesQuery.data.length || cached.some((n, i) => notesQuery.data[i]?.id !== n.id)) {
      setCaseNotes(txnId, notesQuery.data);
    }
  }, [notesQuery.data, txnId]);

  /* palette jump — bring the entry into view, flash it, then drop the spotlight */
  useEffect(() => {
    if (!highlightNoteId || !list.some((n) => n.id === highlightNoteId)) return;
    const raf = requestAnimationFrame(() => {
      highlightRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    const clear = setTimeout(() => setHighlightNoteId(null), 2200);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(clear);
    };
  }, [highlightNoteId, list, setHighlightNoteId]);

  /** SERVER-PERSISTED: POST /api/transactions/:id/notes — the entry only
   * appears once the database confirms; failures keep the draft. */
  const submit = async () => {
    const text = draft.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      const note = await addNote.mutateAsync({ text, analystId: signedInId });
      setCaseNotes(txnId, [...(useAppStore.getState().caseNotes[txnId] ?? []), note]);
      setHighlightNoteId(note.id);
      setDraft("");
    } catch (err) {
      toast({
        title: "Note not saved",
        description: err instanceof Error && err.message ? err.message : "The server rejected the entry — try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const insertChip = (text: string) => {
    setDraft((d) => {
      const base = d.trim();
      const next = base ? `${base} ${text}` : text;
      return next.slice(0, MAX_NOTE);
    });
    // keep the caret where an analyst expects it — end of the composed text
    requestAnimationFrame(() => {
      const el = composerRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  };

  // ⌥1..⌥5 — quick-insert without leaving the keyboard; only when the
  // composer owns focus (or nothing does) so other inputs stay untouched.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      const idx = Number(e.key) - 1;
      if (!Number.isInteger(idx) || idx < 0 || idx >= QUICK_CHIPS.length) return;
      const active = document.activeElement;
      if (active !== composerRef.current && active !== document.body) return;
      if (active !== composerRef.current && isTypingTarget(active)) return;
      e.preventDefault();
      insertChip(QUICK_CHIPS[idx].text);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <section className="panel overflow-hidden" aria-label="Analyst notebook">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <p className="micro-11 flex items-center gap-1.5 font-semibold text-slate-200">
          <NotebookPen className="h-3.5 w-3.5 text-intel" aria-hidden />
          Analyst notebook
        </p>
        <span className="num shrink-0 rounded-sm border border-line bg-surface-1 px-1.5 py-0.5 text-[10px] text-slate-500" aria-live="polite">
          {list.length} {list.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      <div className="px-4 py-4">
        {/* Composer */}
        <div className="rounded-sm border border-line bg-surface-1 transition-colors focus-within:border-intel/45">
          <label htmlFor={`note-composer-${txnId}`} className="sr-only">
            Add a notebook entry
          </label>
          <textarea
            id={`note-composer-${txnId}`}
            ref={composerRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_NOTE))}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            rows={2}
            placeholder="Log a call, a customer confirmation, an escalation…"
            className="w-full resize-none bg-transparent px-3 py-2.5 text-[12.5px] leading-relaxed text-slate-200 placeholder:text-slate-600 focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-1.5">
            <p className="num text-[10px] text-slate-600">
              {draft.length}/{MAX_NOTE}
              <span className="ml-2 hidden sm:inline">append-only — entries cannot be edited</span>
            </p>
            <button
              onClick={() => void submit()}
              disabled={!draft.trim() || submitting}
              className={cn(
                "flex h-6.5 shrink-0 items-center gap-1.5 rounded-sm border px-2 text-[10.5px] font-semibold transition-all active:scale-95",
                draft.trim() && !submitting
                  ? "border-intel/45 bg-intel/12 text-intel hover:bg-intel/20"
                  : "cursor-not-allowed border-line bg-surface-2 text-slate-600"
              )}
            >
              {submitting ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <CornerDownLeft className="h-3 w-3" aria-hidden />
              )}
              {submitting ? "Saving…" : "Add entry"}
              <kbd className="hidden rounded border border-line bg-surface-2 px-1 font-mono text-[9px] text-slate-500 sm:inline">
                ⌘↵
              </kbd>
            </button>
          </div>
        </div>

        {/* Quick-insert chips — demo-speed logging */}
        <div
          className="mt-2.5 flex flex-wrap items-center gap-1.5"
          role="toolbar"
          aria-label="Quick insert phrases"
        >
          <span className="micro flex items-center gap-1 text-slate-600">
            <Zap className="h-3 w-3 text-intel/60" aria-hidden />
            Quick
          </span>
          {QUICK_CHIPS.map((chip, i) => {
            const full = draft.trim().length + chip.text.length + (draft.trim() ? 1 : 0) > MAX_NOTE;
            return (
              <button
                key={chip.label}
                type="button"
                onClick={() => insertChip(chip.text)}
                disabled={full}
                title={`${chip.text}${full ? " — composer full" : ""}`}
                className={cn(
                  "group/chip flex h-6 items-center gap-1.5 rounded-full border border-dashed px-2.5 text-[10.5px] font-medium transition-all active:scale-95",
                  full
                    ? "cursor-not-allowed border-line bg-transparent text-slate-700"
                    : "border-intel/30 bg-intel/[0.04] text-slate-400 hover:border-intel/55 hover:bg-intel/12 hover:text-intel hover:shadow-[0_0_12px_-4px_rgba(139,92,246,0.55)]"
                )}
              >
                {chip.label}
                <kbd className="hidden rounded border border-line bg-surface-2 px-1 font-mono text-[8.5px] text-slate-600 group-hover/chip:border-intel/25 group-hover/chip:text-intel/70 sm:inline">
                  ⌥{i + 1}
                </kbd>
              </button>
            );
          })}
        </div>

        {/* Entries */}
        {list.length > 0 ? (
          <ol className="mt-3.5 space-y-2.5" aria-label="Notebook entries">
            <AnimatePresence initial={false}>
              {[...list].reverse().map((n) => {
                const analyst = ANALYSTS.find((a) => a.id === n.analystId);
                const spotlit = n.id === highlightNoteId;
                return (
                  <motion.li
                    key={n.id}
                    ref={spotlit ? highlightRef : undefined}
                    initial={{ opacity: 0, y: -6, backgroundColor: "rgba(139, 92, 246, 0.10)" }}
                    animate={
                      spotlit
                        ? {
                            opacity: 1,
                            y: 0,
                            backgroundColor: [
                              "rgba(139, 92, 246, 0.30)",
                              "rgba(139, 92, 246, 0.08)",
                              "rgba(139, 92, 246, 0.22)",
                              "rgba(139, 92, 246, 0)",
                            ],
                          }
                        : { opacity: 1, y: 0, backgroundColor: "rgba(139, 92, 246, 0)" }
                    }
                    transition={spotlit ? { duration: 1.8, ease: "easeOut" } : { duration: 0.9, ease: "easeOut" }}
                    data-note-highlight={spotlit ? "true" : undefined}
                    className={cn(
                      "rounded-sm border bg-surface-1 px-3 py-2.5",
                      spotlit && "border-intel/55 shadow-[0_0_20px_-6px_rgba(139,92,246,0.75)]"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border num text-[8px] font-bold",
                          n.analystId === signedInId
                            ? "border-intel/40 bg-intel/10 text-intel"
                            : "border-line-strong bg-surface-2 text-slate-400"
                        )}
                        aria-hidden
                      >
                        {analyst?.initials ?? "??"}
                      </span>
                      <span className="text-[11.5px] font-medium text-slate-300">
                        {analyst?.name ?? n.analystId}
                        {n.analystId === signedInId && <span className="ml-1.5 text-[10px] text-intel/80">· you</span>}
                      </span>
                      <span className="ml-auto flex items-baseline gap-2">
                        <span className="num text-[10px] text-slate-600">{timeHHMMSS(n.at)}</span>
                        <span className="num hidden text-[9.5px] text-slate-700 sm:inline">{relativeTime(n.at)}</span>
                      </span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap break-words border-l-2 border-intel/25 pl-2.5 text-[12px] leading-relaxed text-slate-300">
                      {n.text}
                    </p>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ol>
        ) : (
          <p className="mt-3.5 rounded-sm border border-dashed border-line bg-surface-1/60 px-3 py-3 text-center text-[11.5px] text-slate-600">
            No entries yet — anything logged here is saved to the ledger and travels with the case file, the audit trail and the printout.
          </p>
        )}
      </div>
    </section>
  );
}
