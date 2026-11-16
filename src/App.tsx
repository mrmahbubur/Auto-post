import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Globe,
  History,
  Layers,
  Loader2,
  LogOut,
  Menu,
  Play,
  Share2,
  Shield,
  Sliders,
  X,
} from "lucide-react";
import { api, clearApiBaseUrl, getApiBaseUrl, setApiBaseUrl, setUnauthorizedHandler } from "./api";
import { AccountView } from "./components/AccountView";
import { AuthScreen } from "./components/AuthScreen";
import { LedgerView } from "./components/LedgerView";
import { PipelineView } from "./components/PipelineView";
import { PlatformsView } from "./components/PlatformsView";
import { SettingsView } from "./components/SettingsView";
import { SitesView } from "./components/SitesView";
import type { Article, AuthStatus, AuthUser, BootstrapState } from "./types";

type NavId = "pipeline" | "sites" | "platforms" | "ledger" | "settings" | "account";

const NAV_ITEMS: Array<{ id: NavId; label: string; icon: typeof Layers }> = [
  { id: "pipeline", label: "Pipeline & Composer", icon: Layers },
  { id: "sites", label: "Sites & Feeds", icon: Globe },
  { id: "platforms", label: "Platforms & Keys", icon: Share2 },
  { id: "ledger", label: "Ledger & Reports", icon: History },
  { id: "settings", label: "Writer & Media", icon: Sliders },
  { id: "account", label: "Account & Security", icon: Shield },
];

export default function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeNav, setActiveNav] = useState<NavId>("pipeline");
  const [state, setState] = useState<BootstrapState | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [backendMissing, setBackendMissing] = useState(false);
  const [backendUrlInput, setBackendUrlInput] = useState(() => getApiBaseUrl());
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [quickRunning, setQuickRunning] = useState(false);
  const [preselectedArticle, setPreselectedArticle] = useState<{
    siteId: string;
    article: Article;
  } | null>(null);

  const checkAuthAndLoad = useCallback(async () => {
    setAuthLoading(true);
    setLoadError("");
    setBackendMissing(false);
    try {
      const status = await api.getAuthStatus();
      setAuthStatus(status);
      if (status.authenticated) {
        setLoading(true);
        const data = await api.bootstrap();
        setState(data);
      } else {
        setState(null);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to connect to AutoPost server";
      if (msg === "BACKEND_UNAVAILABLE") {
        setBackendMissing(true);
      } else {
        setLoadError(msg);
      }
    } finally {
      setAuthLoading(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setState(null);
      setAuthStatus((prev) =>
        prev
          ? { ...prev, authenticated: false, user: null }
          : { authenticated: false, user: null, hasUsers: true, allowSignups: true, activeSessionsCount: 0 }
      );
    });
    checkAuthAndLoad();
    return () => setUnauthorizedHandler(null);
  }, [checkAuthAndLoad]);

  async function handleAuthenticated(_user: AuthUser) {
    await checkAuthAndLoad();
  }

  async function handleSignOut() {
    await api.logout();
    setState(null);
    setActiveNav("pipeline");
    await checkAuthAndLoad();
  }

  async function handleQuickPreviewAll() {
    if (!state) return;
    setQuickRunning(true);
    try {
      const res = await api.triggerRun({ mode: "preview-all", ignoreLedger: true });
      setState(res.state);
      setActiveNav("pipeline");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Preview run failed");
    } finally {
      setQuickRunning(false);
    }
  }

  function handleOpenInComposer(siteId: string, article: Article) {
    setPreselectedArticle({ siteId, article });
    setActiveNav("pipeline");
  }

  if (authLoading && !authStatus) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl px-6 py-5 flex items-center gap-3 text-sm text-slate-600">
          <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
          <span>Verifying session...</span>
        </div>
      </div>
    );
  }

  if (backendMissing) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 max-w-lg w-full space-y-5">
          <div className="space-y-1.5">
            <h1 className="text-lg font-bold text-slate-900">Connect AutoPost Backend Server</h1>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              This static frontend is running without a local <code className="font-mono">/api</code> server (such as GitHub Pages). Enter the URL of your running AutoPost Node server (for example Cloud Run or <code className="font-mono">http://localhost:3000</code>), or open this page with <code className="font-mono">?api=https://your-server</code>.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setApiBaseUrl(backendUrlInput);
              checkAuthAndLoad();
            }}
            className="space-y-3"
          >
            <div>
              <label htmlFor="api-base-input" className="block text-xs font-medium text-slate-700 mb-1">
                Backend Server URL
              </label>
              <input
                id="api-base-input"
                type="url"
                required
                value={backendUrlInput}
                onChange={(e) => setBackendUrlInput(e.target.value)}
                placeholder="https://your-autopost-server.run.app"
                className="w-full h-10 px-3.5 text-sm bg-white border border-slate-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-2.5">
              <button
                type="submit"
                className="h-9 px-4 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
              >
                Connect Server
              </button>
              <button
                type="button"
                onClick={() => {
                  setApiBaseUrl("");
                  setBackendUrlInput("");
                  checkAuthAndLoad();
                }}
                className="h-9 px-3.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Retry Same-Origin
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  if (!authStatus?.authenticated) {
    if (loadError && !authStatus) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 max-w-lg w-full space-y-5">
            <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-800 px-3.5 py-2.5 rounded-lg text-xs">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" />
              <div className="space-y-1">
                <div className="font-medium">{loadError}</div>
                {getApiBaseUrl() && (
                  <div className="font-mono text-[11px] text-red-700 break-all">
                    Target: {getApiBaseUrl()}
                  </div>
                )}
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                setApiBaseUrl(backendUrlInput);
                checkAuthAndLoad();
              }}
              className="space-y-3"
            >
              <div>
                <label htmlFor="err-api-base-input" className="block text-xs font-medium text-slate-700 mb-1">
                  Backend Server URL
                </label>
                <input
                  id="err-api-base-input"
                  type="url"
                  value={backendUrlInput}
                  onChange={(e) => setBackendUrlInput(e.target.value)}
                  placeholder="https://your-autopost-server.run.app"
                  className="w-full h-10 px-3.5 text-sm bg-white border border-slate-300 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  className="h-9 px-4 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer"
                >
                  Connect Server
                </button>
                <button
                  type="button"
                  onClick={checkAuthAndLoad}
                  className="h-9 px-3.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearApiBaseUrl();
                    setBackendUrlInput("");
                    checkAuthAndLoad();
                  }}
                  className="h-9 px-3.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  Reset Same-Origin
                </button>
              </div>
            </form>
          </div>
        </div>
      );
    }
    return (
      <AuthScreen
        status={
          authStatus || {
            authenticated: false,
            user: null,
            hasUsers: false,
            allowSignups: true,
            activeSessionsCount: 0,
          }
        }
        onAuthenticated={handleAuthenticated}
        onServerChanged={checkAuthAndLoad}
      />
    );
  }

  const activeItem = NAV_ITEMS.find((n) => n.id === activeNav) || NAV_ITEMS[0];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-64 bg-white border-r border-slate-200 shrink-0">
        <div className="h-16 px-6 flex items-center border-b border-slate-200">
          <span className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
            AutoPost
          </span>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveNav(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? "text-blue-600" : "text-slate-400"}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3">
          {state?.user && (
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 truncate">{state.user.name}</div>
              <div className="text-[11px] text-slate-500 font-mono truncate">
                {state.user.email} · {state.user.role}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full h-9 px-3 inline-flex items-center justify-center gap-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-50 w-64 bg-white h-full flex flex-col border-r border-slate-200">
            <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200">
              <span className="text-lg font-bold tracking-tight text-slate-900">AutoPost</span>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 cursor-pointer"
                aria-label="Close navigation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 px-3 py-4 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveNav(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                      active
                        ? "bg-blue-50 text-blue-700"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-200 space-y-3">
              {state?.user && (
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 truncate">{state.user.name}</div>
                  <div className="text-[11px] text-slate-500 font-mono truncate">{state.user.email}</div>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleSignOut();
                }}
                className="w-full h-9 px-3 inline-flex items-center justify-center gap-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                <span>Sign Out</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-8 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 cursor-pointer"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm whitespace-nowrap truncate">
              <span className="text-slate-400 font-medium">AutoPost</span>
              <span className="text-slate-300">/</span>
              <h1 className="font-semibold text-slate-900 truncate">{activeItem.label}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={handleQuickPreviewAll}
              disabled={quickRunning || !state || state.sites.filter((s) => s.enabled).length === 0}
              title={
                state && state.sites.filter((s) => s.enabled).length === 0
                  ? "Add an enabled site in Sites & Feeds first"
                  : "Run a preview across all enabled platforms"
              }
              className="inline-flex items-center gap-2 h-9 px-4 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {quickRunning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              <span>{quickRunning ? "Running Preview..." : "Preview All Platforms"}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1280px] w-full mx-auto">
          {loading && !state ? (
            <div className="bg-white border border-slate-200 rounded-xl p-12 flex items-center justify-center gap-3 text-sm text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
              <span>Loading AutoPost SQLite state...</span>
            </div>
          ) : loadError && !state ? (
            <div className="bg-white border border-red-200 rounded-xl p-8 flex flex-col items-center text-center gap-3">
              <AlertCircle className="w-6 h-6 text-red-600" />
              <div className="text-sm font-medium text-slate-900">{loadError}</div>
              <button
                onClick={checkAuthAndLoad}
                className="h-9 px-4 text-xs font-medium text-white bg-slate-900 rounded-lg cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : state ? (
            <>
              {activeNav === "pipeline" && (
                <PipelineView
                  state={state}
                  onStateChange={setState}
                  preselectedArticle={preselectedArticle}
                  onClearPreselected={() => setPreselectedArticle(null)}
                />
              )}
              {activeNav === "sites" && (
                <SitesView
                  state={state}
                  onStateChange={setState}
                  onOpenInComposer={handleOpenInComposer}
                />
              )}
              {activeNav === "platforms" && (
                <PlatformsView state={state} onStateChange={setState} />
              )}
              {activeNav === "ledger" && (
                <LedgerView state={state} onStateChange={setState} />
              )}
              {activeNav === "settings" && (
                <SettingsView state={state} onStateChange={setState} />
              )}
              {activeNav === "account" && (
                <AccountView
                  state={state}
                  onStateChange={setState}
                  onSignedOut={handleSignOut}
                  onServerChanged={checkAuthAndLoad}
                />
              )}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
