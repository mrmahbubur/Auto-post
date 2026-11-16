import { useEffect, useState } from "react";
import { AlertCircle, Download, Loader2, X } from "lucide-react";
import { api } from "../api";

interface ReportPreviewModalProps {
  runId: string | null;
  onClose: () => void;
}

export function ReportPreviewModal({ runId, onClose }: ReportPreviewModalProps) {
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!runId) return;
    let active = true;
    setLoading(true);
    setError("");
    setHtml("");

    api
      .fetchReportHtml(runId)
      .then((content) => {
        if (active) setHtml(content);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Failed to load report");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [runId]);

  if (!runId) return null;

  function handleDownload() {
    if (!html) return;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `autopost-report-${runId}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 truncate">
              Standalone Run Report — <span className="font-mono">{runId}</span>
            </h3>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDownload}
              disabled={!html}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-lg cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download HTML</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
              aria-label="Close report preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 bg-slate-950 relative overflow-hidden">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-slate-300">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading standalone HTML report...</span>
            </div>
          ) : error ? (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-red-400 p-6">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : (
            <iframe
              title={`AutoPost report ${runId}`}
              srcDoc={html}
              sandbox="allow-popups"
              className="w-full h-full border-0"
            />
          )}
        </div>
      </div>
    </div>
  );
}
