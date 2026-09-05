"use client";

/**
 * Dataset Studio — import & analyze pipeline (single view, 4 stages).
 *
 *   import → map → analyzing → results
 *
 * A CSV of payment records is dropped in, its columns are auto-mapped onto
 * the engine fields (editable), and the batch is scored server-side by the
 * deterministic risk engine. Labeled files additionally get honest quality
 * metrics — precision, recall and the rupee cost of every mistake.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  FileUp,
  FlaskConical,
  History,
  Loader2,
  Play,
  Trash2,
  UploadCloud,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatasetResults } from "@/components/datastudio/DatasetResults";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/appStore";
import {
  detectMapping,
  downloadSampleCsv,
  parseCsv,
} from "@/lib/csv";
import { formatINR, formatNumber, relativeTime } from "@/lib/format";
import { datasetApi } from "@/services/datasetApi";
import {
  DATASET_LIMITS,
  EMPTY_MAPPING,
  type ColumnMapping,
  type DatasetAnalysis,
  type DatasetSummary,
  type EngineField,
  type RawRow,
} from "@/types/dataset";
import { cn } from "@/lib/utils";

type Stage = "import" | "map" | "analyzing" | "results";

/** Engine fields the mapper exposes, with human labels + hints. */
const FIELDS: { key: EngineField; label: string; required?: boolean; hint: string }[] = [
  { key: "amount", label: "Amount (₹)", required: true, hint: "Transaction value — the one column the engine cannot work without" },
  { key: "txnId", label: "Transaction ID", hint: "Reference / UTR / order id" },
  { key: "timestamp", label: "Timestamp", hint: "ISO or DD/MM/YYYY — drives velocity, travel & odd-hour rules" },
  { key: "customerId", label: "Customer ID", hint: "Groups rows per customer for baseline rules" },
  { key: "customerName", label: "Customer name", hint: "Shown in the drill-down" },
  { key: "merchant", label: "Merchant", hint: "Merchant-outlier rule" },
  { key: "location", label: "Location / city", hint: "Location & impossible-travel rules" },
  { key: "device", label: "Device", hint: "New-device rule" },
  { key: "paymentMethod", label: "Payment method", hint: "UPI / card / netbanking / wallet" },
  { key: "label", label: "Fraud label", hint: "1/0, true/false or yes/no — enables precision & recall" },
];

const ANALYZE_STAGES = [
  "Normalizing records",
  "Building customer baselines",
  "Scoring against the risk engine",
  "Evaluating quality metrics",
  "Persisting the run",
];

/* small helpers ----------------------------------------------------- */

function bytesLabel(n: number): string {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/* main --------------------------------------------------------------- */

export function DataStudioView() {
  const { toast } = useToast();
  const loadingBoard = useAppStore((s) => s.loading);

  const [stage, setStage] = useState<Stage>("import");
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [delimiter, setDelimiter] = useState(",");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<RawRow[]>([]);
  const [malformed, setMalformed] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>({ ...EMPTY_MAPPING });
  const [datasetName, setDatasetName] = useState("");
  const [analysis, setAnalysis] = useState<DatasetAnalysis | null>(null);
  const [history, setHistory] = useState<DatasetSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [analyzeStage, setAnalyzeStage] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const amountMapped = Boolean(mapping.amount);
  const labelsDetected = Boolean(mapping.label);

  const loadHistory = useCallback(async () => {
    try {
      const { datasets } = await datasetApi.list();
      setHistory(datasets);
    } catch {
      /* history is a nicety — silence transient failures */
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (stage === "import") void loadHistory();
  }, [stage, loadHistory]);

  /* ---- file intake -------------------------------------------------- */

  const ingestText = useCallback(
    (text: string, name: string, size: number) => {
      const parsed = parseCsv(text);
      if (!parsed.rows.length) {
        toast({
          title: "No data rows found",
          description: "The file needs a header row plus at least one record.",
        });
        return;
      }
      setFileName(name);
      setFileSize(size);
      setDelimiter(parsed.delimiter === "\t" ? "tab" : parsed.delimiter);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setMalformed(parsed.malformedCount);
      setMapping(detectMapping(parsed.headers));
      setDatasetName(name.replace(/\.[^.]+$/, "").slice(0, 80) || "Imported dataset");
      setStage("map");
      toast({
        title: "File parsed",
        description: `${formatNumber(parsed.rows.length)} rows · ${parsed.headers.length} columns${parsed.malformedCount ? ` · ${parsed.malformedCount} malformed skipped` : ""}.`,
      });
    },
    [toast],
  );

  const onFile = useCallback(
    (file: File | null | undefined) => {
      if (!file) return;
      if (file.size > DATASET_LIMITS.maxFileBytes) {
        toast({
          title: "File too large",
          description: `Dataset Studio accepts up to ${bytesLabel(DATASET_LIMITS.maxFileBytes)} per import.`,
        });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => ingestText(String(reader.result ?? ""), file.name, file.size);
      reader.onerror = () =>
        toast({ title: "Could not read the file", description: "Try re-exporting it as plain CSV." });
      reader.readAsText(file);
    },
    [ingestText, toast],
  );

  /* ---- analyze ------------------------------------------------------- */

  const runAnalysis = useCallback(async () => {
    if (!amountMapped || submitting) return;
    setSubmitting(true);
    setStage("analyzing");
    setAnalyzeStage(0);

    // stage animation rides alongside the real request
    const ticker = setInterval(() => setAnalyzeStage((s) => Math.min(s + 1, ANALYZE_STAGES.length - 1)), 420);

    try {
      const started = Date.now();
      const { analysis: result } = await datasetApi.analyze({
        name: datasetName.trim() || fileName,
        sourceFile: fileName,
        headers,
        rows,
        mapping,
      });
      // let the last stage breathe for a beat so the sequence is legible
      const elapsed = Date.now() - started;
      if (elapsed < 1600) await new Promise((r) => setTimeout(r, 1600 - elapsed));

      setAnalysis(result);
      setStage("results");
      toast({
        title: "Analysis complete",
        description: `${formatNumber(result.rowCount)} rows scored · ${result.flaggedCount} alert${result.flaggedCount === 1 ? "" : "s"}${
          result.metrics.labelsPresent ? ` · precision ${result.metrics.precision.toFixed(1)}%` : ""
        }.`,
      });
    } catch (err) {
      setStage("map");
      toast({
        title: "Analysis failed",
        description: err instanceof Error ? err.message : "Unexpected error — check the server log.",
      });
    } finally {
      clearInterval(ticker);
      setSubmitting(false);
    }
  }, [amountMapped, submitting, datasetName, fileName, headers, rows, mapping, toast]);

  const openStored = useCallback(
    async (id: string) => {
      try {
        const { analysis: stored } = await datasetApi.get(id);
        setAnalysis(stored);
        setStage("results");
      } catch (err) {
        toast({
          title: "Could not open dataset",
          description: err instanceof Error ? err.message : "It may have been deleted.",
        });
        void loadHistory();
      }
    },
    [loadHistory, toast],
  );

  const deleteStored = useCallback(
    async (id: string) => {
      try {
        await datasetApi.remove(id);
        setHistory((h) => h.filter((d) => d.id !== id));
        toast({ title: "Dataset deleted" });
      } catch {
        toast({ title: "Delete failed", description: "The dataset may already be gone." });
      }
    },
    [toast],
  );

  const resetToImport = useCallback(() => {
    setStage("import");
    setAnalysis(null);
    setRows([]);
    setHeaders([]);
    setMapping({ ...EMPTY_MAPPING });
    setFileName("");
  }, []);

  const previewRows = rows.slice(0, 6);
  const previewCols = headers.slice(0, 8);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-6 lg:px-8" data-testid="datastudio">
      {/* header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight text-slate-100">
            <span className="flex h-8 w-8 items-center justify-center rounded-sm border border-intel/30 bg-intel/10">
              <Database className="h-4 w-4 text-intel" aria-hidden />
            </span>
            Dataset Studio
          </h1>
          <p className="micro mt-1.5 max-w-2xl leading-relaxed text-slate-500">
            Import real payment data — any CSV export works. Map the columns, and the risk engine
            scores every row server-side. Files with a fraud label also get honest precision &amp; recall,
            plus the rupee cost of every mistake.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {stage !== "import" && stage !== "results" && (
            <Button variant="ghost" size="sm" onClick={() => setStage("import")} className="gap-1.5">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Back
            </Button>
          )}
          <span className="num rounded-sm border border-line bg-surface-1 px-2 py-1 micro-11 text-slate-500">
            engine rse-1.2 · deterministic
          </span>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {/* ---------------- IMPORT ---------------- */}
        {stage === "import" && (
          <motion.section
            key="import"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="space-y-5"
          >
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload a CSV file"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                onFile(e.dataTransfer.files?.[0]);
              }}
              className={cn(
                "group flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-6 py-14 text-center transition-all",
                dragOver
                  ? "border-intel/60 bg-intel/[0.07] shadow-[0_0_40px_rgba(167,139,250,0.08)]"
                  : "border-slate-600/40 bg-surface-1/60 hover:border-intel/40 hover:bg-intel/[0.04]",
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
                className="hidden"
                onChange={(e) => {
                  onFile(e.target.files?.[0]);
                  e.currentTarget.value = "";
                }}
              />
              <motion.div
                animate={dragOver ? { scale: 1.08, y: -2 } : { scale: 1, y: 0 }}
                className="flex h-14 w-14 items-center justify-center rounded-full border border-intel/30 bg-intel/10"
              >
                <UploadCloud className="h-6 w-6 text-intel" aria-hidden />
              </motion.div>
              <p className="mt-4 text-[13.5px] font-medium text-slate-200">
                Drop a payment CSV here, or <span className="text-intel">browse</span>
              </p>
              <p className="micro mt-1.5 text-slate-500">
                .csv / .tsv · up to {bytesLabel(DATASET_LIMITS.maxFileBytes)} · {formatNumber(DATASET_LIMITS.maxRows)} rows per run
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="outline" size="sm" onClick={downloadSampleCsv} className="gap-1.5">
                <FlaskConical className="h-3.5 w-3.5 text-intel" aria-hidden />
                Download sample dataset
              </Button>
              <span className="micro-11 text-slate-600">
                50 labeled rows with velocity bursts, impossible travel, structuring — and honest false positives
              </span>
            </div>

            {/* history */}
            <section aria-label="Previous analyses" className="panel">
              <div className="flex items-center gap-2 border-b border-line px-4 py-3">
                <History className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                <p className="micro text-slate-400">Previous runs</p>
                <span className="num micro-11 text-slate-600">{history.length}</span>
              </div>
              {historyLoading ? (
                <div className="flex items-center justify-center gap-2 px-4 py-8">
                  <Loader2 className="h-4 w-4 animate-spin text-slate-500" aria-hidden />
                  <p className="micro text-slate-500">Loading runs…</p>
                </div>
              ) : history.length === 0 ? (
                <p className="micro-11 px-4 py-6 text-center text-slate-600">
                  No runs yet — upload a file above or start with the sample dataset.
                </p>
              ) : (
                <ul className="divide-y divide-line/60">
                  {history.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-1/60">
                      <FileSpreadsheet className="h-4 w-4 shrink-0 text-slate-600" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium text-slate-200">{d.name}</p>
                        <p className="micro-11 text-slate-500">
                          {formatNumber(d.rowCount)} rows · {d.flaggedCount} alerts · {relativeTime(d.createdAt)}
                        </p>
                      </div>
                      {d.labelsPresent && (
                        <span className="num rounded-sm border border-risk-low/25 bg-risk-low/8 px-1.5 py-0.5 micro-11 text-risk-low">
                          P {d.precision.toFixed(0)} · R {d.recall.toFixed(0)}
                        </span>
                      )}
                      <span className="num micro-11 text-slate-500">{formatINR(d.falsePositiveCost)} FP cost</span>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" className="h-6.5 px-2" onClick={() => void openStored(d.id)}>
                          Open
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6.5 w-6.5 p-0 text-slate-500 hover:text-risk-critical"
                          aria-label={`Delete ${d.name}`}
                          onClick={() => void deleteStored(d.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </motion.section>
        )}

        {/* ---------------- MAP ---------------- */}
        {stage === "map" && (
          <motion.section
            key="map"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="space-y-4"
          >
            {/* file meta */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-sm border border-line bg-surface-1 px-2 py-1 micro-11 text-slate-300">
                <FileSpreadsheet className="h-3 w-3 text-intel" aria-hidden />
                {fileName}
              </span>
              <span className="num rounded-sm border border-line bg-surface-1 px-2 py-1 micro-11 text-slate-400">
                {formatNumber(rows.length)} rows
              </span>
              <span className="num rounded-sm border border-line bg-surface-1 px-2 py-1 micro-11 text-slate-400">
                delimiter: {delimiter}
              </span>
              <span className="num rounded-sm border border-line bg-surface-1 px-2 py-1 micro-11 text-slate-400">
                {bytesLabel(fileSize)}
              </span>
              {malformed > 0 && (
                <span className="num rounded-sm border border-risk-medium/30 bg-risk-medium/8 px-2 py-1 micro-11 text-risk-medium">
                  {malformed} malformed {malformed === 1 ? "row" : "rows"} will be skipped
                </span>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-5">
              {/* mapping */}
              <div className="panel p-4 lg:col-span-2">
                <p className="micro text-slate-400">Column mapping</p>
                <p className="micro-11 mt-1 leading-snug text-slate-600">
                  Auto-detected from your headers — adjust anything that looks wrong.
                </p>
                <div className="mt-3 space-y-2.5">
                  {FIELDS.map((f) => (
                    <div key={f.key} className="grid grid-cols-[7.2rem_1fr] items-center gap-2">
                      <label className="micro-11 text-slate-400" htmlFor={`map-${f.key}`}>
                        {f.label}
                        {f.required && <span className="ml-1 text-risk-critical">*</span>}
                      </label>
                      <Select
                        value={mapping[f.key] || "__none"}
                        onValueChange={(v) =>
                          setMapping((m) => ({ ...m, [f.key]: v === "__none" ? "" : v }))
                        }
                      >
                        <SelectTrigger
                          id={`map-${f.key}`}
                          className={cn(
                            "h-7 border-line bg-surface-1 text-[11px]",
                            !mapping[f.key] && f.required && "border-risk-critical/40",
                          )}
                        >
                          <SelectValue placeholder="— not mapped —" />
                        </SelectTrigger>
                        <SelectContent className="max-h-64 border-line bg-surface-2 text-[11px]">
                          <SelectItem value="__none">— not mapped —</SelectItem>
                          {headers.map((h) => (
                            <SelectItem key={h} value={h}>
                              {h}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  <label htmlFor="dataset-name" className="micro-11 text-slate-400">Run name</label>
                  <Input
                    id="dataset-name"
                    value={datasetName}
                    onChange={(e) => setDatasetName(e.target.value)}
                    placeholder="e.g. January UPI exports"
                    className="mt-1 h-8 border-line bg-surface-1 text-[12px]"
                  />
                </div>
                {labelsDetected && (
                  <p className="micro-11 mt-3 rounded-sm border border-risk-low/25 bg-risk-low/8 px-2 py-1.5 leading-snug text-risk-low">
                    Label column detected — precision, recall and cost metrics will be computed.
                  </p>
                )}
                <Button
                  className="mt-4 w-full gap-2"
                  disabled={!amountMapped}
                  onClick={() => void runAnalysis()}
                >
                  <Play className="h-3.5 w-3.5" aria-hidden />
                  {amountMapped ? `Score ${formatNumber(rows.length)} rows` : "Map the amount column to continue"}
                </Button>
              </div>

              {/* preview */}
              <div className="panel overflow-hidden lg:col-span-3">
                <div className="flex items-center justify-between border-b border-line px-4 py-3">
                  <p className="micro text-slate-400">Preview — first {previewRows.length} rows</p>
                  <p className="micro-11 text-slate-600">{headers.length} columns</p>
                </div>
                <div className="max-h-80 overflow-auto">
                  <table className="w-full text-left">
                    <thead className="sticky top-0 bg-surface-1">
                      <tr className="border-b border-line">
                        {previewCols.map((h) => {
                          const mappedField = (Object.keys(mapping) as EngineField[]).find((k) => mapping[k] === h);
                          return (
                            <th key={h} className="whitespace-nowrap px-3 py-2">
                              <p className="micro-11 font-medium text-slate-300">{h}</p>
                              {mappedField && (
                                <p className="num text-[9px] text-intel">→ {mappedField}</p>
                              )}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((r, i) => (
                        <tr key={i} className="border-b border-line/50">
                          {previewCols.map((h) => (
                            <td key={h} className="max-w-40 truncate whitespace-nowrap px-3 py-1.5 num text-[11px] text-slate-400">
                              {r[h] || <span className="text-slate-700">∅</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </motion.section>
        )}

        {/* ---------------- ANALYZING ---------------- */}
        {stage === "analyzing" && (
          <motion.section
            key="analyzing"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="panel mx-auto max-w-md p-6"
            aria-live="polite"
          >
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-intel" aria-hidden />
              <div>
                <p className="text-[13.5px] font-medium text-slate-100">Scoring {fileName}</p>
                <p className="micro-11 text-slate-500">{formatNumber(rows.length)} rows · deterministic engine</p>
              </div>
            </div>
            <ol className="mt-5 space-y-2.5">
              {ANALYZE_STAGES.map((label, i) => {
                const done = i < analyzeStage;
                const active = i === analyzeStage;
                return (
                  <li key={label} className="flex items-center gap-2.5">
                    {done ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-risk-low" aria-hidden />
                    ) : active ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-intel" aria-hidden />
                    ) : (
                      <span className="h-3.5 w-3.5 rounded-full border border-line" aria-hidden />
                    )}
                    <span className={cn(
                      "micro-11",
                      done ? "text-slate-400" : active ? "text-slate-200" : "text-slate-600",
                    )}>
                      {label}
                    </span>
                  </li>
                );
              })}
            </ol>
          </motion.section>
        )}

        {/* ---------------- RESULTS ---------------- */}
        {stage === "results" && analysis && (
          <motion.section
            key="results"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <DatasetResults analysis={analysis} onReset={resetToImport} />
          </motion.section>
        )}
      </AnimatePresence>

      {loadingBoard && stage === "import" && (
        <p className="micro-11 text-center text-slate-600">Live feed still booting — imports work either way.</p>
      )}
    </div>
  );
}
