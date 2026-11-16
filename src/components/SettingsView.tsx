import { useState } from "react";
import { AlertCircle, CalendarClock, CheckCircle2, Download, Loader2, Play, Trash2, Upload } from "lucide-react";
import { api } from "../api";
import type {
  AiSettings,
  BootstrapState,
  MediaHostSettings,
  RunSettings,
  ScheduleSettings,
  ThumbnailSettings,
} from "../types";

interface SettingsViewProps {
  state: BootstrapState;
  onStateChange: (next: BootstrapState) => void;
}

export function SettingsView({ state, onStateChange }: SettingsViewProps) {
  const [schedCfg, setSchedCfg] = useState<ScheduleSettings>(state.schedule);
  const [runCfg, setRunCfg] = useState<RunSettings>(state.settings.run);
  const [aiCfg, setAiCfg] = useState<AiSettings>(state.settings.ai);
  const [thumbCfg, setThumbCfg] = useState<ThumbnailSettings>(state.settings.thumbnail);
  const [mediaCfg, setMediaCfg] = useState<MediaHostSettings>(state.settings.media_host);
  const [githubToken, setGithubToken] = useState("");

  const [saving, setSaving] = useState(false);
  const [runningCycle, setRunningCycle] = useState(false);
  const [savedNotice, setSavedNotice] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const [yamlText, setYamlText] = useState("");
  const [yamlBusy, setYamlBusy] = useState(false);
  const [yamlSuccess, setYamlSuccess] = useState("");

  async function handleSaveAll(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrorMsg("");
    setSavedNotice("");
    try {
      await api.updateSchedule({
        enabled: schedCfg.enabled,
        frequency: schedCfg.frequency,
        post_time: schedCfg.post_time,
        timezone: schedCfg.timezone,
        mode: schedCfg.mode,
        sync_gravatar: schedCfg.sync_gravatar,
      });
      const res = await api.updateSettings({
        run: runCfg,
        ai: aiCfg,
        thumbnail: thumbCfg,
        media_host: mediaCfg,
        githubToken: githubToken.trim() || undefined,
      });
      onStateChange(res.state);
      setSchedCfg(res.state.schedule);
      setGithubToken("");
      setSavedNotice("Settings & daily schedule saved");
      setTimeout(() => setSavedNotice(""), 2500);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleRunCycleNow() {
    setRunningCycle(true);
    setErrorMsg("");
    setSavedNotice("");
    try {
      const res = await api.runScheduleNow();
      onStateChange(res.state);
      setSchedCfg(res.state.schedule);
      setSavedNotice(
        res.run
          ? `Completed cycle (${res.run.counts.ok} published, ${res.run.counts.dry} previews, ${res.run.counts.error} errors)`
          : "Cycle finished"
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to run automated cycle");
    } finally {
      setRunningCycle(false);
    }
  }

  async function handleClearGithubToken() {
    setErrorMsg("");
    try {
      const res = await api.clearSecret("GITHUB_TOKEN");
      onStateChange(res.state);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to clear token");
    }
  }

  async function handleExportYaml() {
    setYamlBusy(true);
    setErrorMsg("");
    try {
      const y = await api.exportYaml();
      setYamlText(y);
      setYamlSuccess("Exported current configuration to YAML.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Export failed");
    } finally {
      setYamlBusy(false);
    }
  }

  async function handleImportYaml() {
    if (!yamlText.trim()) return;
    setYamlBusy(true);
    setErrorMsg("");
    try {
      const res = await api.importYaml(yamlText);
      onStateChange(res.state);
      setRunCfg(res.state.settings.run);
      setAiCfg(res.state.settings.ai);
      setThumbCfg(res.state.settings.thumbnail);
      setMediaCfg(res.state.settings.media_host);
      setYamlSuccess("Imported config.yaml into database.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Import failed");
    } finally {
      setYamlBusy(false);
    }
  }

  function formatEpoch(sec: number | null | undefined): string {
    if (!sec) return "—";
    return new Date(sec * 1000).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="space-y-6">
      {errorMsg && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-xl text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSaveAll} className="space-y-6">
        {/* Daily Auto-Post Scheduler */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-blue-600 shrink-0" />
                <h2 className="text-base font-semibold text-slate-900">Daily Auto-Post Scheduler</h2>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Automatically syncs your Gravatar linked sites, discovers unread articles, writes platform captions, renders 1200×630 PNG thumbnails, and publishes daily.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={schedCfg.enabled}
                onChange={(e) => setSchedCfg({ ...schedCfg, enabled: e.target.checked })}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>{schedCfg.enabled ? "Auto-posting active" : "Scheduler paused"}</span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Cadence</label>
              <select
                value={schedCfg.frequency}
                onChange={(e) =>
                  setSchedCfg({ ...schedCfg, frequency: e.target.value as ScheduleSettings["frequency"] })
                }
                className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="daily">Daily (1× per day)</option>
                <option value="every_12h">Every 12 hours</option>
                <option value="every_6h">Every 6 hours</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Daily Post Time</label>
              <input
                type="time"
                value={schedCfg.post_time}
                onChange={(e) => setSchedCfg({ ...schedCfg, post_time: e.target.value })}
                disabled={schedCfg.frequency !== "daily"}
                className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg font-mono tabular-nums disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-700">Timezone (IANA)</label>
                <button
                  type="button"
                  onClick={() => {
                    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
                    setSchedCfg({ ...schedCfg, timezone: detected });
                    setRunCfg({ ...runCfg, timezone: detected });
                  }}
                  className="text-[11px] text-blue-600 hover:underline cursor-pointer"
                >
                  Use local
                </button>
              </div>
              <input
                type="text"
                value={schedCfg.timezone}
                onChange={(e) => setSchedCfg({ ...schedCfg, timezone: e.target.value })}
                placeholder="Asia/Dhaka or UTC"
                className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Execution Mode</label>
              <select
                value={schedCfg.mode}
                onChange={(e) =>
                  setSchedCfg({ ...schedCfg, mode: e.target.value as ScheduleSettings["mode"] })
                }
                className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="live">Live Publish (Connected APIs)</option>
                <option value="dry">Dry Preview (Safe mode)</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-slate-100">
            <div className="space-y-2">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={schedCfg.sync_gravatar}
                  onChange={(e) => setSchedCfg({ ...schedCfg, sync_gravatar: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Re-sync linked websites from connected Gravatar profile before each scheduled run</span>
              </label>

              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-mono tabular-nums">
                <span>Next run: {schedCfg.enabled ? formatEpoch(state.schedule.next_run_at) : "Paused"}</span>
                <span aria-hidden="true">·</span>
                <span>Last run: {formatEpoch(state.schedule.last_run_at)}</span>
                <span aria-hidden="true">·</span>
                <span
                  className={
                    state.schedule.last_status === "error"
                      ? "text-red-700"
                      : state.schedule.last_status === "ok"
                      ? "text-emerald-700"
                      : "text-slate-600"
                  }
                >
                  Status: {state.schedule.last_status}
                </span>
              </div>
              {state.schedule.last_error && (
                <div className="text-xs text-red-700">{state.schedule.last_error}</div>
              )}
            </div>

            <button
              type="button"
              onClick={handleRunCycleNow}
              disabled={runningCycle}
              className="inline-flex items-center justify-center gap-2 h-9 px-4 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {runningCycle ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              <span>{runningCycle ? "Running Cycle..." : "Run Auto-Cycle Now"}</span>
            </button>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* AI Writer Settings */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h2 className="text-base font-semibold text-slate-900">AI Copy Writer (Gemini)</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Uses server-side Gemini to write 14 platform-native captions per article. Disable to use the rule-based formatter.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={aiCfg.enabled}
                  onChange={(e) => setAiCfg({ ...aiCfg, enabled: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Enabled</span>
              </label>
            </div>

            <div className="flex items-center justify-between text-xs py-2 px-3 bg-slate-50 rounded-lg">
              <span className="text-slate-600">Server Writer Status</span>
              <span
                className={`font-medium ${
                  !aiCfg.enabled
                    ? "text-slate-700"
                    : state.geminiReady
                    ? "text-emerald-700"
                    : "text-red-700"
                }`}
              >
                {!aiCfg.enabled
                  ? "Rule-based formatter selected"
                  : state.geminiReady
                  ? "Gemini API active (server-side)"
                  : "GEMINI_API_KEY not set on server"}
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Gemini Model</label>
              <select
                value={aiCfg.model}
                onChange={(e) => setAiCfg({ ...aiCfg, model: e.target.value })}
                className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="gemini-4-hydrogen">gemini-4-hydrogen (balanced default)</option>
                <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (fastest, lowest cost)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Brand Voice System Prompt</label>
              <textarea
                rows={4}
                value={aiCfg.brand_voice}
                onChange={(e) => setAiCfg({ ...aiCfg, brand_voice: e.target.value })}
                placeholder="Direct, friendly, first-person-plural. Short sentences. Lead with the concrete takeaway."
                className="w-full p-3 text-sm bg-white border border-slate-300 rounded-lg leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </section>

          {/* Run Defaults */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
            <div className="pb-3 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-900">Pipeline & Discovery Defaults</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Controls how batch runs filter RSS/Atom feeds and sitemaps.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Max Articles Per Site</label>
                <input
                  type="number"
                  min={1}
                  max={25}
                  value={runCfg.max_per_site}
                  onChange={(e) => setRunCfg({ ...runCfg, max_per_site: Number(e.target.value) || 1 })}
                  className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg font-mono tabular-nums"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Lookback Window (days)</label>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={runCfg.lookback_days}
                  onChange={(e) => setRunCfg({ ...runCfg, lookback_days: Number(e.target.value) || 14 })}
                  className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg font-mono tabular-nums"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Timezone</label>
              <input
                type="text"
                value={runCfg.timezone}
                onChange={(e) => setRunCfg({ ...runCfg, timezone: e.target.value })}
                placeholder="Asia/Dhaka or UTC"
                className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg font-mono"
              />
            </div>
          </section>

          {/* Thumbnail Renderer Settings */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
            <div className="pb-3 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-900">1200×630 PNG Thumbnail Renderer</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Server-rendered PNG cards with site chip, auto-fitted headline, accent glow, and contrast scrim.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Width (px)</label>
                <input
                  type="number"
                  value={thumbCfg.width}
                  onChange={(e) => setThumbCfg({ ...thumbCfg, width: Number(e.target.value) || 1200 })}
                  className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Height (px)</label>
                <input
                  type="number"
                  value={thumbCfg.height}
                  onChange={(e) => setThumbCfg({ ...thumbCfg, height: Number(e.target.value) || 630 })}
                  className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Style</label>
                <select
                  value={thumbCfg.style}
                  onChange={(e) =>
                    setThumbCfg({ ...thumbCfg, style: e.target.value as ThumbnailSettings["style"] })
                  }
                  className="w-full h-9 px-2.5 text-sm bg-white border border-slate-300 rounded-lg"
                >
                  <option value="gradient">gradient</option>
                  <option value="photo">photo</option>
                  <option value="solid">solid</option>
                </select>
              </div>
            </div>

            <label className="inline-flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={thumbCfg.use_og_image}
                onChange={(e) => setThumbCfg({ ...thumbCfg, use_og_image: e.target.checked })}
                className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>
                Blend article&apos;s own <code className="font-mono">og:image</code> behind the brand gradient
              </span>
            </label>
          </section>

          {/* Public Media Hosting */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
            <div className="pb-3 border-b border-slate-100">
              <h2 className="text-base font-semibold text-slate-900">Public Image Host</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Dev.to, Threads, and Pinterest require a public HTTPS image URL instead of binary upload.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Provider</label>
                <select
                  value={mediaCfg.provider}
                  onChange={(e) =>
                    setMediaCfg({ ...mediaCfg, provider: e.target.value as MediaHostSettings["provider"] })
                  }
                  className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg font-mono"
                >
                  <option value="app_url">app_url (Signed App HTTPS)</option>
                  <option value="github_raw">github_raw</option>
                  <option value="none">none</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Branch</label>
                <input
                  type="text"
                  value={mediaCfg.branch}
                  onChange={(e) => setMediaCfg({ ...mediaCfg, branch: e.target.value })}
                  placeholder="main"
                  disabled={mediaCfg.provider !== "github_raw"}
                  className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg font-mono disabled:opacity-50"
                />
              </div>
            </div>

            {mediaCfg.provider === "app_url" ? (
              <div className="text-xs text-slate-600 bg-slate-50 rounded-lg p-3 leading-relaxed">
                Uses HMAC-SHA256 signed links under <code className="font-mono">/api/media/...</code> so Dev.to, Threads, Pinterest, and Discord can fetch generated PNG thumbnails without unlocking private assets.
              </div>
            ) : mediaCfg.provider === "github_raw" ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">GitHub Repo (owner/repo)</label>
                    <input
                      type="text"
                      value={mediaCfg.repo}
                      onChange={(e) => setMediaCfg({ ...mediaCfg, repo: e.target.value })}
                      placeholder="yourname/social-media"
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Path Prefix</label>
                    <input
                      type="text"
                      value={mediaCfg.path_prefix}
                      onChange={(e) => setMediaCfg({ ...mediaCfg, path_prefix: e.target.value })}
                      placeholder="autopost"
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-slate-700 font-mono">GITHUB_TOKEN</label>
                    <div className="flex items-center gap-2 text-xs">
                      <span
                        className={
                          state.secretStatus.GITHUB_TOKEN ? "text-emerald-700 font-medium" : "text-slate-400"
                        }
                      >
                        {state.secretStatus.GITHUB_TOKEN ? "Set on server" : "Not set"}
                      </span>
                      {state.secretStatus.GITHUB_TOKEN && (
                        <button
                          type="button"
                          onClick={handleClearGithubToken}
                          className="text-slate-400 hover:text-red-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={githubToken}
                    onChange={(e) => setGithubToken(e.target.value)}
                    placeholder={
                      state.secretStatus.GITHUB_TOKEN
                        ? "•••••••• (enter new token to replace)"
                        : "Fine-grained PAT (Contents: read & write)"
                    }
                    className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </>
            ) : null}
          </section>
        </div>

        <div className="flex items-center justify-end gap-3">
          {savedNotice && (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="w-4 h-4" />
              <span>{savedNotice}</span>
            </span>
          )}
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 h-10 px-5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>Save All Settings</span>
          </button>
        </div>
      </form>

      {/* config.yaml Import / Export */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">config.yaml Compatibility</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Export your current settings as <code className="font-mono">config.yaml</code> for GitHub Actions, or paste an existing YAML file to import sites and platform configs.
            </p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleExportYaml}
              disabled={yamlBusy}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Load Current YAML</span>
            </button>
            <button
              type="button"
              onClick={handleImportYaml}
              disabled={yamlBusy || !yamlText.trim()}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import YAML</span>
            </button>
          </div>
        </div>

        {yamlSuccess && <div className="text-xs font-medium text-emerald-700">{yamlSuccess}</div>}

        <textarea
          rows={10}
          value={yamlText}
          onChange={(e) => setYamlText(e.target.value)}
          placeholder="Click 'Load Current YAML' or paste a config.yaml file here..."
          className="w-full p-3 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </section>
    </div>
  );
}
