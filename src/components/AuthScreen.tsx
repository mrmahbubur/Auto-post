import { useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Globe,
  Layers,
  Loader2,
  Lock,
  Rss,
  Server,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { api, clearApiBaseUrl, getApiBaseUrl, probeApiBaseUrl, setApiBaseUrl } from "../api";
import type { AuthStatus, AuthUser } from "../types";

interface PublicGravatarSummary {
  display_name: string;
  profile_url: string;
  avatar_url: string;
  job_title: string;
  company: string;
  location: string;
  description: string;
  links: Array<{ label: string; url: string }>;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeGravatarSlug(raw: string): Promise<string> {
  const clean = raw.trim();
  if (clean.includes("@") && !clean.startsWith("http")) {
    return sha256Hex(clean);
  }
  if (/^https?:\/\//i.test(clean)) {
    try {
      const u = new URL(clean);
      const seg = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean).pop();
      if (seg) return Promise.resolve(seg.replace(/\.(json|xml)$/i, ""));
    } catch {
      // fall through
    }
  }
  return Promise.resolve(clean.replace(/^@/, ""));
}

interface AuthScreenProps {
  status: AuthStatus;
  onAuthenticated: (user: AuthUser) => void;
  onServerChanged?: () => void;
  backendDisconnected?: boolean;
  connectionError?: string;
}

export function AuthScreen({
  status,
  onAuthenticated,
  onServerChanged,
  backendDisconnected = false,
  connectionError = "",
}: AuthScreenProps) {
  const initialMode: "login" | "signup" = !status.hasUsers ? "signup" : "login";
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [serverInput, setServerInput] = useState(() => getApiBaseUrl());
  const [probingServer, setProbingServer] = useState(false);
  const [probeError, setProbeError] = useState("");
  const [copiedCmd, setCopiedCmd] = useState(false);

  const [gravQuery, setGravQuery] = useState("beau");
  const [gravLoading, setGravLoading] = useState(false);
  const [gravError, setGravError] = useState("");
  const [gravPreview, setGravPreview] = useState<PublicGravatarSummary | null>(null);

  useEffect(() => {
    if (status.hasUsers && !status.allowSignups && mode === "signup") {
      setMode("login");
    } else if (!status.hasUsers && mode === "login") {
      setMode("signup");
    }
  }, [status.hasUsers, status.allowSignups, mode]);

  async function handleConnectServer(candidateUrl: string) {
    setProbeError("");
    setProbingServer(true);
    try {
      const { url } = await probeApiBaseUrl(candidateUrl);
      setApiBaseUrl(url);
      setServerInput(url);
      setShowServerConfig(false);
      onServerChanged?.();
    } catch (err) {
      setProbeError(err instanceof Error ? err.message : "Could not reach AutoPost backend.");
    } finally {
      setProbingServer(false);
    }
  }

  async function handleLookupPublicGravatar(e: React.FormEvent) {
    e.preventDefault();
    if (!gravQuery.trim()) return;
    setGravLoading(true);
    setGravError("");
    try {
      const slugId = await normalizeGravatarSlug(gravQuery);
      const res = await fetch(`https://api.gravatar.com/v3/profiles/${encodeURIComponent(slugId)}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`No public Gravatar profile found for "${gravQuery.trim()}" (HTTP ${res.status}).`);
      }
      const d = (await res.json()) as Record<string, unknown>;
      const rawLinks = Array.isArray(d.links) ? (d.links as Array<Record<string, unknown>>) : [];
      const rawAccounts = Array.isArray(d.verified_accounts)
        ? (d.verified_accounts as Array<Record<string, unknown>>)
        : [];
      const links = [
        ...rawLinks.map((l) => ({ label: String(l.label || l.url || "Link"), url: String(l.url || "") })),
        ...rawAccounts
          .filter((a) => !a.is_hidden)
          .map((a) => ({
            label: String(a.service_label || a.service_type || "Account"),
            url: String(a.url || ""),
          })),
      ].filter((l) => l.url.startsWith("http"));

      const avatar = String(d.avatar_url || "");
      setGravPreview({
        display_name: String(d.display_name || slugId),
        profile_url: String(d.profile_url || `https://gravatar.com/${slugId}`),
        avatar_url: avatar ? (avatar.includes("?") ? `${avatar}&s=256` : `${avatar}?s=256`) : "",
        job_title: String(d.job_title || ""),
        company: String(d.company || ""),
        location: String(d.location || ""),
        description: String(d.description || ""),
        links: links.slice(0, 5),
      });
    } catch (err) {
      setGravPreview(null);
      setGravError(err instanceof Error ? err.message : "Failed to fetch Gravatar profile.");
    } finally {
      setGravLoading(false);
    }
  }

  const signupDisabled = status.hasUsers && !status.allowSignups;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErrorMsg("Enter your email address.");
      return;
    }

    if (mode === "signup") {
      if (signupDisabled) {
        setErrorMsg("New signups are locked by the site administrator.");
        return;
      }
      if (name.trim().length < 2) {
        setErrorMsg("Enter your full name (at least 2 characters).");
        return;
      }
      if (password.length < 8) {
        setErrorMsg("Password must be at least 8 characters long.");
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg("Passwords do not match.");
        return;
      }

      setSubmitting(true);
      try {
        const res = await api.signup({ name: name.trim(), email: cleanEmail, password });
        onAuthenticated(res.user);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Could not create account");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!password) {
      setErrorMsg("Enter your password.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.login({ email: cleanEmail, password });
      onAuthenticated(res.user);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="h-16 bg-white border-b border-slate-200 px-6 lg:px-10 flex items-center justify-between gap-4">
        <span className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
          AutoPost
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setServerInput(getApiBaseUrl());
              setShowServerConfig((v) => !v);
            }}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Server className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate max-w-[180px]">
              {getApiBaseUrl() ? getApiBaseUrl().replace(/^https?:\/\//i, "") : "API: Same-Origin"}
            </span>
          </button>
          <span className="hidden sm:inline text-xs font-medium text-slate-500 whitespace-nowrap">
            Multi-Platform Syndication
          </span>
        </div>
      </header>

      {showServerConfig && (
        <div className="bg-white border-b border-slate-200 px-6 lg:px-10 py-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!serverInput.trim()) {
                clearApiBaseUrl();
                setProbeError("");
                setShowServerConfig(false);
                onServerChanged?.();
              } else {
                handleConnectServer(serverInput);
              }
            }}
            className="max-w-5xl mx-auto flex flex-wrap items-center gap-2.5"
          >
            <label htmlFor="auth-api-url" className="text-xs font-medium text-slate-700 whitespace-nowrap">
              Backend API URL
            </label>
            <input
              id="auth-api-url"
              type="text"
              value={serverInput}
              onChange={(e) => {
                setServerInput(e.target.value);
                if (probeError) setProbeError("");
              }}
              placeholder="https://your-autopost-server.run.app or localhost:3000"
              className="flex-1 min-w-[240px] h-9 px-3 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={probingServer}
              className="h-9 px-3.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg cursor-pointer whitespace-nowrap"
            >
              {probingServer ? "Checking..." : "Apply"}
            </button>
            <button
              type="button"
              onClick={() => {
                clearApiBaseUrl();
                setServerInput("");
                setProbeError("");
                setShowServerConfig(false);
                onServerChanged?.();
              }}
              className="h-9 px-3 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer whitespace-nowrap"
            >
              Use Same-Origin
            </button>
          </form>
          {probeError && (
            <div className="max-w-5xl mx-auto mt-2 flex items-start gap-2 text-xs text-red-700">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-red-600" />
              <span>{probeError}</span>
            </div>
          )}
        </div>
      )}

      <main className="flex-1 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          {/* Left column: Clear product & workflow architecture */}
          <div className="lg:col-span-6 space-y-6 pt-2">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 text-xs font-medium text-blue-700">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Automated Multi-Platform Publishing</span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-tight text-balance">
                Discover feeds, write platform copy, and syndicate daily.
              </h1>
              <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-lg">
                Connect any RSS, Atom, sitemap, or Gravatar profile. AutoPost generates tailored captions with Gemini, renders crisp 1200×630 PNG cards, and publishes across 11 social APIs with a duplicate-safe SQLite ledger.
              </p>
            </div>

            <div className="border-t border-slate-200 pt-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Rss className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>Gravatar &amp; Feed Discovery</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Automatically probes websites linked to your Gravatar profile and extracts RSS feeds, sitemaps, and OpenGraph artwork.
                </p>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Sparkles className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>Gemini 15-Field Composer</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Writes distinct native captions for Bluesky, Mastodon, LinkedIn, Telegram, Discord, X, Threads, Reddit, Pinterest, Dev.to, and Facebook.
                </p>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Layers className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>1200×630 PNG Cards</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Server-rendered high-contrast social cards with HMAC-signed public URLs and GitHub raw media hosting support.
                </p>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Lock className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>Isolated Credential Vault</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  API tokens stay on your backend in SQLite with scrypt authentication, plus YAML export for GitHub Actions.
                </p>
              </div>
            </div>
          </div>

          {/* Right column: Backend Connection Setup or Sign In / Signup Card */}
          <div className="lg:col-span-6 space-y-5">
            {backendDisconnected || connectionError ? (
              <>
                <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-5">
                  <div className="space-y-1.5 pb-4 border-b border-slate-100">
                    <div className="flex items-center gap-2 text-xs font-semibold text-blue-700">
                      <Server className="w-4 h-4 shrink-0" />
                      <span>Static Frontend Hosting</span>
                    </div>
                    <h2 className="text-lg font-semibold text-slate-900">
                      Connect Your AutoPost Backend
                    </h2>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      This static page needs an AutoPost Node server (Cloud Run, Docker, Render, or local{" "}
                      <code className="font-mono">npm start</code>) for SQLite storage, server-side Gemini copy, PNG rendering, and social API publishing.
                    </p>
                  </div>

                  {(probeError || connectionError) && (
                    <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-800 px-3.5 py-2.5 rounded-lg text-xs">
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
                      <span>{probeError || connectionError}</span>
                    </div>
                  )}

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleConnectServer(serverInput);
                    }}
                    className="space-y-4"
                  >
                    <div>
                      <label htmlFor="connect-api-url" className="block text-xs font-medium text-slate-700 mb-1.5">
                        AutoPost Backend URL
                      </label>
                      <input
                        id="connect-api-url"
                        type="text"
                        required
                        value={serverInput}
                        onChange={(e) => setServerInput(e.target.value)}
                        placeholder="https://your-autopost-server.run.app or localhost:3000"
                        className="w-full h-10 px-3.5 text-sm font-mono bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="submit"
                        disabled={probingServer}
                        className="h-10 px-4 inline-flex items-center justify-center gap-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                      >
                        {probingServer && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <span>{probingServer ? "Verifying Backend..." : "Connect & Verify Server"}</span>
                      </button>
                      <button
                        type="button"
                        disabled={probingServer}
                        onClick={() => handleConnectServer("http://localhost:3000")}
                        className="h-10 px-3.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                      >
                        Try localhost:3000
                      </button>
                      {getApiBaseUrl() && (
                        <button
                          type="button"
                          disabled={probingServer}
                          onClick={() => {
                            clearApiBaseUrl();
                            setServerInput("");
                            setProbeError("");
                            onServerChanged?.();
                          }}
                          className="h-10 px-3 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer whitespace-nowrap"
                        >
                          Reset Same-Origin
                        </button>
                      )}
                    </div>
                  </form>

                  <div className="border-t border-slate-100 pt-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-slate-700">Quick-start self-hosted server</span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText("npm install && npm start");
                          setCopiedCmd(true);
                          setTimeout(() => setCopiedCmd(false), 1600);
                        }}
                        className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-900 cursor-pointer"
                      >
                        {copiedCmd ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedCmd ? "Copied" : "Copy command"}</span>
                      </button>
                    </div>
                    <pre className="text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 overflow-x-auto">
                      npm install &amp;&amp; GEMINI_API_KEY=&quot;...&quot; npm start
                    </pre>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      Tip: Share links as <code className="font-mono text-slate-700">?api=https://your-server</code>, set GitHub Actions variable{" "}
                      <code className="font-mono text-slate-700">VITE_API_BASE_URL</code>, or deploy the included <code className="font-mono text-slate-700">Dockerfile</code> to Cloud Run.
                    </p>
                  </div>
                </div>

                {/* Live Public Gravatar Lookup (works directly in browser via Gravatar v3 CORS API) */}
                <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                      <Globe className="w-4 h-4 text-blue-600 shrink-0" />
                      <span>Test Public Gravatar Lookup</span>
                    </div>
                    <span className="text-[11px] text-slate-500">Live Gravatar API v3</span>
                  </div>
                  <form onSubmit={handleLookupPublicGravatar} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={gravQuery}
                      onChange={(e) => setGravQuery(e.target.value)}
                      placeholder="Gravatar username or email (e.g. beau)"
                      className="flex-1 min-w-0 h-9 px-3 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="submit"
                      disabled={gravLoading || !gravQuery.trim()}
                      className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {gravLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserCheck className="w-3.5 h-3.5" />}
                      <span>Inspect Profile</span>
                    </button>
                  </form>
                  {gravError && <p className="text-xs text-red-700">{gravError}</p>}
                  {gravPreview && (
                    <div className="flex items-start gap-3 pt-2 border-t border-slate-100">
                      {gravPreview.avatar_url && (
                        <img
                          src={gravPreview.avatar_url}
                          alt={gravPreview.display_name}
                          referrerPolicy="no-referrer"
                          className="w-11 h-11 rounded-full object-cover border border-slate-200 shrink-0"
                        />
                      )}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-slate-900 truncate">
                            {gravPreview.display_name}
                          </span>
                          <a
                            href={gravPreview.profile_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline shrink-0"
                          >
                            <span>Profile</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        {(gravPreview.job_title || gravPreview.company || gravPreview.location) && (
                          <div className="text-[11px] text-slate-500 truncate">
                            {[
                              [gravPreview.job_title, gravPreview.company].filter(Boolean).join(" @ "),
                              gravPreview.location,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        )}
                        {gravPreview.links.length > 0 && (
                          <div className="text-[11px] text-slate-600 truncate font-mono">
                            {gravPreview.links.map((l) => l.url.replace(/^https?:\/\//i, "")).join(" · ")}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
              <div className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    {mode === "signup"
                      ? !status.hasUsers
                        ? "Create Administrator Account"
                        : "Create Account"
                      : "Sign In"}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {mode === "signup"
                      ? !status.hasUsers
                        ? "First registered user becomes the site administrator."
                        : "Create an isolated AutoPost workspace."
                      : "Access your configured feeds and publishing pipelines."}
                  </p>
                </div>

                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setMode("login");
                      setErrorMsg("");
                    }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      mode === "login" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    disabled={signupDisabled}
                    onClick={() => {
                      setMode("signup");
                      setErrorMsg("");
                    }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                      mode === "signup" ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Sign Up
                  </button>
                </div>
              </div>

              {signupDisabled && (
                <div className="bg-slate-50 border border-slate-200 text-slate-600 px-3.5 py-2.5 rounded-lg text-xs">
                  New registrations are locked by the site administrator. Sign in with an existing account.
                </div>
              )}

              {errorMsg && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-800 px-3.5 py-2.5 rounded-lg text-xs">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === "signup" && (
                  <div>
                    <label htmlFor="auth-name" className="block text-xs font-medium text-slate-700 mb-1.5">
                      Full Name
                    </label>
                    <input
                      id="auth-name"
                      type="text"
                      required
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name"
                      className="w-full h-10 px-3.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}

                <div>
                  <label htmlFor="auth-email" className="block text-xs font-medium text-slate-700 mb-1.5">
                    Email Address
                  </label>
                  <input
                    id="auth-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@domain.com"
                    className="w-full h-10 px-3.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="auth-password" className="text-xs font-medium text-slate-700">
                      Password
                    </label>
                    {mode === "signup" && (
                      <span className="text-[11px] text-slate-400 font-mono tabular-nums">
                        {password.length}/8+ chars
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      id="auth-password"
                      type={showPassword ? "text" : "password"}
                      required
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={mode === "signup" ? "At least 8 characters" : "Enter your password"}
                      className="w-full h-10 pl-3.5 pr-10 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {mode === "signup" && (
                  <div>
                    <label htmlFor="auth-confirm" className="block text-xs font-medium text-slate-700 mb-1.5">
                      Confirm Password
                    </label>
                    <input
                      id="auth-confirm"
                      type={showPassword ? "text" : "password"}
                      required
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter password"
                      className="w-full h-10 px-3.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || (mode === "signup" && signupDisabled)}
                  className="w-full h-10 px-4 inline-flex items-center justify-center gap-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                >
                  {mode === "signup" ? <UserPlus className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                  <span>
                    {submitting
                      ? mode === "signup"
                        ? "Creating Account..."
                        : "Signing In..."
                      : mode === "signup"
                      ? !status.hasUsers
                        ? "Create Admin Account"
                        : "Create Account"
                      : "Sign In to AutoPost"}
                  </span>
                </button>
              </form>
            </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
