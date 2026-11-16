import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  AiSettings,
  GravatarConnection,
  LedgerEntry,
  MediaHostSettings,
  PublicUser,
  RunRecord,
  RunSettings,
  ScheduleSettings,
  SessionRecord,
  SiteConfig,
  ThumbnailSettings,
  UserRecord,
  UserRole,
} from "./types.ts";
import { DATA_DIR, IMAGES_DIR } from "./util.ts";

let dbInstance: Database.Database | null = null;

export interface PlatformMeta {
  name: string;
  label: string;
  copy_key: string;
  required_env: string[];
  supports_image: boolean;
  needs_public_url: boolean;
  char_limit: number;
  effort: string;
  safety: "safe" | "caution" | "manual";
  notes: string;
  default_config: Record<string, unknown>;
}

export const PLATFORM_CATALOG: PlatformMeta[] = [
  {
    name: "bluesky",
    label: "Bluesky",
    copy_key: "bsky",
    required_env: ["BSKY_HANDLE", "BSKY_APP_PASSWORD"],
    supports_image: true,
    needs_public_url: false,
    char_limit: 300,
    effort: "2 min · free · instant",
    safety: "safe",
    notes: "AT Protocol app password from Settings -> App Passwords. Supports native image upload and UTF-8 link/tag facets.",
    default_config: {},
  },
  {
    name: "mastodon",
    label: "Mastodon",
    copy_key: "mastodon",
    required_env: ["MASTODON_TOKEN"],
    supports_image: true,
    needs_public_url: false,
    char_limit: 500,
    effort: "3 min · free",
    safety: "safe",
    notes: "Token from Preferences -> Development with write scope. Configure your instance URL below.",
    default_config: { instance: "https://mastodon.social" },
  },
  {
    name: "telegram",
    label: "Telegram",
    copy_key: "telegram",
    required_env: ["TELEGRAM_BOT_TOKEN"],
    supports_image: true,
    needs_public_url: false,
    char_limit: 1024,
    effort: "5 min · free",
    safety: "safe",
    notes: "Create a bot via @BotFather and add it as an administrator on your target channel.",
    default_config: { chat_id: "@your_channel" },
  },
  {
    name: "discord",
    label: "Discord",
    copy_key: "discord",
    required_env: ["DISCORD_WEBHOOK_URL"],
    supports_image: true,
    needs_public_url: false,
    char_limit: 1900,
    effort: "2 min · free",
    safety: "safe",
    notes: "Channel -> Edit -> Integrations -> Webhook. Posts a rich colored embed with thumbnail.",
    default_config: {},
  },
  {
    name: "devto",
    label: "Dev.to",
    copy_key: "devto",
    required_env: ["DEVTO_API_KEY"],
    supports_image: true,
    needs_public_url: true,
    char_limit: 100000,
    effort: "2 min · free (needs image host)",
    safety: "safe",
    notes: "API key from dev.to/settings/extensions. Sets canonical_url to your original post.",
    default_config: {},
  },
  {
    name: "facebook_page",
    label: "Facebook Page",
    copy_key: "facebook_page",
    required_env: ["FB_PAGE_TOKEN"],
    supports_image: true,
    needs_public_url: false,
    char_limit: 5000,
    effort: "30-60 min · Meta App",
    safety: "caution",
    notes: "Page only (never personal profiles). Requires pages_manage_posts permission and page_id.",
    default_config: { page_id: "" },
  },
  {
    name: "linkedin",
    label: "LinkedIn",
    copy_key: "linkedin",
    required_env: ["LINKEDIN_TOKEN"],
    supports_image: true,
    needs_public_url: false,
    char_limit: 3000,
    effort: "30 min · free",
    safety: "caution",
    notes: "Requires w_member_social scope and your author_urn (urn:li:person:XXXX or urn:li:organization:XXXX).",
    default_config: { author_urn: "" },
  },
  {
    name: "threads",
    label: "Threads",
    copy_key: "threads",
    required_env: ["THREADS_TOKEN"],
    supports_image: true,
    needs_public_url: true,
    char_limit: 500,
    effort: "30-60 min · Meta App",
    safety: "caution",
    notes: "Uses the Threads container publish flow. Requires a public image URL via media_host.",
    default_config: { user_id: "" },
  },
  {
    name: "pinterest",
    label: "Pinterest",
    copy_key: "facebook_page",
    required_env: ["PINTEREST_TOKEN"],
    supports_image: true,
    needs_public_url: true,
    char_limit: 500,
    effort: "Days · Standard Access",
    safety: "caution",
    notes: "Requires pins:write scope, board_id, and a public image URL via media_host.",
    default_config: { board_id: "" },
  },
  {
    name: "reddit",
    label: "Reddit",
    copy_key: "reddit",
    required_env: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_USERNAME", "REDDIT_PASSWORD"],
    supports_image: false,
    needs_public_url: false,
    char_limit: 300,
    effort: "5 min · script app",
    safety: "manual",
    notes: "Subreddits enforce strict self-promotion rules (9:1 ratio). Prefer manual posting or owned communities.",
    default_config: { subreddits: ["test"], flair_id: "" },
  },
  {
    name: "x",
    label: "X (Twitter)",
    copy_key: "x",
    required_env: ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"],
    supports_image: true,
    needs_public_url: false,
    char_limit: 280,
    effort: "10 min · paid API tier",
    safety: "manual",
    notes: "OAuth 1.0a user context + v1.1 media upload + v2 tweets. Requires paid X API tier to write.",
    default_config: {},
  },
];

const DEFAULT_RUN_SETTINGS: RunSettings = {
  dry_run: true,
  max_per_site: 2,
  lookback_days: 30,
  timezone: "UTC",
};

const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: true,
  model: "gemini-3.1-flash-lite",
  brand_voice:
    "Direct, friendly, first-person-plural. Short sentences. No hype words, no emoji spam (max 2), no 'in today's fast-paced world', never start with 'I'm excited to announce'. Lead with the useful takeaway.",
};

const DEFAULT_THUMB_SETTINGS: ThumbnailSettings = {
  width: 1200,
  height: 630,
  style: "gradient",
  use_og_image: true,
};

const DEFAULT_MEDIA_HOST: MediaHostSettings = {
  provider: "app_url",
  repo: "",
  branch: "main",
  path_prefix: "autopost",
};

export const DEFAULT_SCHEDULE_SETTINGS: ScheduleSettings = {
  enabled: true,
  frequency: "daily",
  post_time: "09:00",
  timezone: "UTC",
  mode: "live",
  sync_gravatar: true,
  last_run_at: null,
  next_run_at: null,
  last_status: "idle",
  last_error: "",
  last_run_id: "",
};

function tableHasColumn(db: Database.Database, table: string, col: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.length === 0) return true; // table doesn't exist yet
  return rows.some((r) => r.name === col);
}

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  const dbPath = path.join(DATA_DIR, "autopost.sqlite");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Upgrade legacy single-tenant schema if needed (preserving clean multi-tenant keys)
  if (
    !tableHasColumn(db, "sites", "user_id") ||
    !tableHasColumn(db, "platforms", "user_id") ||
    !tableHasColumn(db, "secrets", "user_id") ||
    !tableHasColumn(db, "settings", "user_id") ||
    !tableHasColumn(db, "posted", "user_id") ||
    !tableHasColumn(db, "seen", "user_id") ||
    !tableHasColumn(db, "runs", "user_id")
  ) {
    db.exec(`
      DROP TABLE IF EXISTS sites;
      DROP TABLE IF EXISTS platforms;
      DROP TABLE IF EXISTS secrets;
      DROP TABLE IF EXISTS settings;
      DROP TABLE IF EXISTS posted;
      DROP TABLE IF EXISTS seen;
      DROP TABLE IF EXISTS runs;
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      password_hash TEXT NOT NULL,
      created_at REAL NOT NULL,
      last_login_at REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_agent TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      created_at REAL NOT NULL,
      expires_at REAL NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sites (
      user_id TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      feed TEXT NOT NULL DEFAULT '',
      sitemap TEXT NOT NULL DEFAULT '',
      brand_color TEXT NOT NULL DEFAULT '#1a73e8',
      accent_color TEXT NOT NULL DEFAULT '#ff6d00',
      hashtags TEXT NOT NULL DEFAULT '[]',
      handles TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at REAL NOT NULL,
      PRIMARY KEY (user_id, id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS platforms (
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      config TEXT NOT NULL DEFAULT '{}',
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, name),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS secrets (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at REAL NOT NULL,
      PRIMARY KEY (user_id, key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (user_id, key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS posted (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      platform TEXT NOT NULL,
      status TEXT NOT NULL,
      post_url TEXT,
      detail TEXT,
      ts REAL NOT NULL,
      PRIMARY KEY (user_id, key, platform),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS seen (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      title TEXT,
      url TEXT,
      site TEXT,
      ts REAL NOT NULL,
      PRIMARY KEY (user_id, key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS runs (
      user_id TEXT NOT NULL,
      id TEXT NOT NULL,
      mode TEXT NOT NULL,
      started TEXT NOT NULL,
      elapsed REAL NOT NULL,
      writer TEXT NOT NULL,
      counts TEXT NOT NULL,
      items TEXT NOT NULL,
      created_at REAL NOT NULL,
      PRIMARY KEY (user_id, id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  if (!tableHasColumn(db, "sites", "source")) {
    db.exec(`ALTER TABLE sites ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'`);
  }

  db.prepare(`INSERT OR IGNORE INTO app_meta (key, value) VALUES (?, ?)`).run("allow_signups", "true");

  dbInstance = db;
  return db;
}

export function getOrCreateAppSecret(metaKey: string): string {
  const db = getDb();
  const row = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(metaKey) as
    | { value: string }
    | undefined;
  if (row?.value) return row.value;
  const fresh = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)").run(metaKey, fresh);
  return fresh;
}

export function listAllUserIds(): string[] {
  const rows = getDb().prepare("SELECT id FROM users ORDER BY created_at ASC").all() as Array<{ id: string }>;
  return rows.map((r) => String(r.id));
}

export function seedUserDefaults(db: Database.Database, userId: string, email = ""): void {
  const upsertPlatform = db.prepare(
    `INSERT OR IGNORE INTO platforms (user_id, name, enabled, config, sort_order) VALUES (?, ?, ?, ?, ?)`
  );
  PLATFORM_CATALOG.forEach((p, idx) => {
    upsertPlatform.run(userId, p.name, p.name === "bluesky" ? 1 : 0, JSON.stringify(p.default_config), idx);
  });

  const initialSchedule: ScheduleSettings = {
    ...DEFAULT_SCHEDULE_SETTINGS,
    next_run_at: null,
  };
  const initialGravatar: GravatarConnection = {
    identifier: email || "",
    auto_sync: true,
    last_synced_at: null,
    synced_site_ids: [],
    profile: null,
  };

  const upsertSetting = db.prepare(`INSERT OR IGNORE INTO settings (user_id, key, value) VALUES (?, ?, ?)`);
  upsertSetting.run(userId, "run", JSON.stringify(DEFAULT_RUN_SETTINGS));
  upsertSetting.run(userId, "ai", JSON.stringify(DEFAULT_AI_SETTINGS));
  upsertSetting.run(userId, "thumbnail", JSON.stringify(DEFAULT_THUMB_SETTINGS));
  upsertSetting.run(userId, "media_host", JSON.stringify(DEFAULT_MEDIA_HOST));
  upsertSetting.run(userId, "schedule", JSON.stringify(initialSchedule));
  upsertSetting.run(userId, "gravatar", JSON.stringify(initialGravatar));
}

// ---------- Auth, Users & Security Settings ----------

export function getUserCount(): number {
  const row = getDb().prepare("SELECT COUNT(*) as c FROM users").get() as { c: number };
  return Number(row?.c || 0);
}

export function isSignupsAllowed(): boolean {
  const row = getDb().prepare("SELECT value FROM app_meta WHERE key = 'allow_signups'").get() as
    | { value: string }
    | undefined;
  if (!row) return true;
  return row.value === "true";
}

export function setSignupsAllowed(allowed: boolean): void {
  getDb()
    .prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('allow_signups', ?)")
    .run(allowed ? "true" : "false");
}

export function toPublicUser(u: UserRecord): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    created_at: u.created_at,
    last_login_at: u.last_login_at,
  };
}

export function findUserByEmail(email: string): UserRecord | null {
  const norm = email.trim().toLowerCase();
  const row = getDb().prepare("SELECT * FROM users WHERE email = ?").get(norm) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    role: (String(row.role) === "admin" ? "admin" : "member") as UserRole,
    password_hash: String(row.password_hash),
    created_at: Number(row.created_at),
    last_login_at: Number(row.last_login_at),
  };
}

export function findUserById(id: string): UserRecord | null {
  const row = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    role: (String(row.role) === "admin" ? "admin" : "member") as UserRole,
    password_hash: String(row.password_hash),
    created_at: Number(row.created_at),
    last_login_at: Number(row.last_login_at),
  };
}

export function createUserAccount(params: {
  email: string;
  name: string;
  passwordHash: string;
}): PublicUser {
  const db = getDb();
  const normEmail = params.email.trim().toLowerCase();
  const now = Date.now() / 1000;
  const id = crypto.randomBytes(12).toString("hex");

  const tx = db.transaction((): PublicUser => {
    const existing = db.prepare("SELECT 1 FROM users WHERE email = ?").get(normEmail);
    if (existing) {
      throw new Error("An account with this email already exists.");
    }
    const countRow = db.prepare("SELECT COUNT(*) as c FROM users").get() as { c: number };
    const isFirst = Number(countRow?.c || 0) === 0;
    if (!isFirst && !isSignupsAllowed()) {
      throw new Error("REGISTRATION_LOCKED");
    }
    const role: UserRole = isFirst ? "admin" : "member";
    db.prepare(
      `INSERT INTO users (id, email, name, role, password_hash, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, normEmail, params.name.trim(), role, params.passwordHash, now, now);

    seedUserDefaults(db, id, normEmail);
    return {
      id,
      email: normEmail,
      name: params.name.trim(),
      role,
      created_at: now,
      last_login_at: now,
    };
  });

  return tx();
}

export function updateUserLoginTime(userId: string): void {
  getDb().prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(Date.now() / 1000, userId);
}

export function updateUserPasswordHash(userId: string, newPasswordHash: string): void {
  getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newPasswordHash, userId);
}

export function pruneExpiredSessions(): void {
  getDb().prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now() / 1000);
}

export function createSession(params: {
  tokenHash: string;
  userId: string;
  userAgent: string;
  ip: string;
  ttlSeconds: number;
}): SessionRecord {
  const now = Date.now() / 1000;
  const expiresAt = now + params.ttlSeconds;
  pruneExpiredSessions();
  getDb()
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, user_agent, ip, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(params.tokenHash, params.userId, params.userAgent.slice(0, 240), params.ip.slice(0, 80), now, expiresAt);
  return {
    token_hash: params.tokenHash,
    user_id: params.userId,
    user_agent: params.userAgent,
    ip: params.ip,
    created_at: now,
    expires_at: expiresAt,
  };
}

export function getUserBySessionHash(tokenHash: string): PublicUser | null {
  const now = Date.now() / 1000;
  const row = getDb()
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token_hash = ? AND s.expires_at > ?`
    )
    .get(tokenHash, now) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    role: (String(row.role) === "admin" ? "admin" : "member") as UserRole,
    created_at: Number(row.created_at),
    last_login_at: Number(row.last_login_at),
  };
}

export function deleteSessionByHash(tokenHash: string): void {
  getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function deleteAllSessionsForUser(userId: string, exceptTokenHash?: string): number {
  if (exceptTokenHash) {
    const info = getDb()
      .prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?")
      .run(userId, exceptTokenHash);
    return info.changes;
  }
  const info = getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  return info.changes;
}

export function countActiveSessionsForUser(userId: string): number {
  const now = Date.now() / 1000;
  const row = getDb()
    .prepare("SELECT COUNT(*) as c FROM sessions WHERE user_id = ? AND expires_at > ?")
    .get(userId, now) as { c: number };
  return Number(row?.c || 0);
}

// ---------- User-Scoped Workspace Data ----------

export function listSites(userId: string): SiteConfig[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM sites WHERE user_id = ? ORDER BY created_at ASC")
    .all(userId) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    url: String(r.url),
    feed: String(r.feed || ""),
    sitemap: String(r.sitemap || ""),
    brand_color: String(r.brand_color || "#1a73e8"),
    accent_color: String(r.accent_color || "#ff6d00"),
    hashtags: safeJsonParse<string[]>(String(r.hashtags || "[]"), []),
    handles: safeJsonParse<Record<string, string>>(String(r.handles || "{}"), {}),
    enabled: Boolean(r.enabled),
    source: (String(r.source || "manual") === "gravatar" ? "gravatar" : "manual") as SiteConfig["source"],
    created_at: Number(r.created_at || 0),
  }));
}

export function upsertSite(site: SiteConfig, userId: string): SiteConfig {
  const db = getDb();
  const id =
    site.id ||
    site.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") ||
    `site-${Date.now()}`;
  const now = site.created_at || Date.now() / 1000;
  const source: SiteConfig["source"] = site.source === "gravatar" ? "gravatar" : "manual";
  db.prepare(
    `INSERT OR REPLACE INTO sites (user_id, id, name, url, feed, sitemap, brand_color, accent_color, hashtags, handles, enabled, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    id,
    site.name,
    site.url,
    site.feed || "",
    site.sitemap || "",
    site.brand_color || "#1a73e8",
    site.accent_color || "#ff6d00",
    JSON.stringify(site.hashtags || []),
    JSON.stringify(site.handles || {}),
    site.enabled ? 1 : 0,
    source,
    now
  );
  return { ...site, id, source, created_at: now };
}

export function deleteSite(id: string, userId: string): void {
  getDb().prepare("DELETE FROM sites WHERE user_id = ? AND id = ?").run(userId, id);
}

export function getSetting<T>(key: string, fallback: T, userId: string): T {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE user_id = ? AND key = ?")
    .get(userId, key) as { value: string } | undefined;
  if (!row) return fallback;
  return safeJsonParse<T>(row.value, fallback);
}

export function setSetting<T>(key: string, value: T, userId: string): T {
  getDb()
    .prepare("INSERT OR REPLACE INTO settings (user_id, key, value) VALUES (?, ?, ?)")
    .run(userId, key, JSON.stringify(value));
  return value;
}

export function getSecret(key: string, userId?: string): string {
  if (userId) {
    const row = getDb()
      .prepare("SELECT value FROM secrets WHERE user_id = ? AND key = ?")
      .get(userId, key) as { value: string } | undefined;
    if (row && row.value.trim()) return row.value.trim();
  }
  return (process.env[key] || "").trim();
}

export function setSecret(key: string, value: string, userId: string): void {
  const trimmed = value.trim();
  if (!trimmed) {
    getDb().prepare("DELETE FROM secrets WHERE user_id = ? AND key = ?").run(userId, key);
  } else {
    getDb()
      .prepare("INSERT OR REPLACE INTO secrets (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)")
      .run(userId, key, trimmed, Date.now() / 1000);
  }
}

export function getSecretStatus(keys: string[], userId: string): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const k of keys) {
    out[k] = Boolean(getSecret(k, userId));
  }
  return out;
}

export function listPlatformStates(userId: string): Array<{
  meta: PlatformMeta;
  enabled: boolean;
  config: Record<string, unknown>;
  ready: boolean;
  missing_env: string[];
}> {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM platforms WHERE user_id = ? ORDER BY sort_order ASC")
    .all(userId) as Array<{
    name: string;
    enabled: number;
    config: string;
  }>;
  const rowMap = new Map(rows.map((r) => [r.name, r]));

  return PLATFORM_CATALOG.map((meta) => {
    const row = rowMap.get(meta.name);
    const enabled = row ? Boolean(row.enabled) : false;
    const config = row ? safeJsonParse<Record<string, unknown>>(row.config, meta.default_config) : meta.default_config;
    const missing_env = meta.required_env.filter((k) => !getSecret(k, userId));
    return {
      meta,
      enabled,
      config,
      ready: missing_env.length === 0,
      missing_env,
    };
  });
}

export function updatePlatformState(
  name: string,
  enabled: boolean,
  config: Record<string, unknown>,
  userId: string
): void {
  const db = getDb();
  const idx = PLATFORM_CATALOG.findIndex((p) => p.name === name);
  db.prepare(
    `INSERT INTO platforms (user_id, name, enabled, config, sort_order) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, name) DO UPDATE SET enabled = excluded.enabled, config = excluded.config`
  ).run(userId, name, enabled ? 1 : 0, JSON.stringify(config || {}), idx >= 0 ? idx : 99);
}

export function wasPosted(key: string, platform: string, includeDry = true, userId = ""): boolean {
  const q = includeDry
    ? "SELECT 1 FROM posted WHERE user_id = ? AND key = ? AND platform = ?"
    : "SELECT 1 FROM posted WHERE user_id = ? AND key = ? AND platform = ? AND status = 'ok'";
  return Boolean(getDb().prepare(q).get(userId, key, platform));
}

export function recordPost(
  key: string,
  platform: string,
  status: "ok" | "dry" | "error",
  postUrl = "",
  detail = "",
  userId = ""
): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO posted (user_id, key, platform, status, post_url, detail, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(userId, key, platform, status, postUrl, detail.slice(0, 900), Date.now() / 1000);
}

export function clearLedgerKey(key: string, platform: string | undefined, userId: string): void {
  if (platform) {
    getDb().prepare("DELETE FROM posted WHERE user_id = ? AND key = ? AND platform = ?").run(userId, key, platform);
  } else {
    getDb().prepare("DELETE FROM posted WHERE user_id = ? AND key = ?").run(userId, key);
  }
}

export function clearAllLedger(userId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM posted WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM seen WHERE user_id = ?").run(userId);
}

export function markSeen(key: string, title: string, url: string, site: string, userId: string): void {
  getDb()
    .prepare(`INSERT OR REPLACE INTO seen (user_id, key, title, url, site, ts) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(userId, key, title, url, site, Date.now() / 1000);
}

export function getLedgerHistory(limit = 100, userId = ""): LedgerEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT p.ts, p.key, p.platform, p.status, p.post_url, p.detail, s.title, s.url as article_url, s.site
       FROM posted p
       LEFT JOIN seen s ON p.key = s.key AND p.user_id = s.user_id
       WHERE p.user_id = ?
       ORDER BY p.ts DESC
       LIMIT ?`
    )
    .all(userId, limit) as LedgerEntry[];
  return rows;
}

export function saveRun(run: RunRecord, userId: string): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO runs (user_id, id, mode, started, elapsed, writer, counts, items, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      run.id,
      run.mode,
      run.started,
      run.elapsed,
      run.writer,
      JSON.stringify(run.counts),
      JSON.stringify(run.items),
      run.created_at
    );
}

export function listRuns(limit = 20, userId = ""): RunRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(userId, limit) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    mode: String(r.mode) as RunRecord["mode"],
    started: String(r.started),
    elapsed: Number(r.elapsed),
    writer: String(r.writer) as RunRecord["writer"],
    counts: safeJsonParse(String(r.counts), { ok: 0, dry: 0, error: 0 }),
    items: safeJsonParse(String(r.items), []),
    created_at: Number(r.created_at),
  }));
}

export function getRunById(id: string, userId: string): RunRecord | null {
  const r = getDb()
    .prepare("SELECT * FROM runs WHERE user_id = ? AND id = ?")
    .get(userId, id) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: String(r.id),
    mode: String(r.mode) as RunRecord["mode"],
    started: String(r.started),
    elapsed: Number(r.elapsed),
    writer: String(r.writer) as RunRecord["writer"],
    counts: safeJsonParse(String(r.counts), { ok: 0, dry: 0, error: 0 }),
    items: safeJsonParse(String(r.items), []),
    created_at: Number(r.created_at),
  };
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
