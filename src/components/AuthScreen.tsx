import { useState } from "react";
import { AlertCircle, Eye, EyeOff, KeyRound, Lock, Server, ShieldCheck, UserPlus } from "lucide-react";
import { api, clearApiBaseUrl, getApiBaseUrl, setApiBaseUrl } from "../api";
import type { AuthStatus, AuthUser } from "../types";

interface AuthScreenProps {
  status: AuthStatus;
  onAuthenticated: (user: AuthUser) => void;
  onServerChanged?: () => void;
}

export function AuthScreen({ status, onAuthenticated, onServerChanged }: AuthScreenProps) {
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
            className="inline-flex items-center gap-1.5 h-8 px-2.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
          >
            <Server className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate max-w-[180px]">
              {getApiBaseUrl() ? getApiBaseUrl().replace(/^https?:\/\//i, "") : "API: Same-Origin"}
            </span>
          </button>
          <span className="hidden sm:inline text-xs font-medium text-slate-500">Protected Workspace</span>
        </div>
      </header>

      {showServerConfig && (
        <div className="bg-white border-b border-slate-200 px-6 lg:px-10 py-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setApiBaseUrl(serverInput);
              setShowServerConfig(false);
              onServerChanged?.();
            }}
            className="max-w-5xl mx-auto flex flex-wrap items-center gap-2.5"
          >
            <label htmlFor="auth-api-url" className="text-xs font-medium text-slate-700 whitespace-nowrap">
              Backend API URL
            </label>
            <input
              id="auth-api-url"
              type="url"
              value={serverInput}
              onChange={(e) => setServerInput(e.target.value)}
              placeholder="https://your-autopost-server.run.app (leave blank for same-origin)"
              className="flex-1 min-w-[240px] h-9 px-3 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="h-9 px-3.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => {
                clearApiBaseUrl();
                setServerInput("");
                setShowServerConfig(false);
                onServerChanged?.();
              }}
              className="h-9 px-3 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
            >
              Use Same-Origin
            </button>
          </form>
        </div>
      )}

      <main className="flex-1 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          {/* Left column: Clear product & security architecture */}
          <div className="lg:col-span-6 space-y-6">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 text-xs font-medium text-blue-700">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Session-Authenticated Syndication Console</span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-tight text-balance">
                Sign in to manage feeds, API credentials, and publishing runs.
              </h1>
              <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-lg">
                Every website feed, platform API token, Gemini caption deck, thumbnail render, and posting ledger is isolated per authenticated account on the server.
              </p>
            </div>

            <div className="border-t border-slate-200 pt-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Lock className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>Scrypt &amp; SHA-256 Sessions</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Passwords use per-user salted scrypt hashes. Active sessions store only hashed tokens with rate-limited login protection.
                </p>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <KeyRound className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>Private Credential Vault</span>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Platform API keys remain strictly server-side in SQLite and are scoped exclusively to your authenticated workspace.
                </p>
              </div>
            </div>
          </div>

          {/* Right column: Focused Login / Signup Card */}
          <div className="lg:col-span-6">
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
          </div>
        </div>
      </main>
    </div>
  );
}
