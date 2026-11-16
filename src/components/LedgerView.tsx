import { useState } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, FileCode2, Play, RotateCcw, Search, Trash2 } from "lucide-react";
import { api } from "../api";
import type { BootstrapState } from "../types";
import { ReportPreviewModal } from "./ReportPreviewModal";

interface LedgerViewProps {
  state: BootstrapState;
  onStateChange: (next: BootstrapState) => void;
}

export function LedgerView({ state, onStateChange }: LedgerViewProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "ok" | "dry" | "error">("all");
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [previewReportId, setPreviewReportId] = useState<string | null>(null);

  const filteredLedger = state.ledger.filter((entry) => {
    if (statusFilter !== "all" && entry.status !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      entry.key.toLowerCase().includes(q) ||
      entry.platform.toLowerCase().includes(q) ||
      (entry.title || "").toLowerCase().includes(q) ||
      (entry.site || "").toLowerCase().includes(q)
    );
  });

  async function handleForget(key: string, platform?: string) {
    setErrorMsg("");
    try {
      const res = await api.forgetKey(key, platform);
      onStateChange(res.state);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to forget ledger entry");
    }
  }

  async function handleForgetAll() {
    setErrorMsg("");
    try {
      const res = await api.forgetAll();
      onStateChange(res.state);
      setConfirmClearAll(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to clear ledger");
    }
  }

  return (
    <div className="space-y-6">
      {errorMsg && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-xl text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* SQLite Posting Ledger */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">SQLite Posting Ledger</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Every (article, platform) pair is recorded so automated runs never double-post. Forget an entry to re-promote it.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title, key, platform..."
                className="h-9 pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-lg w-56 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(["all", "ok", "dry", "error"] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                    statusFilter === st ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {st === "all" ? "All" : st === "ok" ? "Published" : st === "dry" ? "Dry" : "Errors"}
                </button>
              ))}
            </div>

            {state.ledger.length > 0 &&
              (confirmClearAll ? (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleForgetAll}
                    className="h-9 px-3 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer"
                  >
                    Confirm Clear All
                  </button>
                  <button
                    onClick={() => setConfirmClearAll(false)}
                    className="h-9 px-2.5 text-xs text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmClearAll(true)}
                  className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear Ledger</span>
                </button>
              ))}
          </div>
        </div>

        {filteredLedger.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No ledger entries match the current filter. Run a dry preview or publish an article to populate the SQLite ledger.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Timestamp</th>
                  <th className="py-2.5 px-4">Platform</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Article / Key</th>
                  <th className="py-2.5 px-4">Result</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredLedger.map((entry) => (
                  <tr key={`${entry.key}-${entry.platform}`} className="hover:bg-slate-50/80 h-10">
                    <td className="py-2 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {new Date(entry.ts * 1000).toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="py-2 px-4 font-medium text-slate-900 whitespace-nowrap">{entry.platform}</td>
                    <td className="py-2 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 font-medium ${
                          entry.status === "ok"
                            ? "text-emerald-700"
                            : entry.status === "dry"
                            ? "text-amber-700"
                            : "text-red-700"
                        }`}
                      >
                        {entry.status === "ok" ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : entry.status === "dry" ? (
                          <Play className="w-3 h-3" />
                        ) : (
                          <AlertCircle className="w-3.5 h-3.5" />
                        )}
                        <span className="font-mono uppercase">{entry.status}</span>
                      </span>
                    </td>
                    <td className="py-2 px-4 max-w-md">
                      <div className="truncate font-medium text-slate-800">{entry.title || entry.key}</div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {entry.key}
                        {entry.site ? ` · ${entry.site}` : ""}
                      </div>
                    </td>
                    <td className="py-2 px-4 max-w-xs truncate">
                      {entry.post_url ? (
                        <a
                          href={entry.post_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                        >
                          <span className="truncate max-w-[200px]">{entry.post_url}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      ) : (
                        <span className={entry.status === "error" ? "text-red-600" : "text-slate-500"}>
                          {entry.detail || "—"}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-4 text-right whitespace-nowrap">
                      <button
                        onClick={() => handleForget(entry.key, entry.platform)}
                        className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-900 font-medium cursor-pointer"
                        title="Forget this (article, platform) pair"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Forget</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Run History & Standalone Reports */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">Run History & HTML Reports</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Each pipeline execution produces a self-contained HTML report with inline PNG thumbnails.
          </p>
        </div>

        {state.runs.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No runs executed yet. Run a preview or publish from Pipeline & Composer.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-4">Started</th>
                  <th className="py-2.5 px-4">Run ID</th>
                  <th className="py-2.5 px-4">Mode</th>
                  <th className="py-2.5 px-4">Writer</th>
                  <th className="py-2.5 px-4 text-right">Articles</th>
                  <th className="py-2.5 px-4 text-right">Published</th>
                  <th className="py-2.5 px-4 text-right">Previews</th>
                  <th className="py-2.5 px-4 text-right">Errors</th>
                  <th className="py-2.5 px-4 text-right">Elapsed</th>
                  <th className="py-2.5 px-4 text-right">Report</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {state.runs.map((run) => (
                  <tr key={run.id} className="hover:bg-slate-50/80 h-10">
                    <td className="py-2 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {run.started}
                    </td>
                    <td className="py-2 px-4 font-mono text-slate-500">{run.id}</td>
                    <td className="py-2 px-4 font-medium text-slate-900 whitespace-nowrap">{run.mode}</td>
                    <td className="py-2 px-4 font-mono text-slate-600">{run.writer}</td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-700">
                      {run.items.length}
                    </td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums text-emerald-700 font-medium">
                      {run.counts.ok}
                    </td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums text-amber-700">
                      {run.counts.dry}
                    </td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums text-red-700">
                      {run.counts.error}
                    </td>
                    <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-500">
                      {run.elapsed}s
                    </td>
                    <td className="py-2 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setPreviewReportId(run.id)}
                        className="inline-flex items-center gap-1 text-blue-600 hover:underline font-medium cursor-pointer"
                      >
                        <FileCode2 className="w-3.5 h-3.5" />
                        <span>report.html</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ReportPreviewModal runId={previewReportId} onClose={() => setPreviewReportId(null)} />
    </div>
  );
}
