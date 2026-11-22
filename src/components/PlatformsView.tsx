import { useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, KeyRound, Loader2, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { api } from "../api";
import type { BootstrapState, PlatformInfo } from "../types";

interface PlatformsViewProps {
  state: BootstrapState;
  onStateChange: (next: BootstrapState) => void;
}

const PLATFORM_CONFIG_FIELDS: Record<
  string,
  Array<{ key: string; label: string; placeholder: string; type?: "text" | "csv" }>
> = {
  mastodon: [{ key: "instance", label: "Mastodon Instance URL", placeholder: "https://mastodon.social" }],
  telegram: [{ key: "chat_id", label: "Channel Username or Chat ID", placeholder: "@your_channel" }],
  reddit: [
    { key: "subreddits", label: "Subreddits (comma-separated)", placeholder: "webdev, test", type: "csv" },
    { key: "flair_id", label: "Flair ID (optional)", placeholder: "" },
  ],
  facebook_page: [{ key: "page_id", label: "Facebook Page ID", placeholder: "1234567890" }],
  linkedin: [{ key: "author_urn", label: "Author URN", placeholder: "urn:li:person:XXXX" }],
  threads: [{ key: "user_id", label: "Threads User ID", placeholder: "me" }],
  pinterest: [
    { key: "board_id", label: "Pinterest Board ID", placeholder: "1234567890" },
    { key: "api_base", label: "API Base URL (optional sandbox)", placeholder: "https://api.pinterest.com" },
  ],
};

export function PlatformsView({ state, onStateChange }: PlatformsViewProps) {
  const [expanded, setExpanded] = useState<string>("bluesky");
  const [filter, setFilter] = useState<"all" | "ready" | "enabled">("all");
  const [draftConfig, setDraftConfig] = useState<Record<string, Record<string, unknown>>>({});
  const [draftSecrets, setDraftSecrets] = useState<Record<string, Record<string, string>>>({});
  const [savingName, setSavingName] = useState<string | null>(null);
  const [verifyingName, setVerifyingName] = useState<string | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<string, { ok: boolean; detail: string }>>({});
  const [errorMsg, setErrorMsg] = useState("");
  const [savedToast, setSavedToast] = useState<string | null>(null);

  const visible = state.platforms.filter((p) => {
    if (filter === "ready") return p.ready;
    if (filter === "enabled") return p.enabled;
    return true;
  });

  function getConfigObj(p: PlatformInfo): Record<string, unknown> {
    return draftConfig[p.name] ?? p.config ?? {};
  }

  function setConfigField(platformName: string, key: string, val: unknown, base: Record<string, unknown>) {
    setDraftConfig((prev) => ({
      ...prev,
      [platformName]: { ...(prev[platformName] ?? base), [key]: val },
    }));
  }

  function setSecretField(platformName: string, envKey: string, val: string) {
    setDraftSecrets((prev) => ({
      ...prev,
      [platformName]: { ...(prev[platformName] || {}), [envKey]: val },
    }));
  }

  async function handleSavePlatform(p: PlatformInfo, overrideEnabled?: boolean) {
    setSavingName(p.name);
    setErrorMsg("");
    try {
      const secrets = draftSecrets[p.name] || {};
      const hasNewSecret = Object.values(secrets).some((v) => typeof v === "string" && v.trim().length > 0);
      const enabled = overrideEnabled ?? (hasNewSecret && !p.enabled ? true : p.enabled);
      const config = getConfigObj(p);
      const res = await api.updatePlatform(p.name, { enabled, config, secrets });
      onStateChange(res.state);
      setDraftSecrets((prev) => ({ ...prev, [p.name]: {} }));
      setDraftConfig((prev) => {
        const next = { ...prev };
        delete next[p.name];
        return next;
      });
      setVerifyResults((prev) => {
        const next = { ...prev };
        delete next[p.name];
        return next;
      });
      setSavedToast(p.label);
      setTimeout(() => setSavedToast(null), 2000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save platform settings");
    } finally {
      setSavingName(null);
    }
  }

  async function handleVerifyPlatform(p: PlatformInfo) {
    setVerifyingName(p.name);
    setErrorMsg("");
    try {
      const res = await api.verifyPlatform(p.name);
      setVerifyResults((prev) => ({ ...prev, [p.name]: { ok: res.ok, detail: res.detail } }));
    } catch (err) {
      setVerifyResults((prev) => ({
        ...prev,
        [p.name]: { ok: false, detail: err instanceof Error ? err.message : "Verification failed" },
      }));
    } finally {
      setVerifyingName(null);
    }
  }

  async function handleClearSecret(envKey: string) {
    setErrorMsg("");
    try {
      const res = await api.clearSecret(envKey);
      onStateChange(res.state);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to clear credential");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {state.platforms.length} Official Platform Publishers
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Credentials are stored strictly server-side in SQLite and never sent back to the browser. Missing credentials safely skip during live runs.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg self-start">
          {(
            [
              ["all", `All (${state.platforms.length})`],
              ["enabled", `Enabled (${state.platforms.filter((p) => p.enabled).length})`],
              ["ready", `Ready (${state.platforms.filter((p) => p.ready).length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                filter === id ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-xl text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
        {visible.map((p) => {
          const isOpen = expanded === p.name;
          const cfgObj = getConfigObj(p);
          const cfgFields = PLATFORM_CONFIG_FIELDS[p.name] || [];
          const secretInputs = draftSecrets[p.name] || {};

          return (
            <div key={p.name} className="transition-colors">
              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? "" : p.name)}
                  className="flex items-center gap-3 text-left min-w-0 cursor-pointer"
                >
                  {isOpen ? (
                    <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{p.label}</span>
                      <span className="text-xs text-slate-400">·</span>
                      <span className="text-xs text-slate-500">{p.effort}</span>
                      <span className="text-xs text-slate-400">·</span>
                      <span className="text-xs font-mono tabular-nums text-slate-500">
                        {p.char_limit.toLocaleString()} chars
                      </span>
                      {p.needs_public_url && (
                        <>
                          <span className="text-xs text-slate-400">·</span>
                          <span className="text-xs text-amber-700 font-medium">Needs public image URL</span>
                        </>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                      {p.ready ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Credentials configured</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-700">
                          <KeyRound className="w-3.5 h-3.5" />
                          <span>Missing: {p.missing_env.join(", ")}</span>
                        </span>
                      )}
                      {p.safety !== "safe" && (
                        <>
                          <span className="text-slate-400">·</span>
                          <span className="inline-flex items-center gap-1 text-slate-500">
                            <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                            <span>
                              {p.safety === "manual" ? "Manual posting recommended" : "Keep frequency human"}
                            </span>
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </button>

                <div className="flex items-center gap-3 self-end sm:self-center shrink-0">
                  {savedToast === p.label && (
                    <span className="text-xs font-medium text-emerald-700">Saved</span>
                  )}
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={(e) => handleSavePlatform(p, e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>{p.enabled ? "Enabled" : "Disabled"}</span>
                  </label>
                </div>
              </div>

              {isOpen && (
                <div className="px-5 pb-5 pt-2 bg-slate-50/70 border-t border-slate-100 space-y-4">
                  <p className="text-xs text-slate-600 leading-relaxed">{p.notes}</p>

                  {cfgFields.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {cfgFields.map((field) => {
                        const rawVal = cfgObj[field.key];
                        const displayVal =
                          field.type === "csv" && Array.isArray(rawVal)
                            ? rawVal.join(", ")
                            : String(rawVal ?? "");
                        return (
                          <div key={field.key}>
                            <label className="block text-xs font-medium text-slate-700 mb-1">
                              {field.label}
                            </label>
                            <input
                              type="text"
                              value={displayVal}
                              placeholder={field.placeholder}
                              onChange={(e) => {
                                const v =
                                  field.type === "csv"
                                    ? e.target.value
                                        .split(",")
                                        .map((s) => s.trim())
                                        .filter(Boolean)
                                    : e.target.value;
                                setConfigField(p.name, field.key, v, p.config);
                              }}
                              className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {p.required_env.map((envKey) => {
                      const isConfigured = Boolean(state.secretStatus[envKey]);
                      return (
                        <div key={envKey}>
                          <div className="flex items-center justify-between mb-1">
                            <label className="text-xs font-medium text-slate-700 font-mono">{envKey}</label>
                            <div className="flex items-center gap-2 text-xs">
                              <span className={isConfigured ? "text-emerald-700 font-medium" : "text-slate-400"}>
                                {isConfigured ? "Set on server" : "Not set"}
                              </span>
                              {isConfigured && (
                                <button
                                  type="button"
                                  onClick={() => handleClearSecret(envKey)}
                                  className="text-slate-400 hover:text-red-600 cursor-pointer"
                                  title={`Clear ${envKey}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                          <input
                            type="password"
                            autoComplete="new-password"
                            value={secretInputs[envKey] || ""}
                            onChange={(e) => setSecretField(p.name, envKey, e.target.value)}
                            placeholder={isConfigured ? "•••••••• (enter new value to replace)" : `Enter ${envKey}`}
                            className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      );
                    })}
                  </div>

                  {verifyResults[p.name] && (
                    <div
                      className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs border ${
                        verifyResults[p.name].ok
                          ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                          : "bg-red-50 border-red-200 text-red-800"
                      }`}
                    >
                      {verifyResults[p.name].ok ? (
                        <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-600" />
                      ) : (
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-red-600" />
                      )}
                      <span>{verifyResults[p.name].detail}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                    {p.ready && (
                      <button
                        type="button"
                        onClick={() => handleVerifyPlatform(p)}
                        disabled={verifyingName === p.name || savingName === p.name}
                        className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                      >
                        {verifyingName === p.name ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                        )}
                        <span>{verifyingName === p.name ? "Verifying..." : "Verify Credentials"}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleSavePlatform(p)}
                      disabled={savingName === p.name}
                      className="inline-flex items-center gap-2 h-9 px-4 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                    >
                      {savingName === p.name && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>Save {p.label} Settings</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
