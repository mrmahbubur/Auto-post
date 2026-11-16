import { useEffect, useState } from "react";
import {
  AlertCircle,
  CalendarClock,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  Loader2,
  Play,
  RefreshCw,
  Rss,
  Send,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { api } from "../api";
import type { Article, BootstrapState, CopyDeck, GravatarProfile, RunRecord, SiteConfig } from "../types";
import { AuthImage } from "./AuthImage";
import { ReportPreviewModal } from "./ReportPreviewModal";

interface PipelineViewProps {
  state: BootstrapState;
  onStateChange: (next: BootstrapState) => void;
  preselectedArticle?: { siteId: string; article: Article } | null;
  onClearPreselected?: () => void;
}

const PLATFORM_COPY_FIELDS: Array<{
  platform: string;
  label: string;
  key: keyof CopyDeck;
  extraKey?: keyof CopyDeck;
  extraLabel?: string;
  limit: number;
}> = [
  { platform: "bluesky", label: "Bluesky", key: "bsky", limit: 300 },
  { platform: "mastodon", label: "Mastodon", key: "mastodon", limit: 500 },
  { platform: "telegram", label: "Telegram", key: "telegram", limit: 1024 },
  { platform: "discord", label: "Discord", key: "discord", limit: 400 },
  { platform: "devto", label: "Dev.to", key: "devto_title", extraKey: "devto_description", extraLabel: "Description", limit: 100 },
  { platform: "facebook_page", label: "Facebook Page", key: "facebook_page", limit: 2000 },
  { platform: "linkedin", label: "LinkedIn", key: "linkedin", limit: 1300 },
  { platform: "threads", label: "Threads", key: "threads", limit: 500 },
  { platform: "pinterest", label: "Pinterest", key: "facebook_page", limit: 500 },
  { platform: "reddit", label: "Reddit", key: "reddit_title", extraKey: "reddit_body", extraLabel: "Self / Body", limit: 300 },
  { platform: "x", label: "X (Twitter)", key: "x", limit: 280 },
];

export function PipelineView({
  state,
  onStateChange,
  preselectedArticle,
  onClearPreselected,
}: PipelineViewProps) {
  const [selectedSiteId, setSelectedSiteId] = useState<string>(state.sites[0]?.id || "");
  const [discovered, setDiscovered] = useState<Article[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [customUrl, setCustomUrl] = useState("");
  const [fetchingUrl, setFetchingUrl] = useState(false);

  const [sourceMode, setSourceMode] = useState<"feed" | "gravatar">("feed");
  const [gravatarInput, setGravatarInput] = useState(
    state.gravatar?.identifier || state.user?.email || ""
  );
  const [gravatarProfile, setGravatarProfile] = useState<GravatarProfile | null>(null);
  const [gravatarSiteOverride, setGravatarSiteOverride] = useState<SiteConfig | null>(null);
  const [loadingGravatar, setLoadingGravatar] = useState(false);

  const [activeArticle, setActiveArticle] = useState<Article | null>(null);
  const [copyDeck, setCopyDeck] = useState<CopyDeck | null>(null);
  const [imageFilename, setImageFilename] = useState<string>("");
  const [thumbRev, setThumbRev] = useState<number>(1);
  const [writerUsed, setWriterUsed] = useState<"gemini" | "template">("template");
  const [preparing, setPreparing] = useState(false);
  const [rerendering, setRerendering] = useState(false);

  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(() => {
    const enabled = state.platforms.filter((p) => p.enabled).map((p) => p.name);
    return enabled.length ? enabled : ["bluesky"];
  });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Batch pipeline & daily scheduler state
  const [batchMode, setBatchMode] = useState<"preview-all" | "dry" | "live">("preview-all");
  const [batchSiteId, setBatchSiteId] = useState<string>("");
  const [ignoreLedger, setIgnoreLedger] = useState(false);
  const [runningBatch, setRunningBatch] = useState(false);
  const [runningAutoCycle, setRunningAutoCycle] = useState(false);
  const [gravSyncInput, setGravSyncInput] = useState(
    state.gravatar?.identifier || state.user?.email || ""
  );
  const [syncingGravSites, setSyncingGravSites] = useState(false);
  const [automationNotice, setAutomationNotice] = useState("");
  const [publishingComposer, setPublishingComposer] = useState(false);
  const [latestRun, setLatestRun] = useState<RunRecord | null>(state.runs[0] || null);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [confirmLiveBatch, setConfirmLiveBatch] = useState(false);
  const [confirmLiveComposer, setConfirmLiveComposer] = useState(false);
  const [previewReportId, setPreviewReportId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedSiteId && state.sites[0]?.id) {
      setSelectedSiteId(state.sites[0].id);
    }
  }, [state.sites, selectedSiteId]);

  useEffect(() => {
    if (preselectedArticle) {
      setSelectedSiteId(preselectedArticle.siteId);
      handlePrepare(preselectedArticle.siteId, preselectedArticle.article);
      onClearPreselected?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedArticle]);

  // Initial feed discovery for the first configured site
  useEffect(() => {
    if (selectedSiteId && discovered.length === 0) {
      handleDiscoverSite(selectedSiteId, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSiteId]);

  async function handleDiscoverSite(siteId: string, silent = false) {
    if (!siteId) return;
    setDiscovering(true);
    if (!silent) setErrorMsg("");
    try {
      const res = await api.discoverSite(siteId, state.settings.run.lookback_days, 10);
      setDiscovered(res.articles);
    } catch (err) {
      if (!silent) setErrorMsg(err instanceof Error ? err.message : "Failed to discover feed");
    } finally {
      setDiscovering(false);
    }
  }

  async function handleFetchUrl() {
    if (!customUrl.trim()) return;
    setFetchingUrl(true);
    setErrorMsg("");
    try {
      const { article } = await api.discoverUrl(customUrl.trim(), selectedSiteId);
      setDiscovered((prev) => [article, ...prev.filter((a) => a.url !== article.url)]);
      await handlePrepare(selectedSiteId, article);
      setCustomUrl("");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to fetch URL");
    } finally {
      setFetchingUrl(false);
    }
  }

  async function handlePrepare(siteId: string, article: Article) {
    setPreparing(true);
    setErrorMsg("");
    setGravatarProfile(null);
    setGravatarSiteOverride(null);
    setActiveArticle(article);
    try {
      const res = await api.prepareArticle(siteId, article);
      setActiveArticle(res.article);
      setCopyDeck(res.copy);
      setWriterUsed(res.writerUsed);
      setImageFilename(res.image_filename);
      setThumbRev((n) => n + 1);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to prepare article copy");
    } finally {
      setPreparing(false);
    }
  }

  async function handlePrepareGravatar(customIdentifier?: string) {
    const id = (customIdentifier ?? gravatarInput).trim();
    if (!id) return;
    if (customIdentifier) setGravatarInput(customIdentifier);
    setLoadingGravatar(true);
    setPreparing(true);
    setErrorMsg("");
    try {
      const res = await api.prepareGravatar(id, selectedSiteId);
      setGravatarProfile(res.profile);
      setGravatarSiteOverride(res.site);
      setActiveArticle(res.article);
      setCopyDeck(res.copy);
      setWriterUsed(res.writerUsed);
      setImageFilename(res.image_filename);
      setThumbRev((n) => n + 1);
      // Select all 11 platforms when generating from Gravatar profile
      setSelectedPlatforms(state.platforms.map((p) => p.name));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to fetch Gravatar profile");
    } finally {
      setLoadingGravatar(false);
      setPreparing(false);
    }
  }

  async function handleRerenderThumbnail() {
    if (!activeArticle || !copyDeck) return;
    setRerendering(true);
    setErrorMsg("");
    try {
      const res = await api.rerenderThumbnail(selectedSiteId, activeArticle, copyDeck, {
        siteOverride: gravatarSiteOverride || undefined,
        avatarUrl: gravatarProfile?.avatar_url || undefined,
      });
      setImageFilename(res.image_filename);
      setThumbRev((n) => n + 1);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to re-render thumbnail");
    } finally {
      setRerendering(false);
    }
  }

  async function handlePublishComposer(mode: "dry" | "live") {
    if (!activeArticle || !copyDeck) return;
    if (selectedPlatforms.length === 0) {
      setErrorMsg("Select at least one platform to publish.");
      return;
    }
    setPublishingComposer(true);
    setConfirmLiveComposer(false);
    setErrorMsg("");
    try {
      const res = await api.publishPrepared({
        siteId: selectedSiteId || gravatarSiteOverride?.id || "direct-url",
        siteOverride: gravatarSiteOverride || undefined,
        article: activeArticle,
        copy: copyDeck,
        image_filename: imageFilename,
        platforms: selectedPlatforms,
        mode,
        avatarUrl: gravatarProfile?.avatar_url || undefined,
      });
      setLatestRun(res.run);
      onStateChange(res.state);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishingComposer(false);
    }
  }

  async function handleRunBatch() {
    setRunningBatch(true);
    setConfirmLiveBatch(false);
    setErrorMsg("");
    setAutomationNotice("");
    try {
      const res = await api.triggerRun({
        mode: batchMode,
        siteId: batchSiteId || undefined,
        ignoreLedger,
      });
      setLatestRun(res.run);
      onStateChange(res.state);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Pipeline run failed");
    } finally {
      setRunningBatch(false);
    }
  }

  async function handleSyncGravatarLinkedSites() {
    if (!gravSyncInput.trim()) {
      setErrorMsg("Enter a Gravatar username, profile URL, or email.");
      return;
    }
    setSyncingGravSites(true);
    setErrorMsg("");
    setAutomationNotice("");
    try {
      const res = await api.syncGravatar(gravSyncInput.trim(), true);
      onStateChange(res.state);
      if (res.syncedSites.length > 0) {
        const firstId = res.syncedSites[0].site.id;
        setSelectedSiteId(firstId);
        handleDiscoverSite(firstId, true);
        setAutomationNotice(
          `Synced ${res.syncedSites.length} linked site${res.syncedSites.length === 1 ? "" : "s"} from ${res.profile.display_name}.`
        );
      } else {
        setAutomationNotice(
          `Connected ${res.profile.display_name} (@${res.profile.username}), but no external website links were found on this Gravatar profile yet.`
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to sync Gravatar linked sites");
    } finally {
      setSyncingGravSites(false);
    }
  }

  async function handleToggleDailySchedule() {
    setErrorMsg("");
    try {
      const res = await api.updateSchedule({ enabled: !state.schedule.enabled });
      onStateChange(res.state);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to update daily schedule");
    }
  }

  async function handleRunDailyCycleNow() {
    setRunningAutoCycle(true);
    setErrorMsg("");
    setAutomationNotice("");
    try {
      const res = await api.runScheduleNow();
      if (res.run) setLatestRun(res.run);
      onStateChange(res.state);
      setAutomationNotice(
        `Automated cycle finished: ${res.run?.counts.ok ?? 0} live published, ${res.run?.counts.dry ?? 0} previewed.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Automated cycle failed");
    } finally {
      setRunningAutoCycle(false);
    }
  }

  function togglePlatformSelection(name: string) {
    setSelectedPlatforms((prev) =>
      prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]
    );
  }

  function handleCopyText(key: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1600);
  }

  async function handleDownloadPng() {
    if (!imageFilename) return;
    try {
      const blob = await api.fetchImageBlob(imageFilename);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = imageFilename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to download PNG");
    }
  }

  const readyPlatformsCount = state.platforms.filter((p) => p.enabled && p.ready).length;
  const enabledPlatformsCount = state.platforms.filter((p) => p.enabled).length;
  const enabledSitesCount = state.sites.filter((s) => s.enabled).length;
  const livePostsCount = state.ledger.filter((l) => l.status === "ok").length;

  return (
    <div className="space-y-6">
      {/* 4-column KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-slate-200 rounded-xl divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">Configured Sites</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 font-mono tabular-nums">
            {state.sites.filter((s) => s.enabled).length}
            <span className="text-sm font-normal text-slate-400"> / {state.sites.length}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">RSS, Atom, or sitemap sources</div>
        </div>
        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">Platforms Ready</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 font-mono tabular-nums">
            {readyPlatformsCount}
            <span className="text-sm font-normal text-slate-400"> / {enabledPlatformsCount} enabled</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">11 official API publishers</div>
        </div>
        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">Ledger Published</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 font-mono tabular-nums">
            {livePostsCount}
            <span className="text-sm font-normal text-slate-400"> / {state.ledger.length} entries</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">Duplicate-safe SQLite memory</div>
        </div>
        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">Daily Auto-Post</div>
          <div className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-900 font-mono tabular-nums">
            <CalendarClock className={`w-4 h-4 shrink-0 ${state.schedule.enabled ? "text-emerald-600" : "text-slate-400"}`} />
            <span>
              {state.schedule.enabled
                ? state.schedule.frequency === "daily"
                  ? `${state.schedule.post_time}`
                  : state.schedule.frequency === "every_12h"
                  ? "12h"
                  : "6h"
                : "Paused"}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums truncate">
            {state.schedule.enabled
              ? `${state.schedule.timezone} · ${state.schedule.mode === "live" ? "Live APIs" : "Dry mode"}`
              : "Enable in schedule below"}
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-start justify-between gap-3 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-xl text-sm">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
            <span>{errorMsg}</span>
          </div>
          <button
            onClick={() => setErrorMsg("")}
            className="text-xs font-medium text-red-700 hover:underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {automationNotice && (
        <div className="flex items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl text-sm">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{automationNotice}</span>
          </div>
          <button
            onClick={() => setAutomationNotice("")}
            className="text-xs font-medium text-emerald-700 hover:underline shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Gravatar Auto-Sync + Daily Scheduler + Manual Batch Runner */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">Automated Gravatar Daily Pipeline</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Syncs linked websites from your Gravatar profile, generates AI captions + 1200×630 PNG thumbnails, and posts automatically to connected social platforms daily.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleToggleDailySchedule}
              className={`h-9 px-3.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                state.schedule.enabled
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {state.schedule.enabled ? "Daily Auto-Post: ON" : "Daily Auto-Post: PAUSED"}
            </button>

            <button
              type="button"
              onClick={handleRunDailyCycleNow}
              disabled={runningAutoCycle}
              className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {runningAutoCycle ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              <span>{runningAutoCycle ? "Running Full Cycle..." : "Run Auto-Cycle Now"}</span>
            </button>
          </div>
        </div>

        {/* Gravatar Linked Sites Sync Input Row */}
        <div className="pt-4 border-t border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex-1 flex flex-col sm:flex-row gap-2.5">
            <input
              type="text"
              value={gravSyncInput}
              onChange={(e) => setGravSyncInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSyncGravatarLinkedSites();
                }
              }}
              placeholder="Gravatar username, profile URL, or email to sync linked websites"
              className="flex-1 h-9 px-3.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={handleSyncGravatarLinkedSites}
              disabled={syncingGravSites || !gravSyncInput.trim()}
              className="inline-flex items-center justify-center gap-2 h-9 px-4 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {syncingGravSites ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              <span>{syncingGravSites ? "Syncing Linked Sites..." : "Sync Gravatar Linked Sites"}</span>
            </button>
          </div>

          <div className="text-xs text-slate-500 font-mono tabular-nums whitespace-nowrap">
            {state.gravatar?.profile
              ? `${state.gravatar.profile.display_name} · ${state.gravatar.synced_site_ids.length} linked site${state.gravatar.synced_site_ids.length === 1 ? "" : "s"}`
              : "No Gravatar synced yet"}
          </div>
        </div>

        {/* Manual Batch Sweeper Row */}
        <div className="pt-4 border-t border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="text-xs font-medium text-slate-600">
            Manual Batch Sweep
            <span className="text-slate-400 font-normal"> · Next scheduled run: </span>
            <span className="font-mono tabular-nums text-slate-700">
              {state.schedule.enabled && state.schedule.next_run_at
                ? new Date(state.schedule.next_run_at * 1000).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "Paused"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={batchSiteId}
              onChange={(e) => setBatchSiteId(e.target.value)}
              className="h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All enabled sites</option>
              {state.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <select
              value={batchMode}
              onChange={(e) => {
                setBatchMode(e.target.value as "preview-all" | "dry" | "live");
                setConfirmLiveBatch(false);
              }}
              className="h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="preview-all">Preview All Enabled (no keys needed)</option>
              <option value="dry">Dry Run (credentialed only)</option>
              <option value="live">Live Publish (real APIs)</option>
            </select>

            <label className="inline-flex items-center gap-2 px-2.5 h-9 text-xs font-medium text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={ignoreLedger}
                onChange={(e) => setIgnoreLedger(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Re-run seen items</span>
            </label>

            {batchMode === "live" && !confirmLiveBatch ? (
              <button
                onClick={() => setConfirmLiveBatch(true)}
                disabled={runningBatch || enabledSitesCount === 0}
                className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Publish Live</span>
              </button>
            ) : batchMode === "live" && confirmLiveBatch ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRunBatch}
                  disabled={runningBatch || enabledSitesCount === 0}
                  className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {runningBatch ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  <span>Confirm Live Post</span>
                </button>
                <button
                  onClick={() => setConfirmLiveBatch(false)}
                  className="h-9 px-3 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={handleRunBatch}
                disabled={runningBatch || enabledSitesCount === 0}
                className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {runningBatch ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                <span>{runningBatch ? "Running..." : "Execute Run"}</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Interactive Article & Gravatar Composer */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Deck Composer & Thumbnail Studio</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Generate platform-native posts across all 11 platforms from an RSS/Atom article, a live URL, or a public Gravatar profile.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setSourceMode("feed")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  sourceMode === "feed" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Feed / Article URL
              </button>
              <button
                type="button"
                onClick={() => setSourceMode("gravatar")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  sourceMode === "gravatar" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Gravatar Profile
              </button>
            </div>

            {sourceMode === "feed" && state.sites.length > 0 && (
              <>
                <select
                  value={selectedSiteId}
                  onChange={(e) => {
                    setSelectedSiteId(e.target.value);
                    handleDiscoverSite(e.target.value);
                  }}
                  className="h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-800"
                >
                  {state.sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => handleDiscoverSite(selectedSiteId)}
                  disabled={discovering || !selectedSiteId}
                  className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {discovering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rss className="w-3.5 h-3.5" />}
                  <span>Refresh Feed</span>
                </button>
              </>
            )}
          </div>
        </div>

        {sourceMode === "gravatar" ? (
          <div className="space-y-4 pt-2 border-t border-slate-100">
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                value={gravatarInput}
                onChange={(e) => setGravatarInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handlePrepareGravatar();
                  }
                }}
                placeholder="Gravatar username, profile URL (https://gravatar.com/...), email, or SHA-256/MD5 hash"
                className="flex-1 h-10 px-3.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => handlePrepareGravatar()}
                disabled={loadingGravatar || !gravatarInput.trim()}
                className="inline-flex items-center justify-center gap-2 h-10 px-4 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {loadingGravatar ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                <span>Generate Posts for All 11 Platforms</span>
              </button>
            </div>

            {gravatarProfile && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                <img
                  src={gravatarProfile.avatar_url}
                  alt={gravatarProfile.display_name}
                  referrerPolicy="no-referrer"
                  className="w-16 h-16 rounded-full object-cover border border-slate-200 shrink-0 bg-slate-200"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{gravatarProfile.display_name}</span>
                    {gravatarProfile.pronouns && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span className="text-xs text-slate-500">{gravatarProfile.pronouns}</span>
                      </>
                    )}
                    {(gravatarProfile.job_title || gravatarProfile.company) && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span className="text-xs text-slate-600">
                          {[gravatarProfile.job_title, gravatarProfile.company].filter(Boolean).join(" @ ")}
                        </span>
                      </>
                    )}
                    {gravatarProfile.location && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span className="text-xs text-slate-500">{gravatarProfile.location}</span>
                      </>
                    )}
                  </div>
                  {gravatarProfile.description && (
                    <p className="text-xs text-slate-600 line-clamp-2">{gravatarProfile.description}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <a
                      href={gravatarProfile.profile_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline font-mono"
                    >
                      {gravatarProfile.profile_url}
                    </a>
                    {gravatarProfile.verified_accounts.length > 0 && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span>
                          Verified: {gravatarProfile.verified_accounts.map((a) => a.label).join(", ")}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Fetch arbitrary URL bar */}
            <div className="flex flex-col sm:flex-row gap-2.5 pt-2 border-t border-slate-100">
              <input
                type="url"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="Paste any live article URL (https://...) to scrape title, description & og:image"
                className="flex-1 h-10 px-3.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleFetchUrl}
                disabled={fetchingUrl || !customUrl.trim()}
                className="inline-flex items-center justify-center gap-2 h-10 px-4 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {fetchingUrl ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                <span>Fetch & Prepare URL</span>
              </button>
            </div>

            {/* Discovered articles list */}
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between text-xs font-medium text-slate-600">
                <span>Discovered Articles ({discovered.length})</span>
                <span className="font-mono text-slate-400">Lookback: {state.settings.run.lookback_days}d</span>
              </div>
              {discovering && discovered.length === 0 ? (
                <div className="p-6 text-sm text-slate-500 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Fetching RSS / Atom / Sitemap entries...</span>
                </div>
              ) : discovered.length === 0 ? (
                <div className="p-6 text-sm text-slate-500">
                  {state.sites.length === 0
                    ? "No RSS/Atom or sitemap sites configured yet. Add a site in Sites & Feeds, paste a live article URL above, or switch to Gravatar Profile."
                    : "No recent items found for this site within the lookback window. Try increasing Lookback Days in Writer & Media or paste a direct URL above."}
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {discovered.map((art) => {
                    const isSelected = activeArticle?.key === art.key;
                    const pubDate = art.published
                      ? new Date(art.published * 1000).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })
                      : "Undated";
                    return (
                      <div
                        key={art.key}
                        className={`px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                          isSelected ? "bg-blue-50/60" : "hover:bg-slate-50"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-900 truncate">{art.title}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <span className="font-mono tabular-nums">{pubDate}</span>
                            <span aria-hidden="true">·</span>
                            <span className="truncate max-w-md">{art.url}</span>
                            {art.tags.length > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{art.tags.slice(0, 3).join(", ")}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => handlePrepare(selectedSiteId, art)}
                          disabled={preparing}
                          className={`inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            isSelected
                              ? "bg-blue-600 text-white"
                              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                          }`}
                        >
                          {preparing && isSelected ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="w-3.5 h-3.5" />
                          )}
                          <span>{isSelected && copyDeck ? "Regenerate Deck" : "Generate Deck & PNG"}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {/* Prepared Workspace (Thumbnail + 11 Platform Copy Deck) */}
        {preparing && !copyDeck && (
          <div className="py-10 flex items-center justify-center gap-3 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
            <span>Writing 14-field caption deck and rendering 1200×630 PNG thumbnail...</span>
          </div>
        )}

        {activeArticle && copyDeck && (
          <div className="pt-4 border-t border-slate-200 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="text-xs font-medium text-slate-500">
                  Prepared Deck · Writer: {writerUsed === "gemini" ? "Gemini AI" : "Rule-based formatter"} · Key{" "}
                  <span className="font-mono">{activeArticle.key}</span>
                </div>
                <h3 className="mt-0.5 text-base font-semibold text-slate-900">{activeArticle.title}</h3>
              </div>
              <a
                href={activeArticle.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline whitespace-nowrap shrink-0"
              >
                <span>Open source article</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left 5 cols: Real 1200x630 Thumbnail Preview & Hook Controls */}
              <div className="lg:col-span-5 space-y-4">
                <div className="bg-slate-900 rounded-lg overflow-hidden aspect-[1200/630] flex items-center justify-center relative">
                  <AuthImage
                    filename={imageFilename}
                    rev={thumbRev}
                    alt={`Social thumbnail for ${activeArticle.title}`}
                    className="w-full h-full object-cover"
                  />
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-slate-700">Thumbnail Hook Headline</label>
                      <span
                        className={`text-xs font-mono tabular-nums ${
                          copyDeck.hook.length > 90 ? "text-red-600 font-semibold" : "text-slate-400"
                        }`}
                      >
                        {copyDeck.hook.length}/90
                      </span>
                    </div>
                    <input
                      type="text"
                      value={copyDeck.hook}
                      onChange={(e) => setCopyDeck({ ...copyDeck, hook: e.target.value })}
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Hashtags (comma-separated, max 4)
                    </label>
                    <input
                      type="text"
                      value={copyDeck.hashtags.join(", ")}
                      onChange={(e) =>
                        setCopyDeck({
                          ...copyDeck,
                          hashtags: e.target.value
                            .split(",")
                            .map((s) => s.trim().replace(/^#/, ""))
                            .filter(Boolean)
                            .slice(0, 4),
                        })
                      }
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 pt-1">
                    <button
                      onClick={handleRerenderThumbnail}
                      disabled={rerendering}
                      className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {rerendering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      <span>Re-render 1200×630 PNG</span>
                    </button>
                    {imageFilename && (
                      <button
                        type="button"
                        onClick={handleDownloadPng}
                        className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download PNG</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Right 7 cols: Platform Captions & Publish Targets */}
              <div className="lg:col-span-7 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
                  <div className="text-xs font-medium text-slate-600">
                    Select platforms & customize generated captions ({selectedPlatforms.length} selected)
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <button
                      onClick={() => setSelectedPlatforms(state.platforms.filter((p) => p.ready).map((p) => p.name))}
                      className="text-blue-600 hover:underline cursor-pointer"
                    >
                      Select Ready
                    </button>
                    <button
                      onClick={() => setSelectedPlatforms(state.platforms.map((p) => p.name))}
                      className="text-slate-600 hover:underline cursor-pointer"
                    >
                      Select All
                    </button>
                    <button
                      onClick={() => setSelectedPlatforms([])}
                      className="text-slate-500 hover:underline cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
                  {PLATFORM_COPY_FIELDS.map((field) => {
                    const pInfo = state.platforms.find((p) => p.name === field.platform);
                    const isChecked = selectedPlatforms.includes(field.platform);
                    const value = String(copyDeck[field.key] || "");
                    const over = value.length > field.limit;

                    return (
                      <div
                        key={field.platform}
                        className={`p-3.5 rounded-lg border transition-colors ${
                          isChecked ? "border-blue-200 bg-blue-50/25" : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => togglePlatformSelection(field.platform)}
                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm font-semibold text-slate-900">{field.label}</span>
                            <span className="text-xs text-slate-400">·</span>
                            <span
                              className={`text-xs font-medium ${
                                pInfo?.ready ? "text-emerald-700" : "text-amber-700"
                              }`}
                            >
                              {pInfo?.ready ? "Credentials ready" : "Dry preview only (no keys)"}
                            </span>
                          </label>

                          <div className="flex items-center gap-3">
                            <span
                              className={`text-xs font-mono tabular-nums ${
                                over ? "text-red-600 font-semibold" : "text-slate-500"
                              }`}
                            >
                              {value.length} / {field.limit}
                            </span>
                            <button
                              onClick={() => handleCopyText(field.platform, value)}
                              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 cursor-pointer"
                              title="Copy caption"
                            >
                              {copiedKey === field.platform ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                                  <span className="text-emerald-700">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        <textarea
                          rows={field.key === "linkedin" || field.key === "facebook_page" ? 4 : 3}
                          value={value}
                          onChange={(e) => setCopyDeck({ ...copyDeck, [field.key]: e.target.value })}
                          className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-md text-slate-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />

                        {field.extraKey && (
                          <div className="mt-2.5">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-medium text-slate-500">{field.extraLabel}</span>
                              <span className="text-xs font-mono tabular-nums text-slate-400">
                                {String(copyDeck[field.extraKey] || "").length} chars
                              </span>
                            </div>
                            <textarea
                              rows={3}
                              value={String(copyDeck[field.extraKey] || "")}
                              onChange={(e) =>
                                setCopyDeck({ ...copyDeck, [field.extraKey!]: e.target.value })
                              }
                              className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-md text-slate-800 leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Publish Controls */}
                <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-end gap-3">
                  <button
                    onClick={() => handlePublishComposer("dry")}
                    disabled={publishingComposer || selectedPlatforms.length === 0}
                    className="inline-flex items-center gap-2 h-10 px-4 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {publishingComposer ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                    <span>Record Dry Preview</span>
                  </button>

                  {!confirmLiveComposer ? (
                    <button
                      onClick={() => setConfirmLiveComposer(true)}
                      disabled={publishingComposer || selectedPlatforms.length === 0}
                      className="inline-flex items-center gap-2 h-10 px-4 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Send className="w-4 h-4" />
                      <span>Publish Live to Selected ({selectedPlatforms.length})</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handlePublishComposer("live")}
                        disabled={publishingComposer}
                        className="inline-flex items-center gap-2 h-10 px-4 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {publishingComposer ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                        <span>Confirm Live Publish</span>
                      </button>
                      <button
                        onClick={() => setConfirmLiveComposer(false)}
                        className="h-10 px-3 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Latest Run Output Report */}
      {latestRun && (
        <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                <span>Run {latestRun.id}</span>
                <span aria-hidden="true">·</span>
                <span>{latestRun.mode}</span>
                <span aria-hidden="true">·</span>
                <span>{latestRun.started}</span>
                <span aria-hidden="true">·</span>
                <span>{latestRun.elapsed}s</span>
                <span aria-hidden="true">·</span>
                <span>writer: {latestRun.writer}</span>
              </div>
              <h2 className="mt-1 text-base font-semibold text-slate-900">
                Latest Run Results —{" "}
                <span className="font-mono tabular-nums text-emerald-700">{latestRun.counts.ok} published</span>,{" "}
                <span className="font-mono tabular-nums text-amber-700">{latestRun.counts.dry} previews</span>,{" "}
                <span className="font-mono tabular-nums text-red-700">{latestRun.counts.error} errors</span>
              </h2>
            </div>

            <button
              type="button"
              onClick={() => setPreviewReportId(latestRun.id)}
              className="inline-flex items-center gap-2 h-9 px-3.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <FileCode2 className="w-3.5 h-3.5" />
              <span>Open Standalone report.html</span>
            </button>
          </div>

          {latestRun.items.length === 0 ? (
            <p className="text-sm text-slate-500">
              No new unposted articles matched this run. Check &ldquo;Re-run seen items&rdquo; or forget an entry in Ledger & Reports to re-run.
            </p>
          ) : (
            <div className="space-y-6">
              {latestRun.items.map((item) => (
                <div
                  key={item.key}
                  className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-4 first:pt-0 border-t first:border-t-0 border-slate-100"
                >
                  <div className="lg:col-span-4 space-y-2.5">
                    {item.image_filename && (
                      <div className="rounded-lg overflow-hidden bg-slate-900 aspect-[1200/630]">
                        <AuthImage
                          filename={item.image_filename}
                          alt={item.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <div className="text-sm font-medium text-slate-900">{item.title}</div>
                    <div className="text-xs text-slate-500 break-all">
                      {item.site} ·{" "}
                      <a href={item.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                        {item.url}
                      </a>
                    </div>
                  </div>

                  <div className="lg:col-span-8 divide-y divide-slate-100 border border-slate-200 rounded-lg">
                    {item.results.map((r) => (
                      <div key={r.platform} className="p-3.5 space-y-1.5">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2">
                            {r.status === "ok" ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            ) : r.status === "dry" ? (
                              <Play className="w-3.5 h-3.5 text-amber-600" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-red-600" />
                            )}
                            <span className="font-semibold text-slate-900 text-sm">{r.label}</span>
                            <span
                              className={`font-mono uppercase ${
                                r.status === "ok"
                                  ? "text-emerald-700"
                                  : r.status === "dry"
                                  ? "text-amber-700"
                                  : "text-red-700"
                              }`}
                            >
                              {r.status}
                            </span>
                          </div>
                          {r.url && (
                            <a
                              href={r.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-blue-600 hover:underline font-medium"
                            >
                              <span>Open post</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed bg-slate-50 p-2.5 rounded-md">
                          {r.text}
                        </pre>
                        {r.detail && (
                          <div
                            className={`text-xs ${
                              r.status === "error" ? "text-red-600" : "text-slate-500"
                            }`}
                          >
                            {r.detail}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <ReportPreviewModal runId={previewReportId} onClose={() => setPreviewReportId(null)} />
    </div>
  );
}
