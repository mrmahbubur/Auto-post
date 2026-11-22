import { useState } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, Plus, RefreshCw, Rss, Sparkles, Trash2, UserCheck } from "lucide-react";
import { api } from "../api";
import type { Article, BootstrapState, SiteConfig } from "../types";

interface SitesViewProps {
  state: BootstrapState;
  onStateChange: (next: BootstrapState) => void;
  onOpenInComposer: (siteId: string, article: Article) => void;
}

const EMPTY_FORM: Partial<SiteConfig> = {
  id: "",
  name: "",
  url: "",
  feed: "",
  sitemap: "",
  brand_color: "#1a73e8",
  accent_color: "#ff6d00",
  hashtags: ["webdev", "blog"],
  handles: { bsky: "", x: "", threads: "" },
  enabled: true,
};

export function SitesView({ state, onStateChange, onOpenInComposer }: SitesViewProps) {
  const [editing, setEditing] = useState<Partial<SiteConfig>>(EMPTY_FORM);
  const [hashtagsText, setHashtagsText] = useState("webdev, blog");
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [gravIdentifier, setGravIdentifier] = useState(
    state.gravatar?.identifier || state.user?.email || ""
  );
  const [syncingGrav, setSyncingGrav] = useState(false);
  const [syncResultMsg, setSyncResultMsg] = useState("");

  const [testingSiteId, setTestingSiteId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<{ siteId: string; articles: Article[]; lookbackDays: number } | null>(null);
  const [probingFeed, setProbingFeed] = useState(false);
  const [probeNotice, setProbeNotice] = useState("");

  function startEdit(site: SiteConfig) {
    setEditing({ ...site, handles: { ...site.handles } });
    setHashtagsText((site.hashtags || []).join(", "));
    setErrorMsg("");
    setProbeNotice("");
  }

  function startNew() {
    setEditing({ ...EMPTY_FORM, handles: { bsky: "", x: "", threads: "" } });
    setHashtagsText("webdev, blog");
    setErrorMsg("");
    setProbeNotice("");
  }

  async function handleProbeUrl() {
    const raw = (editing.url || "").trim();
    if (!raw) {
      setErrorMsg("Enter a website URL first to auto-detect its RSS feed or sitemap.");
      return;
    }
    setProbingFeed(true);
    setErrorMsg("");
    setProbeNotice("");
    try {
      const res = await api.probeSite(raw);
      setEditing((prev) => ({
        ...prev,
        url: res.url || prev.url,
        name: prev.name?.trim() ? prev.name : res.title,
        feed: res.feed || prev.feed || "",
        sitemap: res.sitemap || prev.sitemap || "",
        brand_color: res.brand_color || prev.brand_color || "#1a73e8",
      }));
      setProbeNotice(
        res.discovery === "rss"
          ? `Detected RSS/Atom feed: ${res.feed}`
          : res.discovery === "sitemap"
          ? `Detected XML sitemap: ${res.sitemap}`
          : "No RSS/sitemap found; will extract metadata directly from the page URL."
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Feed detection failed");
    } finally {
      setProbingFeed(false);
    }
  }

  async function handleSyncGravatar(e: React.FormEvent) {
    e.preventDefault();
    if (!gravIdentifier.trim()) {
      setErrorMsg("Enter a Gravatar username, profile URL, or email address.");
      return;
    }
    setSyncingGrav(true);
    setErrorMsg("");
    setSyncResultMsg("");
    try {
      const res = await api.syncGravatar(gravIdentifier.trim(), true);
      onStateChange(res.state);
      if (res.syncedSites.length === 0) {
        setSyncResultMsg(
          `Connected ${res.profile.display_name} (@${res.profile.username}), but no external website links were found on that Gravatar profile yet.`
        );
      } else {
        const rssCount = res.syncedSites.filter((s) => s.discovery === "rss").length;
        const mapCount = res.syncedSites.filter((s) => s.discovery === "sitemap").length;
        const pageCount = res.syncedSites.filter((s) => s.discovery === "page").length;
        const parts = [
          rssCount ? `${rssCount} RSS/Atom` : "",
          mapCount ? `${mapCount} Sitemap` : "",
          pageCount ? `${pageCount} Page` : "",
        ]
          .filter(Boolean)
          .join(" · ");
        setSyncResultMsg(
          `Synced ${res.syncedSites.length} linked site${res.syncedSites.length === 1 ? "" : "s"} from ${res.profile.display_name} (${parts}).`
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to sync Gravatar linked sites");
    } finally {
      setSyncingGrav(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editing.name?.trim() || !editing.url?.trim()) {
      setErrorMsg("Site name and canonical URL are required.");
      return;
    }
    setSaving(true);
    setErrorMsg("");
    try {
      const hashtags = hashtagsText
        .split(",")
        .map((s) => s.trim().replace(/^#/, ""))
        .filter(Boolean);
      const res = await api.saveSite({ ...editing, hashtags });
      onStateChange(res.state);
      startNew();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save site");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setErrorMsg("");
    try {
      const res = await api.deleteSite(id);
      onStateChange(res.state);
      setConfirmDeleteId(null);
      if (editing.id === id) startNew();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to delete site");
    }
  }

  async function handleTestFeed(siteId: string, overrideLookback?: number) {
    const lookback = overrideLookback ?? state.settings.run.lookback_days;
    setTestingSiteId(siteId);
    setErrorMsg("");
    try {
      const res = await api.discoverSite(siteId, lookback, 8);
      setTestResults({ siteId, articles: res.articles, lookbackDays: lookback });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Feed test failed");
    } finally {
      setTestingSiteId(null);
    }
  }

  async function handleToggleSiteEnabled(site: SiteConfig) {
    setErrorMsg("");
    try {
      const res = await api.saveSite({ ...site, enabled: !site.enabled });
      onStateChange(res.state);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to toggle website status");
    }
  }

  const gravatarOnly = state.schedule.gravatar_only !== false;

  return (
    <div className="space-y-6">
      {errorMsg && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-xl text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Gravatar Profile Linked-Sites Auto-Discovery */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">Sync Websites from Gravatar Profile</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Connect a Gravatar username, profile URL, or email to automatically probe every linked website for RSS, Atom, or sitemap feeds and keep your source list synced daily.
            </p>
          </div>
          {state.gravatar?.profile && (
            <div className="flex items-center gap-3 shrink-0">
              <img
                src={state.gravatar.profile.avatar_url}
                alt={state.gravatar.profile.display_name}
                referrerPolicy="no-referrer"
                className="w-9 h-9 rounded-full object-cover border border-slate-200 bg-slate-100"
              />
              <div className="text-xs">
                <div className="font-semibold text-slate-900">{state.gravatar.profile.display_name}</div>
                <div className="text-slate-500 font-mono tabular-nums">
                  {state.gravatar.synced_site_ids.length} linked site{state.gravatar.synced_site_ids.length === 1 ? "" : "s"}
                  {state.gravatar.last_synced_at
                    ? ` · Synced ${new Date(state.gravatar.last_synced_at * 1000).toLocaleDateString()}`
                    : ""}
                </div>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleSyncGravatar} className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            value={gravIdentifier}
            onChange={(e) => setGravIdentifier(e.target.value)}
            placeholder="Gravatar username, profile URL (https://gravatar.com/name), or email"
            className="flex-1 h-10 px-3.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={syncingGrav || !gravIdentifier.trim()}
            className="inline-flex items-center justify-center gap-2 h-10 px-4 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {syncingGrav ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : state.gravatar?.profile ? (
              <RefreshCw className="w-4 h-4" />
            ) : (
              <UserCheck className="w-4 h-4" />
            )}
            <span>{syncingGrav ? "Scanning Linked Sites..." : "Connect & Sync Linked Sites"}</span>
          </button>
        </form>

        {syncResultMsg && (
          <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{syncResultMsg}</span>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 cols: Configured sites */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Configured Websites</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Each site supplies an RSS/Atom feed, sitemap, or page metadata plus brand colors for thumbnail generation.
              </p>
            </div>
            <button
              onClick={startNew}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Site</span>
            </button>
          </div>

          {gravatarOnly && (
            <div className="px-5 py-3 bg-blue-50/70 border-b border-blue-100 text-xs text-blue-900">
              Strict Gravatar-Only mode is active: automatic cycles, batch runs, and post generation only post articles from websites included on your Gravatar profile.
            </div>
          )}

          <div className="divide-y divide-slate-100">
            {state.sites.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No websites synced yet. Connect your Gravatar profile above to discover and monitor your linked websites.
              </div>
            ) : (
              state.sites.map((site) => {
                const isGravatarSite = site.source === "gravatar";
                const excludedByPolicy = gravatarOnly && !isGravatarSite;
                return (
                <div key={site.id} className="p-5 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-xs font-bold text-white"
                        style={{
                          background: `linear-gradient(135deg, ${site.brand_color}, ${site.accent_color})`,
                        }}
                      >
                        {site.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900 truncate">{site.name}</span>
                          <span className="text-xs text-slate-400">·</span>
                          <button
                            type="button"
                            onClick={() => handleToggleSiteEnabled(site)}
                            className={`text-xs font-medium hover:underline cursor-pointer ${
                              site.enabled ? "text-emerald-700" : "text-slate-400"
                            }`}
                          >
                            {site.enabled ? "Active" : "Paused"}
                          </button>
                          <span className="text-xs text-slate-400">·</span>
                          {isGravatarSite ? (
                            <span className="text-xs text-blue-700 font-medium">Gravatar Included</span>
                          ) : (
                            <span className="text-xs text-amber-700 font-medium">
                              {excludedByPolicy ? "Manual (Excluded while Gravatar-Only)" : "Manual Source"}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 truncate font-mono">
                          {site.feed || site.sitemap || site.url}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleTestFeed(site.id)}
                        disabled={testingSiteId === site.id}
                        className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        {testingSiteId === site.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Rss className="w-3.5 h-3.5" />
                        )}
                        <span>Test Feed</span>
                      </button>

                      <button
                        onClick={() => startEdit(site)}
                        className="h-8 px-3 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Edit
                      </button>

                      {confirmDeleteId === site.id ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleDelete(site.id)}
                            className="h-8 px-2.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md cursor-pointer"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="h-8 px-2 text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(site.id)}
                          className="h-8 w-8 inline-flex items-center justify-center text-slate-400 hover:text-red-600 rounded-md cursor-pointer"
                          title="Delete site"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span>Site URL: {site.url}</span>
                    {site.hashtags.length > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{site.hashtags.map((t) => `#${t}`).join(" ")}</span>
                      </>
                    )}
                  </div>

                  {/* Live Feed Test Results */}
                  {testResults?.siteId === site.id && (
                    <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                      <div className="text-xs font-medium text-slate-700">
                        Feed check returned {testResults.articles.length} articles:
                      </div>
                      {testResults.articles.length === 0 ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                          <span>
                            0 articles matched the {testResults.lookbackDays}-day lookback window.
                          </span>
                          {testResults.lookbackDays < 365 && (
                            <button
                              type="button"
                              onClick={() => handleTestFeed(site.id, 365)}
                              disabled={testingSiteId === site.id}
                              className="inline-flex items-center gap-1 text-blue-600 hover:underline font-medium cursor-pointer"
                            >
                              <RefreshCw className="w-3 h-3" />
                              <span>Retry with 365d lookback</span>
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg bg-slate-50/50">
                          {testResults.articles.map((art) => (
                            <div
                              key={art.key}
                              className="px-3 py-2 flex items-center justify-between gap-3 text-xs"
                            >
                              <div className="min-w-0">
                                <div className="font-medium text-slate-800 truncate">{art.title}</div>
                                <a
                                  href={art.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-slate-500 hover:text-blue-600 truncate max-w-md"
                                >
                                  <span className="truncate">{art.url}</span>
                                  <ExternalLink className="w-3 h-3 shrink-0" />
                                </a>
                              </div>
                              <button
                                onClick={() => onOpenInComposer(site.id, art)}
                                className="inline-flex items-center gap-1 h-7 px-2.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <Sparkles className="w-3 h-3" />
                                <span>Compose</span>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right 5 cols: Add / Edit Form */}
        <form
          onSubmit={handleSave}
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-900">
              {editing.id ? `Edit ${editing.name}` : "Add Website Source"}
            </h2>
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(editing.enabled)}
                onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Enabled</span>
            </label>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Site Name</label>
            <input
              type="text"
              required
              value={editing.name || ""}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="e.g. Engineering Blog"
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Canonical Website URL</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="url"
                required
                value={editing.url || ""}
                onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                placeholder="https://yourdomain.com"
                className="flex-1 min-w-0 h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={handleProbeUrl}
                disabled={probingFeed || !(editing.url || "").trim()}
                className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                {probingFeed ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rss className="w-3.5 h-3.5" />}
                <span>Detect Feed</span>
              </button>
            </div>
            {probeNotice && (
              <p className="mt-1.5 text-[11px] text-emerald-700 font-medium break-all">{probeNotice}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              RSS / Atom Feed URL
            </label>
            <input
              type="text"
              inputMode="url"
              value={editing.feed || ""}
              onChange={(e) => setEditing({ ...editing, feed: e.target.value })}
              placeholder="https://yourdomain.com/feed.xml"
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Sitemap URL (optional fallback if no RSS/Atom feed)
            </label>
            <input
              type="text"
              inputMode="url"
              value={editing.sitemap || ""}
              onChange={(e) => setEditing({ ...editing, sitemap: e.target.value })}
              placeholder="https://yourdomain.com/sitemap.xml"
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Brand Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={editing.brand_color || "#1a73e8"}
                  onChange={(e) => setEditing({ ...editing, brand_color: e.target.value })}
                  className="h-9 w-10 p-0.5 border border-slate-300 rounded-md cursor-pointer"
                />
                <input
                  type="text"
                  value={editing.brand_color || "#1a73e8"}
                  onChange={(e) => setEditing({ ...editing, brand_color: e.target.value })}
                  className="flex-1 h-9 px-2.5 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Accent Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={editing.accent_color || "#ff6d00"}
                  onChange={(e) => setEditing({ ...editing, accent_color: e.target.value })}
                  className="h-9 w-10 p-0.5 border border-slate-300 rounded-md cursor-pointer"
                />
                <input
                  type="text"
                  value={editing.accent_color || "#ff6d00"}
                  onChange={(e) => setEditing({ ...editing, accent_color: e.target.value })}
                  className="flex-1 h-9 px-2.5 text-xs font-mono border border-slate-300 rounded-lg"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Default Hashtags (comma-separated)</label>
            <input
              type="text"
              value={hashtagsText}
              onChange={(e) => setHashtagsText(e.target.value)}
              placeholder="webdev, performance, hosting"
              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Bluesky Handle</label>
              <input
                type="text"
                value={editing.handles?.bsky || ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    handles: { ...editing.handles, bsky: e.target.value },
                  })
                }
                placeholder="name.bsky.social"
                className="w-full h-9 px-3 text-xs font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Threads Handle</label>
              <input
                type="text"
                value={editing.handles?.threads || ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    handles: { ...editing.handles, threads: e.target.value },
                  })
                }
                placeholder="yourhandle"
                className="w-full h-9 px-3 text-xs font-mono border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            {editing.id && (
              <button
                type="button"
                onClick={startNew}
                className="h-9 px-3.5 text-sm font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{editing.id ? "Save Changes" : "Add Website"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
