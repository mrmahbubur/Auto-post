import type {
  AiSettings,
  Article,
  AuthStatus,
  AuthUser,
  BootstrapState,
  CopyDeck,
  GravatarConnection,
  GravatarProfile,
  MediaHostSettings,
  RunRecord,
  RunSettings,
  ScheduleSettings,
  SiteConfig,
  ThumbnailSettings,
} from "./types";

const TOKEN_STORAGE_KEY = "autopost_session_token";
const API_BASE_STORAGE_KEY = "autopost_api_base";

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

function normalizeApiBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.origin}${pathname === "/" ? "" : pathname}`;
  } catch {
    return "";
  }
}

function stripApiSearchParamsFromUrl(): void {
  try {
    if (typeof window === "undefined" || !window.history?.replaceState || !window.location?.search) {
      return;
    }
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of ["api", "backend", "apiBase"]) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (changed) {
      window.history.replaceState({}, "", url.pathname + (url.search ? url.search : "") + url.hash);
    }
  } catch {
    // Ignore history replace failures
  }
}

function initApiBaseFromSearchParams(): void {
  try {
    if (typeof window === "undefined" || !window.location?.search) return;
    const params = new URLSearchParams(window.location.search);
    const paramKey = ["api", "backend", "apiBase"].find((k) => params.has(k));
    if (!paramKey) return;

    const raw = (params.get(paramKey) || "").trim();
    if (!raw || raw === "reset" || raw === "local" || raw === "same-origin") {
      localStorage.removeItem(API_BASE_STORAGE_KEY);
      stripApiSearchParamsFromUrl();
      return;
    }

    const normalized = normalizeApiBaseUrl(raw);
    if (normalized) {
      localStorage.setItem(API_BASE_STORAGE_KEY, normalized);
      stripApiSearchParamsFromUrl();
    }
  } catch {
    // Ignore search/storage access errors
  }
}

initApiBaseFromSearchParams();

export function getApiBaseUrl(): string {
  try {
    const saved = localStorage.getItem(API_BASE_STORAGE_KEY);
    const normalized = saved ? normalizeApiBaseUrl(saved) : "";
    if (normalized) return normalized;
  } catch {
    // Ignore storage access errors
  }
  const envBase = (import.meta.env?.VITE_API_BASE_URL as string | undefined) || "";
  return envBase ? normalizeApiBaseUrl(envBase) : "";
}

export function setApiBaseUrl(url: string): void {
  try {
    const normalized = normalizeApiBaseUrl(url);
    if (normalized) {
      localStorage.setItem(API_BASE_STORAGE_KEY, normalized);
    } else {
      localStorage.removeItem(API_BASE_STORAGE_KEY);
    }
    stripApiSearchParamsFromUrl();
  } catch {
    // Ignore storage access errors
  }
}

export function clearApiBaseUrl(): void {
  setApiBaseUrl("");
}

export function apiUrl(path: string): string {
  const base = getApiBaseUrl();
  return base ? `${base}${path}` : path;
}

export function getStoredToken(): string {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function setStoredToken(token: string): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota errors
  }
}

function buildAuthHeaders(extra?: HeadersInit): Record<string, string> {
  const headers: Record<string, string> = {};
  if (extra && typeof extra === "object" && !Array.isArray(extra)) {
    Object.assign(headers, extra);
  }
  const token = getStoredToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

async function request<T>(url: string, init?: RequestInit, skipAuthRedirect = false): Promise<T> {
  const target = apiUrl(url);
  const res = await fetch(target, {
    credentials: getApiBaseUrl() ? "omit" : "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(init?.headers),
    },
  });
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    if (res.status === 404 || res.status === 405 || contentType.includes("text/html")) {
      throw new Error("BACKEND_UNAVAILABLE");
    }
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !skipAuthRedirect) {
    setStoredToken("");
    unauthorizedHandler?.();
  }
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  getAuthStatus: () => request<AuthStatus>("/api/auth/status", undefined, true),

  signup: async (payload: { name: string; email: string; password: string }) => {
    const res = await request<{ token: string; user: AuthUser; hasUsers: boolean; allowSignups: boolean }>(
      "/api/auth/signup",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      true
    );
    setStoredToken(res.token);
    return res;
  },

  login: async (payload: { email: string; password: string }) => {
    const res = await request<{ token: string; user: AuthUser; hasUsers: boolean; allowSignups: boolean }>(
      "/api/auth/login",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
      true
    );
    setStoredToken(res.token);
    return res;
  },

  logout: async () => {
    try {
      await request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }, true);
    } finally {
      setStoredToken("");
    }
  },

  logoutAll: (includeCurrent = false) =>
    request<{ revoked: number; activeSessionsCount: number; signedOutCurrent: boolean }>(
      "/api/auth/logout-all",
      {
        method: "POST",
        body: JSON.stringify({ includeCurrent }),
      }
    ),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean; revokedOthers: number; activeSessionsCount: number }>(
      "/api/auth/change-password",
      {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      },
      true
    ),

  updateSecuritySettings: (allowSignups: boolean) =>
    request<{ state: BootstrapState }>("/api/auth/security", {
      method: "PUT",
      body: JSON.stringify({ allowSignups }),
    }),

  bootstrap: () => request<BootstrapState>("/api/bootstrap"),

  saveSite: (site: Partial<SiteConfig>) =>
    request<{ site: SiteConfig; state: BootstrapState }>("/api/sites", {
      method: "POST",
      body: JSON.stringify(site),
    }),

  deleteSite: (id: string) =>
    request<{ state: BootstrapState }>(`/api/sites/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  discoverSite: (id: string, lookbackDays?: number, limit?: number) =>
    request<{ articles: Article[] }>(`/api/sites/${encodeURIComponent(id)}/discover`, {
      method: "POST",
      body: JSON.stringify({ lookback_days: lookbackDays, limit }),
    }),

  discoverUrl: (url: string, siteId?: string) =>
    request<{ article: Article }>("/api/discover-url", {
      method: "POST",
      body: JSON.stringify({ url, siteId }),
    }),

  prepareArticle: (siteId: string, article: Article) =>
    request<{ article: Article; copy: CopyDeck; writerUsed: "gemini" | "template"; image_filename: string }>(
      "/api/prepare",
      {
        method: "POST",
        body: JSON.stringify({ siteId, article }),
      }
    ),

  prepareGravatar: (identifier: string, siteId?: string) =>
    request<{
      profile: GravatarProfile;
      article: Article;
      site: SiteConfig;
      copy: CopyDeck;
      writerUsed: "gemini" | "template";
      image_filename: string;
    }>("/api/gravatar/prepare", {
      method: "POST",
      body: JSON.stringify({ identifier, siteId }),
    }),

  syncGravatar: (identifier?: string, autoSync?: boolean) =>
    request<{
      profile: GravatarProfile;
      syncedSites: Array<{ site: SiteConfig; discovery: "rss" | "sitemap" | "page" }>;
      connection: GravatarConnection;
      state: BootstrapState;
    }>("/api/gravatar/sync", {
      method: "POST",
      body: JSON.stringify({ identifier, autoSync }),
    }),

  updateSchedule: (patch: Partial<ScheduleSettings>) =>
    request<{ state: BootstrapState }>("/api/schedule", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),

  runScheduleNow: () =>
    request<{
      run: RunRecord | null;
      syncedSitesCount: number;
      schedule: ScheduleSettings;
      state: BootstrapState;
    }>("/api/schedule/run-now", {
      method: "POST",
    }),

  rerenderThumbnail: (
    siteId: string,
    article: Article,
    copy: CopyDeck,
    options?: { siteOverride?: SiteConfig; avatarUrl?: string }
  ) =>
    request<{ image_filename: string }>("/api/thumbnail/rerender", {
      method: "POST",
      body: JSON.stringify({ siteId, article, copy, ...options }),
    }),

  publishPrepared: (payload: {
    siteId: string;
    siteOverride?: SiteConfig;
    article: Article;
    copy: CopyDeck;
    image_filename: string;
    platforms: string[];
    mode: "dry" | "live";
    avatarUrl?: string;
  }) =>
    request<{ run: RunRecord; state: BootstrapState }>("/api/publish-prepared", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  triggerRun: (payload: {
    mode: "dry" | "preview-all" | "live";
    siteId?: string;
    platform?: string;
    limit?: number;
    ignoreLedger?: boolean;
  }) =>
    request<{ run: RunRecord; state: BootstrapState }>("/api/runs", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updatePlatform: (
    name: string,
    payload: { enabled: boolean; config: Record<string, unknown>; secrets?: Record<string, string> }
  ) =>
    request<{ state: BootstrapState }>(`/api/platforms/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  clearSecret: (key: string) =>
    request<{ state: BootstrapState }>(`/api/secrets/${encodeURIComponent(key)}`, {
      method: "DELETE",
    }),

  updateSettings: (payload: {
    run?: RunSettings;
    ai?: AiSettings;
    thumbnail?: ThumbnailSettings;
    media_host?: MediaHostSettings;
    githubToken?: string;
  }) =>
    request<{ state: BootstrapState }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  forgetKey: (key: string, platform?: string) => {
    const q = platform ? `?platform=${encodeURIComponent(platform)}` : "";
    return request<{ state: BootstrapState }>(`/api/ledger/${encodeURIComponent(key)}${q}`, {
      method: "DELETE",
    });
  },

  forgetAll: () =>
    request<{ state: BootstrapState }>("/api/ledger", {
      method: "DELETE",
    }),

  exportYaml: async () => {
    const res = await fetch(apiUrl("/api/config.yaml"), {
      credentials: getApiBaseUrl() ? "omit" : "include",
      headers: buildAuthHeaders(),
    });
    if (res.status === 401) {
      setStoredToken("");
      unauthorizedHandler?.();
      throw new Error("Session expired.");
    }
    if (!res.ok) throw new Error("Failed to export config.yaml");
    return res.text();
  },

  importYaml: (yaml: string) =>
    request<{ state: BootstrapState }>("/api/config.yaml", {
      method: "POST",
      body: JSON.stringify({ yaml }),
    }),

  fetchImageBlob: async (filename: string): Promise<Blob> => {
    const res = await fetch(apiUrl(`/api/images/${encodeURIComponent(filename)}`), {
      credentials: getApiBaseUrl() ? "omit" : "include",
      headers: buildAuthHeaders(),
    });
    if (res.status === 401) {
      setStoredToken("");
      unauthorizedHandler?.();
    }
    if (!res.ok) {
      throw new Error("Failed to load image");
    }
    return res.blob();
  },

  fetchReportHtml: async (runId: string): Promise<string> => {
    const res = await fetch(apiUrl(`/api/runs/${encodeURIComponent(runId)}/report.html`), {
      credentials: getApiBaseUrl() ? "omit" : "include",
      headers: buildAuthHeaders(),
    });
    if (res.status === 401) {
      setStoredToken("");
      unauthorizedHandler?.();
    }
    if (!res.ok) {
      throw new Error("Failed to load run report");
    }
    return res.text();
  },
};
