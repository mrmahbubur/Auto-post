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
  Globe,
  Loader2,
  Play,
  RefreshCw,
  Rss,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  UserCheck,
} from "lucide-react";
import { api } from "../api";
import type {
  Article,
  BootstrapState,
  CopyDeck,
  RunRecord,
  ScheduleSettings,
  SiteConfig,
} from "../types";
import { AuthImage } from "./AuthImage";
import { ReportPreviewModal } from "./ReportPreviewModal";

export type PipelineNavTarget = "pipeline" | "sites" | "platforms" | "ledger" | "settings" | "account";

interface PipelineViewProps {
  state: BootstrapState;
  onStateChange: (next: BootstrapState) => void;
  preselectedArticle?: { siteId: string; article: Article } | null;
  onClearPreselected?: () => void;
  onNavigate?: (tab: PipelineNavTarget) => void;
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
  {
    platform: "devto",
    label: "Dev.to",
    key: "devto_title",
    extraKey: "devto_description",
    extraLabel: "Description",
    limit: 100,
  },
  { platform: "facebook_page", label: "Facebook Page", key: "facebook_page", limit: 2000 },
  { platform: "linkedin", label: "LinkedIn", key: "linkedin", limit: 1300 },
  { platform: "threads", label: "Threads", key: "threads", limit: 500 },
  { platform: "pinterest", label: "Pinterest", key: "pinterest", limit: 500 },
  {
    platform: "reddit",
    label: "Reddit",
    key: "reddit_title",
    extraKey: "reddit_body",
    extraLabel: "Self / Body",
    limit: 300,
  },
  { platform: "x", label: "X (Twitter)", key: "x", limit: 280 },
];

export function PipelineView({
  state,
  onStateChange,
  preselectedArticle,
  onClearPreselected,
  onNavigate,
}: PipelineViewProps) {
  const gravatarOnly = state.schedule.gravatar_only !== false;
  const gravatarSites = state.sites.filter((s) => s.source === "gravatar");
  const eligibleSites: SiteConfig[] = gravatarOnly ? gravatarSites : state.sites;
  const enabledEligibleSites = eligibleSites.filter((s) => s.enabled);

  // Step 1: Gravatar connection state
  const [gravSyncInput, setGravSyncInput] = useState(
    state.gravatar?.identifier || state.user?.email || ""
  );
  const [syncingGravSites, setSyncingGravSites] = useState(false);

  // Step 2: Website & article discovery + persisted staged post composer
  const [selectedSiteId, setSelectedSiteId] = useState<string>(
    state.stagedPost?.site?.id || eligibleSites[0]?.id || ""
  );
  const [discovered, setDiscovered] = useState<Article[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [fetchingUrl, setFetchingUrl] = useState(false);

  const [activeSite, setActiveSite] = useState<SiteConfig | null>(state.stagedPost?.site || null);
  const [activeArticle, setActiveArticle] = useState<Article | null>(
    state.stagedPost?.article || null
  );
  const [copyDeck, setCopyDeck] = useState<CopyDeck | null>(state.stagedPost?.copy || null);
  const [imageFilename, setImageFilename] = useState<string>(
    state.stagedPost?.image_filename || ""
  );
  const [thumbRev, setThumbRev] = useState<number>(1);
  const [writerUsed, setWriterUsed] = useState<"gemini" | "template">(
    state.stagedPost?.writerUsed || "template"
  );
  const [hydratedGeneratedAt, setHydratedGeneratedAt] = useState<number | null>(
    state.stagedPost?.generated_at ?? null
  );

  const [generatingFirst, setGeneratingFirst] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [rerendering, setRerendering] = useState(false);
  const [publishingComposer, setPublishingComposer] = useState(false);
  const [confirmLiveComposer, setConfirmLiveComposer] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(() => {
    const ready = state.platforms.filter((p) => p.enabled && p.ready).map((p) => p.name);
    if (ready.length > 0) return ready;
    const enabled = state.platforms.filter((p) => p.enabled).map((p) => p.name);
    return enabled.length > 0 ? enabled : ["bluesky"];
  });

  // Step 3: Automatic social posting schedule
  const [schedDraft, setSchedDraft] = useState<ScheduleSettings>(state.schedule);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [runningAutoCycle, setRunningAutoCycle] = useState(false);

  // Batch runner & run report
  const [batchMode, setBatchMode] = useState<"preview-all" | "dry" | "live">("preview-all");
  const [batchSiteId, setBatchSiteId] = useState<string>("");
  const [ignoreLedger, setIgnoreLedger] = useState(false);
  const [runningBatch, setRunningBatch] = useState(false);
  const [confirmLiveBatch, setConfirmLiveBatch] = useState(false);
  const [latestRun, setLatestRun] = useState<RunRecord | null>(state.runs[0] || null);
  const [previewReportId, setPreviewReportId] = useState<string | null>(null);

  const [automationNotice, setAutomationNotice] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Sync schedule draft when server state updates
  useEffect(() => {
    setSchedDraft(state.schedule);
  }, [state.schedule]);

  // Hydrate generated post & thumbnail from SQLite state.stagedPost
  useEffect(() => {
    const staged = state.stagedPost;
    if (!staged) return;
    if (staged.generated_at !== hydratedGeneratedAt) {
      setActiveSite(staged.site);
      setSelectedSiteId(staged.site.id);
      setActiveArticle(staged.article);
      setCopyDeck(staged.copy);
      setImageFilename(staged.image_filename);
      setWriterUsed(staged.writerUsed);
      setHydratedGeneratedAt(staged.generated_at);
      setThumbRev((n) => n + 1);
    }
  }, [state.stagedPost, hydratedGeneratedAt]);

  // Keep selectedSiteId valid for active site policy
  useEffect(() => {
    if (eligibleSites.length === 0) {
      if (selectedSiteId) setSelectedSiteId("");
      if (discovered.length > 0) setDiscovered([]);
      if (batchSiteId) setBatchSiteId("");
      return;
    }
    if (!selectedSiteId || !eligibleSites.some((s) => s.id === selectedSiteId)) {
      setSelectedSiteId(eligibleSites[0].id);
    }
    if (batchSiteId && !eligibleSites.some((s) => s.id === batchSiteId)) {
      setBatchSiteId("");
    }
  }, [eligibleSites, selectedSiteId, batchSiteId, discovered.length]);

  useEffect(() => {
    if (state.runs[0] && (!latestRun || state.runs[0].id !== latestRun.id)) {
      setLatestRun(state.runs[0]);
    }
  }, [state.runs, latestRun]);

  useEffect(() => {
    if (preselectedArticle) {
      const targetSite = eligibleSites.find((s) => s.id === preselectedArticle.siteId);
      if (targetSite) {
        setSelectedSiteId(targetSite.id);
        handlePrepare(targetSite.id, preselectedArticle.article);
      } else {
        setErrorMsg(
          "Strict Gravatar-Only mode is active: manual non-Gravatar websites cannot be prepared."
        );
      }
      onClearPreselected?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedArticle]);

  // Initial article discovery for the active eligible website
  useEffect(() => {
    if (selectedSiteId && discovered.length === 0) {
      handleDiscoverSite(selectedSiteId, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSiteId]);

  async function handleDiscoverSite(siteId: string, silent = false) {
    if (!siteId) return;
    setDiscovering(true);
    setDiscoverError("");
    if (!silent) setErrorMsg("");
    try {
      const res = await api.discoverSite(siteId, state.settings.run.lookback_days, 10);
      setDiscovered(res.articles);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to discover website articles";
      setDiscoverError(msg);
      if (!silent) setErrorMsg(msg);
    } finally {
      setDiscovering(false);
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
          `Synced ${res.syncedSites.length} Gravatar-included website${
            res.syncedSites.length === 1 ? "" : "s"
          } from ${res.profile.display_name}. Next: generate your first real post & thumbnail in Step 2.`
        );
      } else {
        setDiscovered([]);
        setAutomationNotice(
          `Connected ${res.profile.display_name} (@${res.profile.username}), but no website URLs were listed on this Gravatar profile yet. Add your website link on Gravatar and re-sync.`
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to sync Gravatar websites");
    } finally {
      setSyncingGravSites(false);
    }
  }

  async function handleGenerateFirstPost(articleUrl?: string) {
    setGeneratingFirst(true);
    setErrorMsg("");
    setAutomationNotice("");
    try {
      const res = await api.generateFirstPost({
        identifier: gravSyncInput.trim() || undefined,
        siteId: selectedSiteId || undefined,
        articleUrl,
      });
      onStateChange(res.state);
      setDiscovered(res.availableArticles);
      setActiveSite(res.stagedPost.site);
      setSelectedSiteId(res.stagedPost.site.id);
      setActiveArticle(res.stagedPost.article);
      setCopyDeck(res.stagedPost.copy);
      setImageFilename(res.stagedPost.image_filename);
      setWriterUsed(res.stagedPost.writerUsed);
      setHydratedGeneratedAt(res.stagedPost.generated_at);
      setThumbRev((n) => n + 1);
      setAutomationNotice(
        `Generated real copy deck + 1200×630 PNG thumbnail from ${res.stagedPost.site.name}. Review below or publish live.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to generate first post and thumbnail");
    } finally {
      setGeneratingFirst(false);
    }
  }

  async function handleClearStaged() {
    setErrorMsg("");
    try {
      const res = await api.clearStagedPost();
      onStateChange(res.state);
      setActiveArticle(null);
      setActiveSite(null);
      setCopyDeck(null);
      setImageFilename("");
      setHydratedGeneratedAt(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to clear generated draft");
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
    setActiveArticle(article);
    const matchingSite = eligibleSites.find((s) => s.id === siteId) || null;
    setActiveSite(matchingSite);
    try {
      const res = await api.prepareArticle(siteId, article);
      setActiveArticle(res.article);
      setCopyDeck(res.copy);
      setWriterUsed(res.writerUsed);
      setImageFilename(res.image_filename);
      setThumbRev((n) => n + 1);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to generate post and thumbnail");
    } finally {
      setPreparing(false);
    }
  }

  async function handleRerenderThumbnail() {
    if (!activeArticle || !copyDeck) return;
    setRerendering(true);
    setErrorMsg("");
    try {
      const targetSiteId = activeSite?.id || selectedSiteId;
      const res = await api.rerenderThumbnail(targetSiteId, activeArticle, copyDeck);
      setImageFilename(res.image_filename);
      setThumbRev((n) => n + 1);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to re-render 1200×630 PNG");
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
    const targetSiteId = activeSite?.id || selectedSiteId;
    if (!targetSiteId) {
      setErrorMsg("Select a Gravatar-included website first.");
      return;
    }
    setPublishingComposer(true);
    setConfirmLiveComposer(false);
    setErrorMsg("");
    setAutomationNotice("");
    try {
      const res = await api.publishPrepared({
        siteId: targetSiteId,
        article: activeArticle,
        copy: copyDeck,
        image_filename: imageFilename,
        platforms: selectedPlatforms,
        mode,
      });
      setLatestRun(res.run);
      onStateChange(res.state);
      setAutomationNotice(
        mode === "live"
          ? `Published generated post: ${res.run.counts.ok} live, ${res.run.counts.error} errors.`
          : `Saved dry preview across ${res.run.counts.dry} selected platform(s).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishingComposer(false);
    }
  }

  async function handleSaveAutomation(enableOverride?: boolean) {
    setSavingSchedule(true);
    setErrorMsg("");
    setAutomationNotice("");
    try {
      const nextEnabled = enableOverride !== undefined ? enableOverride : schedDraft.enabled;
      const res = await api.updateSchedule({
        enabled: nextEnabled,
        frequency: schedDraft.frequency,
        post_time: schedDraft.post_time,
        timezone: schedDraft.timezone,
        mode: schedDraft.mode,
        sync_gravatar: schedDraft.sync_gravatar,
        gravatar_only: schedDraft.gravatar_only,
      });
      onStateChange(res.state);
      setSchedDraft(res.state.schedule);
      setAutomationNotice(
        nextEnabled
          ? `Automatic social posting is now ACTIVE (${res.state.schedule.frequency}, ${
              res.state.schedule.gravatar_only !== false ? "Gravatar websites only" : "all active websites"
            }).`
          : "Automatic social posting schedule saved and paused."
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save automatic schedule");
    } finally {
      setSavingSchedule(false);
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
        `Automatic cycle finished: ${res.run?.counts.ok ?? 0} live published, ${
          res.run?.counts.dry ?? 0
        } previewed, ${res.run?.counts.error ?? 0} errors.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Automatic cycle failed");
    } finally {
      setRunningAutoCycle(false);
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
        gravatarOnly,
      });
      setLatestRun(res.run);
      onStateChange(res.state);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Pipeline run failed");
    } finally {
      setRunningBatch(false);
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
  const livePostsCount = state.ledger.filter((l) => l.status === "ok").length;
  const hasGeneratedPost = Boolean(activeArticle && copyDeck && imageFilename);

  return (
    <div className="space-y-6">
      {/* 4-column KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-slate-200 rounded-xl divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">Gravatar Websites</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 font-mono tabular-nums">
            {gravatarSites.filter((s) => s.enabled).length}
            <span className="text-sm font-normal text-slate-400"> / {gravatarSites.length}</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {gravatarOnly ? "Strictly Gravatar-included only" : "All sites enabled"}
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">Generated Post & PNG</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 font-mono tabular-nums">
            {hasGeneratedPost ? "Ready" : "Pending"}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {hasGeneratedPost ? `${writerUsed} copy · 1200×630 PNG` : "Generate in Step 2 first"}
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">Platforms Ready</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 font-mono tabular-nums">
            {readyPlatformsCount}
            <span className="text-sm font-normal text-slate-400"> / {enabledPlatformsCount} enabled</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums">
            {livePostsCount} live in ledger
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-slate-500">Automatic Posting</div>
          <div className="mt-1 flex items-center gap-2 text-lg font-semibold text-slate-900 font-mono tabular-nums">
            <CalendarClock
              className={`w-4 h-4 shrink-0 ${state.schedule.enabled ? "text-emerald-600" : "text-slate-400"}`}
            />
            <span>
              {state.schedule.enabled
                ? state.schedule.frequency === "daily"
                  ? state.schedule.post_time
                  : state.schedule.frequency === "every_12h"
                  ? "12h"
                  : "6h"
                : "Paused"}
            </span>
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono tabular-nums truncate">
            {state.schedule.enabled
              ? `${state.schedule.timezone} · ${state.schedule.mode === "live" ? "Live APIs" : "Dry mode"}`
              : "Activate in Step 3 below"}
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
            type="button"
            onClick={() => setErrorMsg("")}
            className="text-xs font-medium text-red-700 hover:underline shrink-0 cursor-pointer"
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
            type="button"
            onClick={() => setAutomationNotice("")}
            className="text-xs font-medium text-emerald-700 hover:underline shrink-0 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* STEP 1: Connect Gravatar Profile (Included Websites Only) */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-blue-600 font-semibold">
              Step 01 · Gravatar Source Lock
            </div>
            <h2 className="mt-0.5 text-base font-semibold text-slate-900">
              Connect Gravatar Profile & Sync Included Websites
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Only websites listed on your connected Gravatar profile are discovered and allowed into post generation and automatic social posting.
            </p>
          </div>
          {state.gravatar?.profile && (
            <div className="flex items-center gap-3 shrink-0">
              <img
                src={state.gravatar.profile.avatar_url}
                alt={state.gravatar.profile.display_name}
                referrerPolicy="no-referrer"
                className="w-10 h-10 rounded-full object-cover border border-slate-200 bg-slate-100 shrink-0"
              />
              <div className="text-xs min-w-0">
                <div className="font-semibold text-slate-900 truncate">
                  {state.gravatar.profile.display_name}
                </div>
                <div className="text-slate-500 font-mono tabular-nums truncate">
                  @{state.gravatar.profile.username} · {gravatarSites.length} included site
                  {gravatarSites.length === 1 ? "" : "s"}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
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
            placeholder="Gravatar username, profile URL (https://gravatar.com/name), or email"
            className="flex-1 h-10 px-3.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={handleSyncGravatarLinkedSites}
            disabled={syncingGravSites || !gravSyncInput.trim()}
            className="inline-flex items-center justify-center gap-2 h-10 px-4 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {syncingGravSites ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <UserCheck className="w-4 h-4" />
            )}
            <span>{syncingGravSites ? "Syncing Websites..." : "Sync Gravatar Websites"}</span>
          </button>
        </div>

        {gravatarSites.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
            {gravatarSites.map((site) => {
              const isSelected = site.id === selectedSiteId;
              return (
                <button
                  key={site.id}
                  type="button"
                  onClick={() => {
                    setSelectedSiteId(site.id);
                    handleDiscoverSite(site.id);
                  }}
                  className={`text-left p-3.5 rounded-lg border transition-colors cursor-pointer ${
                    isSelected
                      ? "border-blue-300 bg-blue-50/40"
                      : "border-slate-200 bg-slate-50/50 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900 truncate">{site.name}</span>
                    <span
                      className={`text-xs font-medium shrink-0 ${
                        site.enabled ? "text-emerald-700" : "text-slate-400"
                      }`}
                    >
                      {site.enabled ? "Active" : "Paused"}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 font-mono truncate">
                    <Globe className="w-3 h-3 shrink-0 text-slate-400" />
                    <span className="truncate">{site.url}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500 font-mono truncate">
                    Source: {site.feed ? "RSS/Atom feed" : site.sitemap ? "XML sitemap" : "Direct page"}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span>
              {state.gravatar?.profile
                ? "Your connected Gravatar profile currently has 0 website links. Add your website URL under Links on Gravatar, then click Sync Gravatar Websites."
                : "Enter your Gravatar username, URL, or email above to import the websites included on your Gravatar profile."}
            </span>
            <button
              type="button"
              onClick={() => onNavigate?.("sites")}
              className="text-blue-600 hover:underline font-medium shrink-0 cursor-pointer"
            >
              Inspect Gravatar Websites
            </button>
          </div>
        )}
      </section>

      {/* STEP 2: First Generate Real Post & 1200x630 PNG Thumbnail */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-3 border-b border-slate-100">
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-blue-600 font-semibold">
              Step 02 · Real Generation Before Posting
            </div>
            <h2 className="mt-0.5 text-base font-semibold text-slate-900">
              First Generate Real Post Copy & 1200×630 PNG Thumbnail
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Generates real multi-platform captions and renders a real 1200×630 PNG thumbnail from your Gravatar-included website before any automatic or live post runs.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {eligibleSites.length > 0 && (
              <>
                <select
                  value={selectedSiteId}
                  onChange={(e) => {
                    setSelectedSiteId(e.target.value);
                    handleDiscoverSite(e.target.value);
                  }}
                  className="h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-800"
                >
                  {eligibleSites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleDiscoverSite(selectedSiteId)}
                  disabled={discovering || !selectedSiteId}
                  className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {discovering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rss className="w-3.5 h-3.5" />}
                  <span>Refresh Articles</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => handleGenerateFirstPost()}
              disabled={generatingFirst || (!gravSyncInput.trim() && gravatarSites.length === 0)}
              className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {generatingFirst ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              <span>
                {generatingFirst
                  ? "Generating Real Post & PNG..."
                  : hasGeneratedPost
                  ? "Regenerate Latest Post & PNG"
                  : "Generate Real Post & Thumbnail"}
              </span>
            </button>
          </div>
        </div>

        {/* Discovered articles from selected Gravatar website */}
        {eligibleSites.length > 0 && (
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between text-xs font-medium text-slate-600">
              <span>
                Articles from{" "}
                {eligibleSites.find((s) => s.id === selectedSiteId)?.name || "Gravatar website"} (
                {discovered.length})
              </span>
              <span className="font-mono text-slate-500">
                Writer:{" "}
                {state.settings.ai.enabled && state.geminiReady
                  ? `Gemini (${state.settings.ai.model})`
                  : "Rule-based real formatter"}
              </span>
            </div>

            {discovering && discovered.length === 0 ? (
              <div className="p-5 text-sm text-slate-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Discovering articles from Gravatar-included website...</span>
              </div>
            ) : discoverError && discovered.length === 0 ? (
              <div className="p-4 text-xs text-red-700 bg-red-50/50 flex items-center justify-between gap-3">
                <span>Feed discovery failed: {discoverError}</span>
                <button
                  type="button"
                  onClick={() => handleDiscoverSite(selectedSiteId)}
                  className="text-red-800 font-medium underline cursor-pointer shrink-0"
                >
                  Retry
                </button>
              </div>
            ) : discovered.length === 0 ? (
              <div className="p-4 text-xs text-slate-500">
                No recent articles within {state.settings.run.lookback_days}d lookback — click{" "}
                <strong className="font-semibold text-slate-700">Generate Real Post & Thumbnail</strong>{" "}
                above to automatically scan historical entries (365d fallback) or extract live metadata from the website.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
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
                      className={`px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 transition-colors ${
                        isSelected ? "bg-blue-50/60" : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 truncate">{art.title}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span className="font-mono tabular-nums">{pubDate}</span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate max-w-md">{art.url}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleGenerateFirstPost(art.url)}
                        disabled={generatingFirst || preparing}
                        className={`inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          isSelected
                            ? "bg-blue-600 text-white"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        }`}
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>{isSelected && copyDeck ? "Selected Draft" : "Generate Post & PNG"}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Only expose direct URL fetch if user explicitly unlocked Gravatar-only mode */}
        {!gravatarOnly && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleFetchUrl();
            }}
            className="flex flex-col sm:flex-row gap-2.5"
          >
            <input
              type="text"
              inputMode="url"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="Optional direct article URL (Gravatar-only mode is disabled in Writer & Schedule)"
              className="flex-1 h-9 px-3.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={fetchingUrl || !customUrl.trim()}
              className="inline-flex items-center justify-center gap-2 h-9 px-4 text-xs font-medium text-white bg-slate-800 hover:bg-slate-900 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              {fetchingUrl ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>Fetch & Generate</span>
            </button>
          </form>
        )}

        {(generatingFirst || preparing) && !copyDeck && (
          <div className="py-10 flex items-center justify-center gap-3 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
            <span>Generating real social captions and rendering 1200×630 PNG thumbnail...</span>
          </div>
        )}

        {activeArticle && copyDeck && (
          <div className="pt-4 border-t border-slate-200 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-500">
                  Generated Staged Post · Site: {activeSite?.name || activeArticle.site} · Writer:{" "}
                  {writerUsed === "gemini" ? "Gemini AI" : "Rule-based formatter"} · Key{" "}
                  <span className="font-mono">{activeArticle.key}</span>
                </div>
                <h3 className="mt-0.5 text-base font-semibold text-slate-900 truncate">
                  {activeArticle.title}
                </h3>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <a
                  href={activeArticle.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline whitespace-nowrap"
                >
                  <span>Open website article</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                {state.stagedPost && (
                  <button
                    type="button"
                    onClick={handleClearStaged}
                    className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-red-600 cursor-pointer"
                    title="Clear saved staged post"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear Draft</span>
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left 5 cols: Real 1200x630 Thumbnail & Hook */}
              <div className="lg:col-span-5 space-y-4">
                <div className="bg-slate-900 rounded-lg overflow-hidden aspect-[1200/630] flex items-center justify-center relative border border-slate-200">
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
                      <label className="text-xs font-medium text-slate-700">
                        Thumbnail Hook Headline
                      </label>
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
                      type="button"
                      onClick={handleRerenderThumbnail}
                      disabled={rerendering}
                      className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {rerendering ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
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

              {/* Right 7 cols: 11 Platform Captions & Publish Targets */}
              <div className="lg:col-span-7 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100">
                  <div className="text-xs font-medium text-slate-600">
                    Customize & select platforms ({selectedPlatforms.length} selected)
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedPlatforms(
                          state.platforms.filter((p) => p.ready).map((p) => p.name)
                        )
                      }
                      className="text-blue-600 hover:underline cursor-pointer"
                    >
                      Select Ready
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedPlatforms(state.platforms.map((p) => p.name))}
                      className="text-slate-600 hover:underline cursor-pointer"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedPlatforms([])}
                      className="text-slate-500 hover:underline cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                  {PLATFORM_COPY_FIELDS.map((field) => {
                    const pInfo = state.platforms.find((p) => p.name === field.platform);
                    const isChecked = selectedPlatforms.includes(field.platform);
                    const value =
                      field.key === "pinterest"
                        ? String(copyDeck.pinterest ?? copyDeck.facebook_page ?? "")
                        : String(copyDeck[field.key] || "");
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
                              type="button"
                              onClick={() => handleCopyText(field.platform, value)}
                              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 cursor-pointer"
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
                              <span className="text-xs font-medium text-slate-500">
                                {field.extraLabel}
                              </span>
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

                {/* Publish Generated Post Controls */}
                <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => handlePublishComposer("dry")}
                    disabled={publishingComposer || selectedPlatforms.length === 0}
                    className="inline-flex items-center gap-2 h-10 px-4 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {publishingComposer ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                    <span>Save Dry Preview</span>
                  </button>

                  {!confirmLiveComposer ? (
                    <button
                      type="button"
                      onClick={() => setConfirmLiveComposer(true)}
                      disabled={publishingComposer || selectedPlatforms.length === 0}
                      className="inline-flex items-center gap-2 h-10 px-4 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Send className="w-4 h-4" />
                      <span>Publish Generated Post Live ({selectedPlatforms.length})</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
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
                        type="button"
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

      {/* STEP 3: Automatic Social Platform Posting System */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-blue-600 font-semibold">
              Step 03 · Automatic Background Scheduler
            </div>
            <h2 className="mt-0.5 text-base font-semibold text-slate-900">
              Automatic Social Posting System
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Re-syncs Gravatar websites, generates real captions + 1200×630 PNG thumbnails for unread articles, and posts automatically on your schedule.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate?.("platforms")}
            className="inline-flex items-center gap-2 h-9 px-3.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span>Configure Platform Keys ({readyPlatformsCount}/11 Ready)</span>
          </button>
        </div>

        {/* Platform readiness compact grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
          {state.platforms.map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => onNavigate?.("platforms")}
              className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors cursor-pointer ${
                p.enabled && p.ready
                  ? "border-emerald-200 bg-emerald-50/40 text-slate-900"
                  : p.enabled
                  ? "border-amber-200 bg-amber-50/30 text-slate-700"
                  : "border-slate-200 bg-slate-50 text-slate-400"
              }`}
            >
              <div className="font-semibold truncate">{p.label}</div>
              <div
                className={`mt-0.5 font-mono text-[11px] truncate ${
                  p.enabled && p.ready
                    ? "text-emerald-700"
                    : p.enabled
                    ? "text-amber-700"
                    : "text-slate-400"
                }`}
              >
                {p.enabled && p.ready ? "API Ready" : p.enabled ? "Needs Keys" : "Disabled"}
              </div>
            </button>
          ))}
        </div>

        {/* Scheduler settings row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Cadence</label>
            <select
              value={schedDraft.frequency}
              onChange={(e) =>
                setSchedDraft({
                  ...schedDraft,
                  frequency: e.target.value as ScheduleSettings["frequency"],
                })
              }
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="daily">Daily (1× per day)</option>
              <option value="every_12h">Every 12 hours</option>
              <option value="every_6h">Every 6 hours</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Post Time</label>
            <input
              type="time"
              value={schedDraft.post_time}
              onChange={(e) => setSchedDraft({ ...schedDraft, post_time: e.target.value })}
              disabled={schedDraft.frequency !== "daily"}
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg font-mono tabular-nums disabled:opacity-50"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-slate-700">Timezone (IANA)</label>
              <button
                type="button"
                onClick={() => {
                  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
                  setSchedDraft({ ...schedDraft, timezone: tz });
                }}
                className="text-[11px] text-blue-600 hover:underline cursor-pointer"
              >
                Use local
              </button>
            </div>
            <input
              type="text"
              value={schedDraft.timezone}
              onChange={(e) => setSchedDraft({ ...schedDraft, timezone: e.target.value })}
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Auto-Post Mode</label>
            <select
              value={schedDraft.mode}
              onChange={(e) =>
                setSchedDraft({
                  ...schedDraft,
                  mode: e.target.value as ScheduleSettings["mode"],
                })
              }
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg"
            >
              <option value="live">Live Publish (Connected APIs)</option>
              <option value="dry">Dry Preview (Safe mode)</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pt-3 border-t border-slate-100">
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={schedDraft.sync_gravatar}
                onChange={(e) => setSchedDraft({ ...schedDraft, sync_gravatar: e.target.checked })}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Re-sync Gravatar-included websites before every scheduled run</span>
            </label>

            <label className="flex items-center gap-2 text-xs text-slate-800 font-medium cursor-pointer">
              <input
                type="checkbox"
                checked={schedDraft.gravatar_only !== false}
                onChange={(e) => setSchedDraft({ ...schedDraft, gravatar_only: e.target.checked })}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Enforce Gravatar-Only websites (block non-Gravatar sources)</span>
            </label>

            <div className="text-xs text-slate-500 font-mono tabular-nums pt-0.5">
              Next run:{" "}
              {state.schedule.enabled && state.schedule.next_run_at
                ? new Date(state.schedule.next_run_at * 1000).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "Paused"}
              {" · "}
              Last status: {state.schedule.last_status}
              {state.schedule.last_error ? ` (${state.schedule.last_error})` : ""}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => handleSaveAutomation(!state.schedule.enabled)}
              disabled={savingSchedule}
              className={`inline-flex items-center gap-2 h-9 px-4 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                state.schedule.enabled
                  ? "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                  : "bg-emerald-600 text-white hover:bg-emerald-700"
              }`}
            >
              {savingSchedule && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>
                {state.schedule.enabled ? "Pause Automatic Posting" : "Activate Automatic Posting"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleSaveAutomation(state.schedule.enabled)}
              disabled={savingSchedule}
              className="h-9 px-3.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Save Schedule
            </button>

            <button
              type="button"
              onClick={handleRunDailyCycleNow}
              disabled={runningAutoCycle}
              className="inline-flex items-center gap-2 h-9 px-4 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {runningAutoCycle ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              <span>{runningAutoCycle ? "Running Cycle..." : "Run Auto-Cycle Now"}</span>
            </button>
          </div>
        </div>

        {/* Manual Batch Sweeper scoped to eligible Gravatar sites */}
        <div className="pt-4 border-t border-slate-100 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="text-xs font-medium text-slate-600">
            Batch Sweep ({gravatarOnly ? "Gravatar-Included Websites Only" : "All Active Websites"})
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={batchSiteId}
              onChange={(e) => setBatchSiteId(e.target.value)}
              className="h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All eligible websites ({enabledEligibleSites.length})</option>
              {eligibleSites.map((s) => (
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
                type="button"
                onClick={() => setConfirmLiveBatch(true)}
                disabled={runningBatch || enabledEligibleSites.length === 0}
                className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Publish Live</span>
              </button>
            ) : batchMode === "live" && confirmLiveBatch ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRunBatch}
                  disabled={runningBatch || enabledEligibleSites.length === 0}
                  className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {runningBatch ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>Confirm Live Post</span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmLiveBatch(false)}
                  className="h-9 px-3 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleRunBatch}
                disabled={runningBatch || enabledEligibleSites.length === 0}
                className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {runningBatch ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                <span>{runningBatch ? "Running..." : "Execute Run"}</span>
              </button>
            )}
          </div>
        </div>
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
                <span className="font-mono tabular-nums text-emerald-700">
                  {latestRun.counts.ok} published
                </span>
                ,{" "}
                <span className="font-mono tabular-nums text-amber-700">
                  {latestRun.counts.dry} previews
                </span>
                ,{" "}
                <span className="font-mono tabular-nums text-red-700">
                  {latestRun.counts.error} errors
                </span>
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
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline"
                      >
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
