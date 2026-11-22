import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_MEDIA_HOST,
  DEFAULT_RUN_SETTINGS,
  DEFAULT_THUMB_SETTINGS,
  PLATFORM_CATALOG,
} from "../server/db.ts";
import { fetchGravatarProfile, resolveLinkedSitesFromGravatar } from "../server/gravatar.ts";
import { uploadPublicMedia } from "../server/mediaHost.ts";
import { publishToPlatform, textForPlatform } from "../server/publishers.ts";
import { renderStandaloneReportHtml } from "../server/runner.ts";
import { discover, enrichFromPage } from "../server/sources.ts";
import { buildThumbnail } from "../server/thumb.ts";
import type {
  AiSettings,
  MediaHostSettings,
  PlatformPostResult,
  RunItemResult,
  RunRecord,
  RunSettings,
  SiteConfig,
  ThumbnailSettings,
} from "../server/types.ts";
import { DATA_DIR, ROOT } from "../server/util.ts";
import { writeCopy } from "../server/writer.ts";

interface CliArgs {
  configPath: string;
  mode: "dry" | "preview-all" | "live";
  gravatar: string;
  outReport: string;
  ignoreLedger: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    configPath: process.env.AUTOPOST_CONFIG || "config.yaml",
    mode: (process.env.AUTOPOST_MODE as CliArgs["mode"]) || "dry",
    gravatar: process.env.AUTOPOST_GRAVATAR || "",
    outReport: process.env.AUTOPOST_REPORT || "autopost-report.html",
    ignoreLedger: process.env.AUTOPOST_IGNORE_LEDGER === "true",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config" && argv[i + 1]) out.configPath = argv[++i];
    else if (arg === "--mode" && argv[i + 1]) {
      const m = argv[++i];
      if (m === "live" || m === "dry" || m === "preview-all") out.mode = m;
    } else if (arg === "--gravatar" && argv[i + 1]) out.gravatar = argv[++i];
    else if (arg === "--report" && argv[i + 1]) out.outReport = argv[++i];
    else if (arg === "--ignore-ledger") out.ignoreLedger = true;
  }
  return out;
}

function loadLedger(filePath: string): Record<string, { status: string; url: string; ts: number }> {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<
        string,
        { status: string; url: string; ts: number }
      >;
    }
  } catch {
    // ignore corrupt ledger file
  }
  return {};
}

function saveLedger(
  filePath: string,
  ledger: Record<string, { status: string; url: string; ts: number }>
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(ledger, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawYaml = process.env.AUTOPOST_CONFIG_YAML?.trim()
    ? process.env.AUTOPOST_CONFIG_YAML
    : fs.existsSync(path.resolve(ROOT, args.configPath))
    ? fs.readFileSync(path.resolve(ROOT, args.configPath), "utf8")
    : "";

  const parsed = rawYaml ? (YAML.parse(rawYaml) as Record<string, unknown>) : {};
  const runCfg: RunSettings = { ...DEFAULT_RUN_SETTINGS, ...((parsed.run as Partial<RunSettings>) || {}) };
  const aiCfg: AiSettings = { ...DEFAULT_AI_SETTINGS, ...((parsed.ai as Partial<AiSettings>) || {}) };
  if (aiCfg.enabled && !(process.env.GEMINI_API_KEY || "").trim()) {
    console.warn("Notice: GEMINI_API_KEY is not set; using rule-based caption formatter for this CLI run.");
    aiCfg.enabled = false;
  }
  const thumbCfg: ThumbnailSettings = {
    ...DEFAULT_THUMB_SETTINGS,
    ...((parsed.thumbnail as Partial<ThumbnailSettings>) || {}),
  };
  const mediaCfg: MediaHostSettings = {
    ...DEFAULT_MEDIA_HOST,
    ...((parsed.media_host as Partial<MediaHostSettings>) || {}),
  };

  const sitesMap = new Map<string, SiteConfig>();
  if (Array.isArray(parsed.sites)) {
    for (const s of parsed.sites as Array<Record<string, unknown>>) {
      if (!s?.name || !s?.url) continue;
      const id = String(s.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      sitesMap.set(String(s.url).toLowerCase(), {
        id,
        name: String(s.name),
        url: String(s.url),
        feed: String(s.feed || ""),
        sitemap: String(s.sitemap || ""),
        brand_color: String(s.brand_color || "#1a73e8"),
        accent_color: String(s.accent_color || "#ff6d00"),
        hashtags: Array.isArray(s.hashtags) ? s.hashtags.map(String) : [],
        handles: (s.handles && typeof s.handles === "object" ? s.handles : {}) as Record<string, string>,
        enabled: true,
      });
    }
  }

  if (args.gravatar) {
    const profile = await fetchGravatarProfile(args.gravatar);
    const linked = await resolveLinkedSitesFromGravatar(profile);
    for (const item of linked) {
      const key = item.site.url.toLowerCase();
      if (!sitesMap.has(key)) sitesMap.set(key, item.site);
    }
  }

  const sites = Array.from(sitesMap.values());
  if (sites.length === 0) {
    throw new Error("No sites configured in config.yaml or --gravatar.");
  }

  const platCfgMap = (parsed.platforms && typeof parsed.platforms === "object"
    ? parsed.platforms
    : {}) as Record<string, Record<string, unknown>>;

  const forceAll = args.mode === "preview-all";
  const isLive = args.mode === "live";

  const activePlats = PLATFORM_CATALOG.map((meta) => {
    const raw = platCfgMap[meta.name] || {};
    const { enabled, ...cfg } = raw;
    const mergedCfg = { ...meta.default_config, ...cfg };
    const envOk = meta.required_env.every((k) => Boolean((process.env[k] || "").trim()));
    return {
      meta,
      enabled: typeof enabled === "boolean" ? enabled : meta.name === "bluesky",
      config: mergedCfg,
      ready: envOk,
    };
  }).filter((p) => p.enabled && (forceAll || p.ready));

  if (activePlats.length === 0) {
    throw new Error(
      "No active platforms with credentials found. Set platform secrets in env or run with --mode preview-all."
    );
  }

  const ledgerFile = path.join(DATA_DIR, "cli-ledger.json");
  const ledger = loadLedger(ledgerFile);
  const t0 = Date.now();
  const started = new Date().toISOString().replace("T", " ").slice(0, 19);
  const counts = { ok: 0, dry: 0, error: 0 };
  const items: RunItemResult[] = [];
  let usedGemini = false;

  for (const site of sites) {
    const articles = await discover(site, runCfg.lookback_days, runCfg.max_per_site);
    for (let art of articles) {
      if (
        !args.ignoreLedger &&
        activePlats.every((p) => {
          const rec = ledger[`${art.key}:${p.meta.name}`];
          return rec && (isLive ? rec.status === "ok" : true);
        })
      ) {
        continue;
      }

      art = await enrichFromPage(art);
      const { copy, writerUsed } = await writeCopy(art, aiCfg, site);
      if (writerUsed === "gemini") usedGemini = true;

      const thumb = await buildThumbnail(art, copy, site, thumbCfg);
      const imageUrl =
        mediaCfg.provider === "github_raw"
          ? await uploadPublicMedia(thumb.fullPath, mediaCfg)
          : "";

      const results: PlatformPostResult[] = [];
      for (const plat of activePlats) {
        const lKey = `${art.key}:${plat.meta.name}`;
        if (!args.ignoreLedger && ledger[lKey] && (isLive ? ledger[lKey].status === "ok" : true)) {
          continue;
        }
        const text = textForPlatform(plat.meta.copy_key, copy, art);
        if (!isLive) {
          counts.dry += 1;
          ledger[lKey] = { status: "dry", url: "", ts: Date.now() / 1000 };
          results.push({ platform: plat.meta.name, label: plat.meta.label, status: "dry", text, url: "", detail: "cli dry" });
          continue;
        }
        try {
          const postRes = await publishToPlatform(
            plat.meta.name,
            text,
            plat.meta.supports_image ? thumb.fullPath : null,
            imageUrl,
            art,
            site,
            plat.config,
            copy
          );
          counts.ok += 1;
          ledger[lKey] = { status: "ok", url: postRes.url, ts: Date.now() / 1000 };
          results.push({ platform: plat.meta.name, label: plat.meta.label, status: "ok", text, url: postRes.url, detail: "" });
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          counts.error += 1;
          results.push({ platform: plat.meta.name, label: plat.meta.label, status: "error", text, url: "", detail });
        }
      }

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

  saveLedger(ledgerFile, ledger);
  const run: RunRecord = {
    id: crypto.randomUUID().slice(0, 12),
    mode: args.mode === "live" ? "LIVE" : args.mode === "preview-all" ? "PREVIEW ALL" : "DRY RUN",
    started,
    elapsed: Number(((Date.now() - t0) / 1000).toFixed(1)),
    writer: usedGemini ? "gemini" : "template",
    counts,
    items,
    created_at: Date.now() / 1000,
  };

  const reportHtml = renderStandaloneReportHtml(run);
  const reportPath = path.resolve(ROOT, args.outReport);
  fs.writeFileSync(reportPath, reportHtml);
  console.log(
    JSON.stringify({ runId: run.id, mode: run.mode, counts: run.counts, report: reportPath }, null, 2)
  );
}

main().catch((err) => {
  console.error("AutoPost CLI failed:", err);
  process.exit(1);
});
