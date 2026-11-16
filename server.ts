import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import {
  SESSION_TTL_SECONDS,
  type AuthenticatedRequest,
  checkAuthRateLimit,
  clearAuthRateLimit,
  clearSessionCookie,
  extractTokenFromRequest,
  generateSessionToken,
  getClientIp,
  hashPassword,
  hashSessionToken,
  isValidEmail,
  requireAuth,
  setSessionCookie,
  verifyPassword,
} from "./server/auth.ts";
import {
  clearAllLedger,
  clearLedgerKey,
  countActiveSessionsForUser,
  createSession,
  createUserAccount,
  deleteAllSessionsForUser,
  deleteSessionByHash,
  deleteSite,
  findUserByEmail,
  findUserById,
  getDb,
  getLedgerHistory,
  getRunById,
  getSecretStatus,
  getSetting,
  getUserBySessionHash,
  getUserCount,
  isSignupsAllowed,
  listPlatformStates,
  listRuns,
  listSites,
  setSecret,
  setSetting,
  setSignupsAllowed,
  toPublicUser,
  updatePlatformState,
  updateUserLoginTime,
  updateUserPasswordHash,
  upsertSite,
} from "./server/db.ts";
import { fetchGravatarProfile, gravatarToArticleAndSite } from "./server/gravatar.ts";
import { verifyMediaSignature } from "./server/mediaHost.ts";
import {
  exportConfigYaml,
  importConfigYaml,
  publishPreparedArticle,
  renderStandaloneReportHtml,
  runPipeline,
} from "./server/runner.ts";
import {
  executeAutoPostCycle,
  getUserGravatarConnection,
  getUserSchedule,
  saveUserSchedule,
  startDailyScheduler,
  syncGravatarForUser,
} from "./server/scheduler.ts";
import { discover, discoverUrl, enrichFromPage } from "./server/sources.ts";
import { buildThumbnail } from "./server/thumb.ts";
import type {
  AiSettings,
  Article,
  CopyDeck,
  MediaHostSettings,
  PublicUser,
  RunSettings,
  ScheduleSettings,
  SiteConfig,
  ThumbnailSettings,
} from "./server/types.ts";
import { IMAGES_DIR, ROOT } from "./server/util.ts";
import { hasGeminiKeyConfigured, writeCopy } from "./server/writer.ts";

const ALL_SECRET_KEYS = [
  "BSKY_HANDLE",
  "BSKY_APP_PASSWORD",
  "MASTODON_TOKEN",
  "TELEGRAM_BOT_TOKEN",
  "DISCORD_WEBHOOK_URL",
  "REDDIT_CLIENT_ID",
  "REDDIT_CLIENT_SECRET",
  "REDDIT_USERNAME",
  "REDDIT_PASSWORD",
  "REDDIT_USER_AGENT",
  "FB_PAGE_ID",
  "FB_PAGE_TOKEN",
  "LINKEDIN_TOKEN",
  "DEVTO_API_KEY",
  "X_API_KEY",
  "X_API_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_SECRET",
  "THREADS_TOKEN",
  "PINTEREST_TOKEN",
  "GITHUB_TOKEN",
];

function buildAdHocSite(rawUrl: string): SiteConfig {
  let hostname = "Website";
  let origin = rawUrl;
  try {
    const parsed = new URL(rawUrl);
    hostname = parsed.hostname.replace(/^www\./, "") || "Website";
    origin = parsed.origin;
  } catch {
    // keep raw string
  }
  return {
    id: hostname.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "direct-url",
    name: hostname,
    url: origin,
    feed: "",
    sitemap: "",
    brand_color: "#1a73e8",
    accent_color: "#ff6d00",
    hashtags: [],
    handles: {},
    enabled: true,
  };
}

function buildBootstrapPayload(user: PublicUser) {
  const userId = user.id;
  const sites = listSites(userId);
  const platforms = listPlatformStates(userId).map((p) => ({
    ...p.meta,
    enabled: p.enabled,
    config: p.config,
    ready: p.ready,
    missing_env: p.missing_env,
  }));

  const run = getSetting<RunSettings>(
    "run",
    {
      dry_run: true,
      max_per_site: 2,
      lookback_days: 30,
      timezone: "UTC",
    },
    userId
  );
  const ai = getSetting<AiSettings>(
    "ai",
    {
      enabled: true,
      model: "gemini-4-hydrogen",
      brand_voice: "",
    },
    userId
  );
  const thumbnail = getSetting<ThumbnailSettings>(
    "thumbnail",
    {
      width: 1200,
      height: 630,
      style: "gradient",
      use_og_image: true,
    },
    userId
  );
  const media_host = getSetting<MediaHostSettings>(
    "media_host",
    {
      provider: "app_url",
      repo: "",
      branch: "main",
      path_prefix: "autopost",
    },
    userId
  );
  const schedule = getUserSchedule(userId);
  const gravatar = getUserGravatarConnection(userId);

  return {
    user,
    security: {
      allowSignups: isSignupsAllowed(),
      activeSessionsCount: countActiveSessionsForUser(userId),
      totalUsers: user.role === "admin" ? getUserCount() : undefined,
    },
    sites,
    platforms,
    settings: { run, ai, thumbnail, media_host },
    schedule,
    gravatar,
    geminiReady: hasGeminiKeyConfigured(),
    secretStatus: getSecretStatus(ALL_SECRET_KEYS, userId),
    runs: listRuns(25, userId),
    ledger: getLedgerHistory(120, userId),
  };
}

async function startServer() {
  getDb();
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json({ limit: "4mb" }));

  // Baseline security headers + CORS support for Bearer-authenticated external frontends (avoid X-Frame-Options DENY for preview iframe)
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    if (req.path.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store");
      const origin = req.headers.origin;
      if (origin && /^https?:\/\//i.test(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      }
      if (req.method === "OPTIONS") {
        res.status(204).end();
        return;
      }
    }
    next();
  });

  // ---------- Public Authentication Endpoints ----------

  app.get("/api/auth/status", (req, res) => {
    const rawToken = extractTokenFromRequest(req);
    const user = rawToken ? getUserBySessionHash(hashSessionToken(rawToken)) : null;
    res.json({
      authenticated: Boolean(user),
      user,
      hasUsers: getUserCount() > 0,
      allowSignups: isSignupsAllowed(),
      activeSessionsCount: user ? countActiveSessionsForUser(user.id) : 0,
    });
  });

  app.post("/api/auth/signup", async (req, res) => {
    const ip = getClientIp(req);
    const rl = checkAuthRateLimit(`signup:${ip}`);
    if (!rl.allowed) {
      res.setHeader("Retry-After", String(rl.retryAfterSec));
      res.status(429).json({
        error: `Too many signup attempts. Please wait ${rl.retryAfterSec}s before trying again.`,
      });
      return;
    }

    try {
      const { name, email, password } = req.body as {
        name?: string;
        email?: string;
        password?: string;
      };
      const cleanName = (name || "").trim();
      const cleanEmail = (email || "").trim().toLowerCase();
      const rawPassword = typeof password === "string" ? password : "";

      if (cleanName.length < 2 || cleanName.length > 80) {
        res.status(400).json({ error: "Full name must be between 2 and 80 characters." });
        return;
      }
      if (!isValidEmail(cleanEmail)) {
        res.status(400).json({ error: "Enter a valid email address." });
        return;
      }
      if (rawPassword.length < 8 || rawPassword.length > 128) {
        res.status(400).json({ error: "Password must be at least 8 characters long." });
        return;
      }

      const passwordHash = hashPassword(rawPassword);
      const user = createUserAccount({
        email: cleanEmail,
        name: cleanName,
        passwordHash,
      });

      saveUserSchedule(user.id, {});
      // Best-effort quick Gravatar linked-site discovery from the signup email (never blocks signup > 2.5s)
      await Promise.race([
        syncGravatarForUser(user.id, cleanEmail, true).catch(() => null),
        new Promise((r) => setTimeout(r, 2500)),
      ]);

      const rawToken = generateSessionToken();
      createSession({
        tokenHash: hashSessionToken(rawToken),
        userId: user.id,
        userAgent: String(req.headers["user-agent"] || ""),
        ip,
        ttlSeconds: SESSION_TTL_SECONDS,
      });

      setSessionCookie(req, res, rawToken);
      res.status(201).json({
        token: rawToken,
        user,
        hasUsers: true,
        allowSignups: isSignupsAllowed(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Signup failed";
      if (msg === "REGISTRATION_LOCKED") {
        res.status(403).json({
          error: "New account signups are currently locked by the site administrator.",
        });
        return;
      }
      if (msg.includes("already exists")) {
        res.status(409).json({ error: msg });
        return;
      }
      res.status(400).json({ error: msg });
    }
  });

  app.post("/api/auth/login", (req, res) => {
    const ip = getClientIp(req);
    const { email, password } = req.body as { email?: string; password?: string };
    const cleanEmail = (email || "").trim().toLowerCase();
    const rawPassword = typeof password === "string" ? password : "";

    const rlIp = checkAuthRateLimit(`login-ip:${ip}`);
    const rlAcct = cleanEmail ? checkAuthRateLimit(`login-email:${cleanEmail}`) : { allowed: true, retryAfterSec: 0 };
    if (!rlIp.allowed || !rlAcct.allowed) {
      const wait = Math.max(rlIp.retryAfterSec, rlAcct.retryAfterSec);
      res.setHeader("Retry-After", String(wait));
      res.status(429).json({
        error: `Too many failed sign-in attempts. Please wait ${wait}s before trying again.`,
      });
      return;
    }

    if (!isValidEmail(cleanEmail) || !rawPassword) {
      res.status(400).json({ error: "Email and password are required." });
      return;
    }

    const userRow = findUserByEmail(cleanEmail);
    if (!userRow || !verifyPassword(rawPassword, userRow.password_hash)) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    clearAuthRateLimit(`login-email:${cleanEmail}`);
    updateUserLoginTime(userRow.id);
    const updatedUser = toPublicUser(findUserById(userRow.id) || userRow);

    const rawToken = generateSessionToken();
    createSession({
      tokenHash: hashSessionToken(rawToken),
      userId: updatedUser.id,
      userAgent: String(req.headers["user-agent"] || ""),
      ip,
      ttlSeconds: SESSION_TTL_SECONDS,
    });

    setSessionCookie(req, res, rawToken);
    res.json({
      token: rawToken,
      user: updatedUser,
      hasUsers: true,
      allowSignups: isSignupsAllowed(),
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    const rawToken = extractTokenFromRequest(req);
    if (rawToken) {
      deleteSessionByHash(hashSessionToken(rawToken));
    }
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  // ---------- Protected Auth & Security Management Routes ----------

  app.post("/api/auth/logout-all", requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    const includeCurrent = Boolean(req.body?.includeCurrent);
    const revoked = deleteAllSessionsForUser(userId, includeCurrent ? undefined : req.sessionTokenHash);
    if (includeCurrent) {
      clearSessionCookie(req, res);
    }
    res.json({
      revoked,
      activeSessionsCount: countActiveSessionsForUser(userId),
      signedOutCurrent: includeCurrent,
    });
  });

  app.post("/api/auth/change-password", requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    const { currentPassword, newPassword } = req.body as {
      currentPassword?: string;
      newPassword?: string;
    };

    if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
      res.status(400).json({ error: "Current password and new password are required." });
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      res.status(400).json({ error: "New password must be at least 8 characters long." });
      return;
    }

    const userRow = findUserById(userId);
    if (!userRow || !verifyPassword(currentPassword, userRow.password_hash)) {
      res.status(401).json({ error: "Current password is incorrect." });
      return;
    }

    updateUserPasswordHash(userId, hashPassword(newPassword));
    const revokedOthers = deleteAllSessionsForUser(userId, req.sessionTokenHash);
    res.json({
      ok: true,
      revokedOthers,
      activeSessionsCount: countActiveSessionsForUser(userId),
    });
  });

  app.put("/api/auth/security", requireAuth, (req: AuthenticatedRequest, res) => {
    if (req.user!.role !== "admin") {
      res.status(403).json({ error: "Only the site administrator can modify signup access." });
      return;
    }
    const { allowSignups } = req.body as { allowSignups?: unknown };
    if (typeof allowSignups !== "boolean") {
      res.status(400).json({ error: "allowSignups boolean is required." });
      return;
    }
    setSignupsAllowed(allowSignups);
    res.json({ state: buildBootstrapPayload(req.user!) });
  });

  // ---------- Protected Application API Routes ----------

  app.get("/api/bootstrap", requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      res.json(buildBootstrapPayload(req.user!));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load state" });
    }
  });

  app.post("/api/sites", requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const body = req.body as Partial<SiteConfig>;
      if (!body.name?.trim() || !body.url?.trim()) {
        res.status(400).json({ error: "Site name and URL are required." });
        return;
      }
      const saved = upsertSite(
        {
          id: body.id?.trim() || "",
          name: body.name.trim(),
          url: body.url.trim(),
          feed: (body.feed || "").trim(),
          sitemap: (body.sitemap || "").trim(),
          brand_color: (body.brand_color || "#1a73e8").trim(),
          accent_color: (body.accent_color || "#ff6d00").trim(),
          hashtags: Array.isArray(body.hashtags) ? body.hashtags : [],
          handles: body.handles || {},
          enabled: body.enabled ?? true,
          created_at: body.created_at,
        },
        userId
      );
      res.json({ site: saved, state: buildBootstrapPayload(req.user!) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to save site" });
    }
  });

  app.delete("/api/sites/:id", requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      deleteSite(req.params.id, req.user!.id);
      res.json({ state: buildBootstrapPayload(req.user!) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete site" });
    }
  });

  app.post("/api/sites/:id/discover", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const site = listSites(userId).find((s) => s.id === req.params.id);
      if (!site) {
        res.status(404).json({ error: "Site not found" });
        return;
      }
      const runSettings = getSetting<RunSettings>(
        "run",
        {
          dry_run: true,
          max_per_site: 5,
          lookback_days: 30,
          timezone: "UTC",
        },
        userId
      );
      const lookback = Number(req.body?.lookback_days ?? runSettings.lookback_days ?? 30);
      const limit = Number(req.body?.limit ?? 10);
      const articles = await discover(site, lookback, limit);
      res.json({ articles });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Feed discovery failed" });
    }
  });

  app.post("/api/discover-url", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const { url, siteId } = req.body as { url?: string; siteId?: string };
      if (!url?.trim()) {
        res.status(400).json({ error: "URL is required." });
        return;
      }
      const sites = listSites(userId);
      const site = sites.find((s) => s.id === siteId) || sites[0] || buildAdHocSite(url.trim());
      const article = await discoverUrl(url.trim(), site);
      res.json({ article });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "URL fetch failed" });
    }
  });

  app.post("/api/prepare", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const { siteId, article } = req.body as { siteId?: string; article?: Article };
      if (!article || !article.url) {
        res.status(400).json({ error: "Article with URL is required." });
        return;
      }
      const sites = listSites(userId);
      const site = sites.find((s) => s.id === siteId) || sites[0] || buildAdHocSite(article.url);
      const aiSettings = getSetting<AiSettings>(
        "ai",
        {
          enabled: true,
          model: "gemini-4-hydrogen",
          brand_voice: "",
        },
        userId
      );
      const thumbSettings = getSetting<ThumbnailSettings>(
        "thumbnail",
        {
          width: 1200,
          height: 630,
          style: "gradient",
          use_og_image: true,
        },
        userId
      );

      const enriched = await enrichFromPage(article);
      const { copy, writerUsed } = await writeCopy(enriched, aiSettings, site);
      const thumb = await buildThumbnail(enriched, copy, site, thumbSettings, { userId });

      res.json({
        article: enriched,
        copy,
        writerUsed,
        image_filename: thumb.filename,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to prepare article" });
    }
  });

  app.post("/api/gravatar/prepare", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const { identifier, siteId } = req.body as { identifier?: string; siteId?: string };
      if (!identifier?.trim()) {
        res.status(400).json({ error: "Enter a Gravatar username, profile URL, email, or hash." });
        return;
      }
      const profile = await fetchGravatarProfile(identifier.trim());
      const sites = listSites(userId);
      const baseSite = sites.find((s) => s.id === siteId) || sites[0];
      const { article, site } = gravatarToArticleAndSite(profile, baseSite);

      const aiSettings = getSetting<AiSettings>(
        "ai",
        {
          enabled: true,
          model: "gemini-4-hydrogen",
          brand_voice: "",
        },
        userId
      );
      const thumbSettings = getSetting<ThumbnailSettings>(
        "thumbnail",
        {
          width: 1200,
          height: 630,
          style: "gradient",
          use_og_image: true,
        },
        userId
      );

      const { copy, writerUsed } = await writeCopy(article, aiSettings, site);
      const thumb = await buildThumbnail(article, copy, site, thumbSettings, {
        avatarUrl: profile.avatar_url,
        userId,
      });

      res.json({
        profile,
        article,
        site,
        copy,
        writerUsed,
        image_filename: thumb.filename,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Failed to load Gravatar profile" });
    }
  });

  app.post("/api/gravatar/sync", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const { identifier, autoSync } = req.body as { identifier?: string; autoSync?: boolean };
      const synced = await syncGravatarForUser(userId, identifier, autoSync);
      res.json({
        profile: synced.profile,
        syncedSites: synced.syncedSites,
        connection: synced.connection,
        state: buildBootstrapPayload(req.user!),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Failed to sync Gravatar linked sites" });
    }
  });

  app.put("/api/schedule", requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const patch = req.body as Partial<ScheduleSettings>;
      saveUserSchedule(userId, patch);
      res.json({ state: buildBootstrapPayload(req.user!) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Failed to update daily schedule" });
    }
  });

  app.post("/api/schedule/run-now", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const result = await executeAutoPostCycle(userId, "manual");
      res.json({
        run: result.run,
        syncedSitesCount: result.syncedSitesCount,
        schedule: result.schedule,
        state: buildBootstrapPayload(req.user!),
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Automated cycle failed" });
    }
  });

  app.post("/api/thumbnail/rerender", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const { siteId, siteOverride, article, copy, avatarUrl } = req.body as {
        siteId?: string;
        siteOverride?: SiteConfig;
        article?: Article;
        copy?: CopyDeck;
        avatarUrl?: string;
      };
      const sites = listSites(userId);
      const site =
        siteOverride ||
        sites.find((s) => s.id === siteId) ||
        sites[0] ||
        (article?.url ? buildAdHocSite(article.url) : undefined);
      if (!site || !article || !copy) {
        res.status(400).json({ error: "Article and copy are required." });
        return;
      }
      const thumbSettings = getSetting<ThumbnailSettings>(
        "thumbnail",
        {
          width: 1200,
          height: 630,
          style: "gradient",
          use_og_image: true,
        },
        userId
      );
      const thumb = await buildThumbnail(article, copy, site, thumbSettings, {
        ...(avatarUrl ? { avatarUrl } : {}),
        userId,
      });
      res.json({ image_filename: thumb.filename });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to render thumbnail" });
    }
  });

  app.post("/api/publish-prepared", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const { siteId, siteOverride, article, copy, image_filename, platforms, mode, avatarUrl } = req.body as {
        siteId: string;
        siteOverride?: SiteConfig;
        article: Article;
        copy: CopyDeck;
        image_filename: string;
        platforms: string[];
        mode: "dry" | "live";
        avatarUrl?: string;
      };
      const sites = listSites(userId);
      const site =
        siteOverride ||
        sites.find((s) => s.id === siteId) ||
        sites[0] ||
        (article?.url ? buildAdHocSite(article.url) : undefined);
      if (!site || !article || !copy || !Array.isArray(platforms) || platforms.length === 0) {
        res.status(400).json({ error: "Article, copy deck, and at least one platform are required." });
        return;
      }
      const run = await publishPreparedArticle({
        userId,
        article,
        site,
        copy,
        imageFilename: image_filename || "",
        platformNames: platforms,
        mode: mode === "live" ? "live" : "dry",
        avatarUrl,
      });
      res.json({ run, state: buildBootstrapPayload(req.user!) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Publish failed" });
    }
  });

  app.post("/api/runs", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const { mode, siteId, platform, limit, ignoreLedger } = req.body as {
        mode?: "dry" | "preview-all" | "live";
        siteId?: string;
        platform?: string;
        limit?: number;
        ignoreLedger?: boolean;
      };
      const run = await runPipeline({
        userId,
        mode: mode || "dry",
        siteId: siteId || undefined,
        platform: platform || undefined,
        limit: limit ? Number(limit) : undefined,
        ignoreLedger: Boolean(ignoreLedger),
      });
      res.json({ run, state: buildBootstrapPayload(req.user!) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Pipeline run failed" });
    }
  });

  app.get("/api/runs/:id/report.html", requireAuth, (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    const run = getRunById(req.params.id, userId);
    if (!run) {
      res.status(404).send("Run not found");
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderStandaloneReportHtml(run, userId));
  });

  app.put("/api/platforms/:name", requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const { enabled, config, secrets } = req.body as {
        enabled?: boolean;
        config?: Record<string, unknown>;
        secrets?: Record<string, string>;
      };
      updatePlatformState(req.params.name, Boolean(enabled), config || {}, userId);
      if (secrets && typeof secrets === "object") {
        for (const [k, v] of Object.entries(secrets)) {
          if (ALL_SECRET_KEYS.includes(k) && typeof v === "string" && v.trim()) {
            setSecret(k, v, userId);
          }
        }
      }
      res.json({ state: buildBootstrapPayload(req.user!) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update platform" });
    }
  });

  app.delete("/api/secrets/:key", requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      if (ALL_SECRET_KEYS.includes(req.params.key)) {
        setSecret(req.params.key, "", userId);
      }
      res.json({ state: buildBootstrapPayload(req.user!) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to clear secret" });
    }
  });

  app.put("/api/settings", requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user!.id;
      const { run, ai, thumbnail, media_host, githubToken } = req.body as {
        run?: RunSettings;
        ai?: AiSettings;
        thumbnail?: ThumbnailSettings;
        media_host?: MediaHostSettings;
        githubToken?: string;
      };
      if (run) setSetting("run", run, userId);
      if (ai) setSetting("ai", ai, userId);
      if (thumbnail) setSetting("thumbnail", thumbnail, userId);
      if (media_host) setSetting("media_host", media_host, userId);
      if (typeof githubToken === "string" && githubToken.trim()) {
        setSecret("GITHUB_TOKEN", githubToken, userId);
      }
      res.json({ state: buildBootstrapPayload(req.user!) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to save settings" });
    }
  });

  app.delete("/api/ledger/:key", requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const platform = typeof req.query.platform === "string" ? req.query.platform : undefined;
      clearLedgerKey(req.params.key, platform, req.user!.id);
      res.json({ state: buildBootstrapPayload(req.user!) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to forget ledger item" });
    }
  });

  app.delete("/api/ledger", requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      clearAllLedger(req.user!.id);
      res.json({ state: buildBootstrapPayload(req.user!) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to clear ledger" });
    }
  });

  app.get("/api/config.yaml", requireAuth, (req: AuthenticatedRequest, res) => {
    res.setHeader("Content-Type", "text/yaml; charset=utf-8");
    res.send(exportConfigYaml(req.user!.id));
  });

  app.post("/api/config.yaml", requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const { yaml } = req.body as { yaml?: string };
      if (!yaml?.trim()) {
        res.status(400).json({ error: "YAML content is required." });
        return;
      }
      importConfigYaml(yaml, req.user!.id);
      res.json({ state: buildBootstrapPayload(req.user!) });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Failed to parse YAML" });
    }
  });

  // Authenticated user thumbnail fetch
  app.get("/api/images/:filename", requireAuth, (req: AuthenticatedRequest, res) => {
    const safeName = path.basename(req.params.filename);
    const fullPath = path.join(IMAGES_DIR, path.basename(req.user!.id), safeName);
    if (!fs.existsSync(fullPath)) {
      res.status(404).send("Not found");
      return;
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(fullPath);
  });

  // HMAC-SHA256 signed public PNG endpoint so Dev.to, Threads, and Pinterest can fetch generated thumbnails
  app.get("/api/media/:userId/:sig/:filename", (req, res) => {
    const uid = path.basename(req.params.userId || "");
    const safeName = path.basename(req.params.filename || "");
    const sig = String(req.params.sig || "");
    if (!verifyMediaSignature(uid, safeName, sig)) {
      res.status(403).send("Invalid media signature");
      return;
    }
    const fullPath = path.join(IMAGES_DIR, uid, safeName);
    if (!fs.existsSync(fullPath)) {
      res.status(404).send("Not found");
      return;
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.sendFile(fullPath);
  });

  // Catch-all 404 for unknown API paths instead of returning SPA HTML
  app.all("/api/*", (_req, res) => {
    res.status(404).json({ error: "API endpoint not found" });
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(ROOT, "dist");
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  app.listen(3000, "0.0.0.0", () => {
    console.log("AutoPost server running on http://0.0.0.0:3000");
    startDailyScheduler();
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
