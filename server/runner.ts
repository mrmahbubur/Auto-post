import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  getSetting,
  listPlatformStates,
  listSites,
  markSeen,
  recordPost,
  saveRun,
  setSetting,
  updatePlatformState,
  upsertSite,
  wasPosted,
} from "./db.ts";
import { uploadPublicMedia } from "./mediaHost.ts";
import { publishToPlatform, textForPlatform } from "./publishers.ts";
import { discover, enrichFromPage } from "./sources.ts";
import { buildThumbnail } from "./thumb.ts";
import type {
  AiSettings,
  Article,
  CopyDeck,
  GravatarConnection,
  MediaHostSettings,
  PlatformPostResult,
  RunItemResult,
  RunRecord,
  RunSettings,
  SiteConfig,
  ThumbnailSettings,
} from "./types.ts";
import { IMAGES_DIR, escapeHtml } from "./util.ts";
import { hasGeminiKeyConfigured, writeCopy } from "./writer.ts";

export interface RunOptions {
  userId: string;
  mode: "dry" | "preview-all" | "live";
  siteId?: string;
  platform?: string;
  limit?: number;
  ignoreLedger?: boolean;
}

export async function runPipeline(options: RunOptions): Promise<RunRecord> {
  const { userId } = options;
  const t0 = Date.now();
  const started = new Date().toISOString().replace("T", " ").slice(0, 19);

  const runSettings = getSetting<RunSettings>(
    "run",
    {
      dry_run: true,
      max_per_site: 2,
      lookback_days: 30,
      timezone: "UTC",
    },
    userId
  );
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
  const mediaSettings = getSetting<MediaHostSettings>(
    "media_host",
    {
      provider: "app_url",
      repo: "",
      branch: "main",
      path_prefix: "autopost",
    },
    userId
  );
  const gravatarConn = getSetting<GravatarConnection | null>("gravatar", null, userId);

  const forceAll = options.mode === "preview-all";
  const isLive = options.mode === "live";

  let sites = listSites(userId).filter((s) => s.enabled);
  if (options.siteId) {
    sites = sites.filter((s) => s.id === options.siteId);
  }
  if (sites.length === 0) {
    throw new Error("No enabled sites configured.");
  }

  let activePlats = listPlatformStates(userId).filter((p) => p.enabled && (forceAll || p.ready));
  if (options.platform) {
    activePlats = activePlats.filter((p) => p.meta.name === options.platform);
  }
  if (activePlats.length === 0) {
    throw new Error(
      isLive
        ? "No enabled platform has its required credentials configured. Use Dry / Preview All or configure platform keys first."
        : "No platforms are enabled. Enable at least one platform under Platforms & Keys."
    );
  }

  let usedGemini = false;
  const counts = { ok: 0, dry: 0, error: 0 };
  const items: RunItemResult[] = [];
  const limit = options.limit ?? runSettings.max_per_site ?? 1;
  const lookback = runSettings.lookback_days ?? 30;

  for (const site of sites) {
    let articles: Article[] = [];
    try {
      articles = await discover(site, lookback, limit);
    } catch (err) {
      console.error(`Site discover error (${site.name}):`, err);
      continue;
    }

    for (let art of articles) {
      if (!options.ignoreLedger && activePlats.every((p) => wasPosted(art.key, p.meta.name, !isLive, userId))) {
        continue;
      }

      art = await enrichFromPage(art);
      const { copy, writerUsed } = await writeCopy(art, aiSettings, site);
      if (writerUsed === "gemini") usedGemini = true;

      const useGravatarAvatar =
        site.source === "gravatar" && !art.image && gravatarConn?.profile?.avatar_url
          ? gravatarConn.profile.avatar_url
          : undefined;
      const thumb = await buildThumbnail(art, copy, site, thumbSettings, {
        userId,
        ...(useGravatarAvatar ? { avatarUrl: useGravatarAvatar } : {}),
      });
      const needsUrl = activePlats.some((p) => p.meta.needs_public_url);
      let imageUrl = "";
      if (
        mediaSettings.provider === "app_url" ||
        (isLive && mediaSettings.provider === "github_raw" && (needsUrl || mediaSettings.provider === "github_raw"))
      ) {
        try {
          imageUrl = await uploadPublicMedia(thumb.fullPath, mediaSettings, userId);
        } catch (err) {
          console.error("mediaHost error:", err);
        }
      }

      const results: PlatformPostResult[] = [];
      for (const plat of activePlats) {
        const meta = plat.meta;
        if (!options.ignoreLedger && wasPosted(art.key, meta.name, !isLive, userId)) {
          continue;
        }
        const text = textForPlatform(meta.copy_key, copy, art);

        if (!isLive) {
          recordPost(art.key, meta.name, "dry", "", "preview only", userId);
          counts.dry += 1;
          results.push({
            platform: meta.name,
            label: meta.label,
            status: "dry",
            text,
            url: "",
            detail: plat.ready ? "" : `Missing keys: ${plat.missing_env.join(", ")}`,
          });
          continue;
        }

        try {
          const postRes = await publishToPlatform(
            meta.name,
            text,
            meta.supports_image ? thumb.fullPath : null,
            imageUrl,
            art,
            site,
            plat.config,
            copy,
            userId
          );
          recordPost(art.key, meta.name, "ok", postRes.url, "", userId);
          counts.ok += 1;
          results.push({
            platform: meta.name,
            label: meta.label,
            status: "ok",
            text,
            url: postRes.url,
            detail: "",
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          recordPost(art.key, meta.name, "error", "", msg, userId);
          counts.error += 1;
          results.push({
            platform: meta.name,
            label: meta.label,
            status: "error",
            text,
            url: "",
            detail: msg,
          });
        }
      }

      markSeen(art.key, art.title, art.url, site.name, userId);

      items.push({
        site: site.name,
        siteId: site.id,
        title: art.title,
        url: art.url,
        key: art.key,
        image_filename: thumb.filename,
        image_url: imageUrl,
        copy,
        results,
      });
    }
  }

  const runRecord: RunRecord = {
    id: crypto.randomUUID().slice(0, 12),
    mode: options.mode === "live" ? "LIVE" : options.mode === "preview-all" ? "PREVIEW ALL" : "DRY RUN",
    started,
    elapsed: Number(((Date.now() - t0) / 1000).toFixed(1)),
    writer: usedGemini || (aiSettings.enabled && hasGeminiKeyConfigured()) ? "gemini" : "template",
    counts,
    items,
    created_at: Date.now() / 1000,
  };

  saveRun(runRecord, userId);
  return runRecord;
}

export async function publishPreparedArticle(params: {
  userId: string;
  article: Article;
  site: SiteConfig;
  copy: CopyDeck;
  imageFilename: string;
  platformNames: string[];
  mode: "dry" | "live";
  avatarUrl?: string;
}): Promise<RunRecord> {
  const t0 = Date.now();
  const started = new Date().toISOString().replace("T", " ").slice(0, 19);
  const { userId, article, site, copy, platformNames, mode, avatarUrl } = params;
  const isLive = mode === "live";

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
  const mediaSettings = getSetting<MediaHostSettings>(
    "media_host",
    {
      provider: "app_url",
      repo: "",
      branch: "main",
      path_prefix: "autopost",
    },
    userId
  );

  // Always rebuild thumbnail to reflect any edited hook/hashtags
  const thumb = await buildThumbnail(article, copy, site, thumbSettings, {
    ...(avatarUrl ? { avatarUrl } : {}),
    userId,
  });
  const allPlats = listPlatformStates(userId);
  const selectedPlats = allPlats.filter((p) => platformNames.includes(p.meta.name));

  let imageUrl = "";
  const needsUrl = selectedPlats.some((p) => p.meta.needs_public_url);
  if (
    mediaSettings.provider === "app_url" ||
    (isLive && mediaSettings.provider === "github_raw" && (needsUrl || mediaSettings.provider === "github_raw"))
  ) {
    try {
      imageUrl = await uploadPublicMedia(thumb.fullPath, mediaSettings, userId);
    } catch (err) {
      console.error("mediaHost error:", err);
    }
  }

  const counts = { ok: 0, dry: 0, error: 0 };
  const results: PlatformPostResult[] = [];

  for (const plat of selectedPlats) {
    const meta = plat.meta;
    const text = textForPlatform(meta.copy_key, copy, article);
    if (!isLive) {
      recordPost(article.key, meta.name, "dry", "", "composer preview", userId);
      counts.dry += 1;
      results.push({
        platform: meta.name,
        label: meta.label,
        status: "dry",
        text,
        url: "",
        detail: plat.ready ? "" : `Missing keys: ${plat.missing_env.join(", ")}`,
      });
      continue;
    }

    if (!plat.ready) {
      const detail = `Missing required keys: ${plat.missing_env.join(", ")}`;
      recordPost(article.key, meta.name, "error", "", detail, userId);
      counts.error += 1;
      results.push({
        platform: meta.name,
        label: meta.label,
        status: "error",
        text,
        url: "",
        detail,
      });
      continue;
    }

    try {
      const postRes = await publishToPlatform(
        meta.name,
        text,
        meta.supports_image ? thumb.fullPath : null,
        imageUrl,
        article,
        site,
        plat.config,
        copy,
        userId
      );
      recordPost(article.key, meta.name, "ok", postRes.url, "", userId);
      counts.ok += 1;
      results.push({
        platform: meta.name,
        label: meta.label,
        status: "ok",
        text,
        url: postRes.url,
        detail: "",
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      recordPost(article.key, meta.name, "error", "", detail, userId);
      counts.error += 1;
      results.push({
        platform: meta.name,
        label: meta.label,
        status: "error",
        text,
        url: "",
        detail,
      });
    }
  }

  markSeen(article.key, article.title, article.url, site.name, userId);
  const aiSettings = getSetting<AiSettings>("ai", { enabled: true, model: "gemini-4-hydrogen", brand_voice: "" }, userId);

  const runRecord: RunRecord = {
    id: crypto.randomUUID().slice(0, 12),
    mode: isLive ? "LIVE" : "DRY RUN",
    started,
    elapsed: Number(((Date.now() - t0) / 1000).toFixed(1)),
    writer: aiSettings.enabled && hasGeminiKeyConfigured() ? "gemini" : "template",
    counts,
    items: [
      {
        site: site.name,
        siteId: site.id,
        title: article.title,
        url: article.url,
        key: article.key,
        image_filename: thumb.filename,
        image_url: imageUrl,
        copy,
        results,
      },
    ],
    created_at: Date.now() / 1000,
  };

  saveRun(runRecord, userId);
  return runRecord;
}

export function renderStandaloneReportHtml(run: RunRecord, userId?: string): string {
  const imgDir = userId ? path.join(IMAGES_DIR, path.basename(userId)) : IMAGES_DIR;
  const cards = run.items
    .map((item) => {
      const imgPath = path.join(imgDir, path.basename(item.image_filename || ""));
      let imgTag = "";
      if (item.image_filename && fs.existsSync(imgPath)) {
        const b64 = fs.readFileSync(imgPath).toString("base64");
        imgTag = `<img class="thumb" src="data:image/png;base64,${b64}" alt="thumbnail" />`;
      }
      const rows = item.results
        .map((r) => {
          const cls = r.status === "ok" ? "ok" : r.status === "dry" ? "dry" : "err";
          const link = r.url ? `<a href="${escapeHtml(r.url)}" target="_blank">open post</a>` : "";
          const err = r.detail ? `<div class="meta">${escapeHtml(r.detail)}</div>` : "";
          return `<div class="plat">
            <div class="phead">
              <span class="badge ${cls}">${r.status.toUpperCase()}</span>
              <span class="pname">${escapeHtml(r.label)}</span>
              ${link}
            </div>
            <pre>${escapeHtml(r.text)}</pre>
            ${err}
          </div>`;
        })
        .join("");

      return `<section class="card">
        <div class="left">
          ${imgTag}
          <div class="srcline">${escapeHtml(item.site)} · <a href="${escapeHtml(item.url)}">${escapeHtml(item.url)}</a></div>
        </div>
        <div class="right">${rows}</div>
      </section>`;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>AutoPost — ${escapeHtml(run.mode)}</title>
<style>
  :root{--bg:#0b0e14;--card:#131823;--line:#222a3a;--text:#e6ecf5;--dim:#8b97ad;--ok:#2ecc71;--dry:#f5a623;--err:#ff5a5f}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  header{padding:26px 26px 0;border-bottom:1px solid var(--line)}
  h1{margin:0 0 6px;font-size:22px;letter-spacing:-.3px}
  .sub{color:var(--dim);font-size:13px;margin-bottom:18px}
  .stats{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 18px}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 14px;font-size:13px}
  .stat b{font-size:16px;display:block}
  main{padding:22px 26px 60px;display:grid;gap:18px}
  .card{display:grid;grid-template-columns:minmax(280px,420px) 1fr;gap:20px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}
  @media(max-width:900px){.card{grid-template-columns:1fr}}
  .thumb{width:100%;border-radius:10px;display:block;border:1px solid var(--line)}
  .srcline{font-size:12px;color:var(--dim);margin-top:10px;word-break:break-all}
  .srcline a{color:#6ea8fe;text-decoration:none}
  .plat{border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px;background:#0f1420}
  .phead{display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:13px}
  .pname{font-weight:600}
  .phead a{margin-left:auto;color:#6ea8fe;font-size:12px;text-decoration:none}
  .badge{font-size:10px;letter-spacing:.6px;padding:2px 7px;border-radius:20px;font-weight:700}
  .badge.ok{background:rgba(46,204,113,.15);color:var(--ok)}
  .badge.dry{background:rgba(245,166,35,.15);color:var(--dry)}
  .badge.err{background:rgba(255,90,95,.15);color:var(--err)}
  pre{margin:0;white-space:pre-wrap;word-wrap:break-word;font:13px/1.6 inherit;font-family:inherit;color:#cdd6e6}
  .meta{font-size:11px;color:var(--err);margin-top:6px}
</style>
</head>
<body>
<header>
  <h1>AutoPost run — ${escapeHtml(run.mode)}</h1>
  <div class="sub">started ${escapeHtml(run.started)} · ${run.elapsed}s · writer: ${escapeHtml(run.writer)}</div>
  <div class="stats">
    <div class="stat"><b>${run.items.length}</b>articles</div>
    <div class="stat"><b>${run.counts.ok}</b>published</div>
    <div class="stat"><b>${run.counts.dry}</b>previews</div>
    <div class="stat"><b>${run.counts.error}</b>errors</div>
  </div>
</header>
<main>${cards || '<p style="color:#8b97ad">No new articles found.</p>'}</main>
</body>
</html>`;
}

export function exportConfigYaml(userId: string): string {
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
      use_og_image: false,
    },
    userId
  );
  const media_host = getSetting<MediaHostSettings>(
    "media_host",
    {
      provider: "none",
      repo: "",
      branch: "main",
      path_prefix: "autopost",
    },
    userId
  );
  const sites = listSites(userId).map((s) => ({
    name: s.name,
    url: s.url,
    ...(s.feed ? { feed: s.feed } : {}),
    ...(s.sitemap ? { sitemap: s.sitemap } : {}),
    brand_color: s.brand_color,
    accent_color: s.accent_color,
    hashtags: s.hashtags,
    handles: s.handles,
  }));
  const platforms: Record<string, unknown> = {};
  for (const p of listPlatformStates(userId)) {
    platforms[p.meta.name] = { enabled: p.enabled, ...p.config };
  }

  return YAML.stringify({ run, ai, sites, platforms, thumbnail, media_host });
}

export function importConfigYaml(rawYaml: string, userId: string): void {
  const parsed = YAML.parse(rawYaml) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid YAML document");
  }
  if (parsed.run && typeof parsed.run === "object") {
    setSetting("run", parsed.run, userId);
  }
  if (parsed.ai && typeof parsed.ai === "object") {
    setSetting("ai", parsed.ai, userId);
  }
  if (parsed.thumbnail && typeof parsed.thumbnail === "object") {
    setSetting("thumbnail", parsed.thumbnail, userId);
  }
  if (parsed.media_host && typeof parsed.media_host === "object") {
    setSetting("media_host", parsed.media_host, userId);
  }
  if (Array.isArray(parsed.sites)) {
    for (const s of parsed.sites as Array<Record<string, unknown>>) {
      if (!s.name || !s.url) continue;
      upsertSite(
        {
          id: String(s.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
          name: String(s.name),
          url: String(s.url),
          feed: String(s.feed || ""),
          sitemap: String(s.sitemap || ""),
          brand_color: String(s.brand_color || "#1a73e8"),
          accent_color: String(s.accent_color || "#ff6d00"),
          hashtags: Array.isArray(s.hashtags) ? s.hashtags.map(String) : [],
          handles: (s.handles && typeof s.handles === "object" ? s.handles : {}) as Record<string, string>,
          enabled: true,
        },
        userId
      );
    }
  }
  if (parsed.platforms && typeof parsed.platforms === "object") {
    for (const [name, pcfg] of Object.entries(parsed.platforms as Record<string, Record<string, unknown>>)) {
      if (!pcfg || typeof pcfg !== "object") continue;
      const { enabled, ...rest } = pcfg;
      updatePlatformState(name, Boolean(enabled), rest, userId);
    }
  }
}
