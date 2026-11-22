import {
  DEFAULT_SCHEDULE_SETTINGS,
  deleteSite,
  getSetting,
  listAllUserIds,
  listPlatformStates,
  listSites,
  setSetting,
  upsertSite,
} from "./db.ts";
import {
  fetchGravatarProfile,
  resolveLinkedSitesFromGravatar,
} from "./gravatar.ts";
import { runPipeline } from "./runner.ts";
import type {
  GravatarConnection,
  GravatarProfile,
  RunRecord,
  ScheduleSettings,
  SiteConfig,
} from "./types.ts";

const activeRuns = new Set<string>();
const initialSyncInFlight = new Set<string>();
let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let tickInFlight = false;

export function setInitialGravatarSyncInFlight(userId: string, active: boolean): void {
  if (active) initialSyncInFlight.add(userId);
  else initialSyncInFlight.delete(userId);
}

export function isInitialGravatarSyncInFlight(userId: string): boolean {
  return initialSyncInFlight.has(userId);
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz.trim() }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimezone(tz?: string): string {
  const clean = (tz || "UTC").trim();
  return isValidTimeZone(clean) ? clean : "UTC";
}

export function normalizePostTime(raw?: string): string {
  const m = String(raw || "09:00")
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "09:00";
  const hh = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function getZonedParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const val = (type: string): number => {
    const p = parts.find((x) => x.type === type)?.value || "0";
    const num = Number(p);
    return type === "hour" && num === 24 ? 0 : num;
  };
  return {
    year: val("year"),
    month: val("month"),
    day: val("day"),
    hour: val("hour"),
    minute: val("minute"),
    second: val("second"),
  };
}

function zonedDateTimeToEpochSec(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): number {
  const approxUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const p = getZonedParts(new Date(approxUtcMs), timeZone);
  const zonedAsUtcMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offsetMs = zonedAsUtcMs - approxUtcMs;
  const correctedMs = approxUtcMs - offsetMs;
  return Math.floor(correctedMs / 1000);
}

export function computeNextRunAt(
  frequency: ScheduleSettings["frequency"],
  postTime: string,
  timezone: string,
  fromEpochSec = Math.floor(Date.now() / 1000)
): number {
  const tz = normalizeTimezone(timezone);
  const cleanTime = normalizePostTime(postTime);
  const [targetHour, targetMinute] = cleanTime.split(":").map(Number);

  if (frequency === "every_6h") {
    return fromEpochSec + 6 * 3600;
  }
  if (frequency === "every_12h") {
    return fromEpochSec + 12 * 3600;
  }

  // Daily at exact HH:MM in user's IANA timezone
  const nowParts = getZonedParts(new Date(fromEpochSec * 1000), tz);
  let candidate = zonedDateTimeToEpochSec(
    nowParts.year,
    nowParts.month,
    nowParts.day,
    targetHour,
    targetMinute,
    tz
  );

  // If today's slot already passed (within 30s buffer), schedule tomorrow cleanly
  if (candidate <= fromEpochSec + 30) {
    const tomorrowBase = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day + 1, 12, 0, 0));
    const tom = getZonedParts(tomorrowBase, tz);
    candidate = zonedDateTimeToEpochSec(
      tom.year,
      tom.month,
      tom.day,
      targetHour,
      targetMinute,
      tz
    );
  }
  return candidate;
}

export function getUserSchedule(userId: string): ScheduleSettings {
  const raw = getSetting<ScheduleSettings>("schedule", DEFAULT_SCHEDULE_SETTINGS, userId);
  const tz = normalizeTimezone(raw.timezone);
  const postTime = normalizePostTime(raw.post_time);
  const freq: ScheduleSettings["frequency"] =
    raw.frequency === "every_6h" || raw.frequency === "every_12h" ? raw.frequency : "daily";
  return {
    ...DEFAULT_SCHEDULE_SETTINGS,
    ...raw,
    timezone: tz,
    post_time: postTime,
    frequency: freq,
    mode: raw.mode === "dry" ? "dry" : "live",
    gravatar_only: typeof raw.gravatar_only === "boolean" ? raw.gravatar_only : true,
    next_run_at:
      raw.enabled && !raw.next_run_at
        ? computeNextRunAt(freq, postTime, tz)
        : raw.next_run_at ?? null,
  };
}

export function saveUserSchedule(userId: string, patch: Partial<ScheduleSettings>): ScheduleSettings {
  const current = getUserSchedule(userId);
  const enabled = typeof patch.enabled === "boolean" ? patch.enabled : current.enabled;
  const frequency =
    patch.frequency === "daily" || patch.frequency === "every_12h" || patch.frequency === "every_6h"
      ? patch.frequency
      : current.frequency;
  const timezone = patch.timezone !== undefined ? normalizeTimezone(patch.timezone) : current.timezone;
  const post_time = patch.post_time !== undefined ? normalizePostTime(patch.post_time) : current.post_time;
  const mode = patch.mode === "dry" || patch.mode === "live" ? patch.mode : current.mode;
  const sync_gravatar =
    typeof patch.sync_gravatar === "boolean" ? patch.sync_gravatar : current.sync_gravatar;
  const gravatar_only =
    typeof patch.gravatar_only === "boolean" ? patch.gravatar_only : current.gravatar_only;

  const scheduleChanged =
    frequency !== current.frequency ||
    timezone !== current.timezone ||
    post_time !== current.post_time ||
    (enabled && !current.enabled);

  const next_run_at = !enabled
    ? null
    : scheduleChanged || !current.next_run_at
    ? computeNextRunAt(frequency, post_time, timezone)
    : current.next_run_at;

  const next: ScheduleSettings = {
    ...current,
    ...patch,
    enabled,
    frequency,
    timezone,
    post_time,
    mode,
    sync_gravatar,
    gravatar_only,
    next_run_at,
  };

  setSetting("schedule", next, userId);
  return next;
}

export function getUserGravatarConnection(userId: string): GravatarConnection {
  return getSetting<GravatarConnection>(
    "gravatar",
    {
      identifier: "",
      auto_sync: true,
      last_synced_at: null,
      synced_site_ids: [],
      profile: null,
    },
    userId
  );
}

export async function syncGravatarForUser(
  userId: string,
  identifierOverride?: string,
  autoSync?: boolean
): Promise<{
  connection: GravatarConnection;
  profile: GravatarProfile;
  syncedSites: Array<{ site: SiteConfig; discovery: "rss" | "sitemap" | "page" }>;
}> {
  const current = getUserGravatarConnection(userId);
  const identifier = (identifierOverride ?? current.identifier ?? "").trim();
  if (!identifier) {
    throw new Error("Enter a Gravatar username, profile URL, or email address first.");
  }

  const profile = await fetchGravatarProfile(identifier);
  const resolved = await resolveLinkedSitesFromGravatar(profile);
  const existingSites = listSites(userId);
  const existingMap = new Map(existingSites.map((s) => [s.id, s]));

  const syncedSites: Array<{ site: SiteConfig; discovery: "rss" | "sitemap" | "page" }> = [];
  for (const item of resolved) {
    const prev = existingMap.get(item.site.id);
    const merged: SiteConfig = {
      ...item.site,
      enabled: prev ? prev.enabled : true,
      handles: prev ? { ...item.site.handles, ...prev.handles } : item.site.handles,
      hashtags: prev && prev.hashtags.length > 0 ? prev.hashtags : item.site.hashtags,
      created_at: prev?.created_at,
      source: "gravatar",
    };
    const saved = upsertSite(merged, userId);
    syncedSites.push({ site: saved, discovery: item.discovery });
  }

  // Prune previously synced Gravatar sites that are no longer included on the connected Gravatar profile
  const activeSyncedIds = new Set(syncedSites.map((s) => s.site.id));
  for (const oldSite of existingSites) {
    if (oldSite.source === "gravatar" && !activeSyncedIds.has(oldSite.id)) {
      deleteSite(oldSite.id, userId);
    }
  }

  const nextConn: GravatarConnection = {
    identifier,
    auto_sync: typeof autoSync === "boolean" ? autoSync : current.auto_sync,
    last_synced_at: Math.floor(Date.now() / 1000),
    synced_site_ids: syncedSites.map((s) => s.site.id),
    profile,
  };

  setSetting("gravatar", nextConn, userId);
  return { connection: nextConn, profile, syncedSites };
}

export async function executeAutoPostCycle(
  userId: string,
  trigger: "scheduled" | "manual" = "scheduled"
): Promise<{
  run: RunRecord | null;
  syncedSitesCount: number;
  schedule: ScheduleSettings;
}> {
  if (activeRuns.has(userId)) {
    throw new Error("An automated post cycle is already running for this workspace.");
  }

  activeRuns.add(userId);
  const initialSchedule = getUserSchedule(userId);
  const nowSec = Math.floor(Date.now() / 1000);

  setSetting(
    "schedule",
    {
      ...initialSchedule,
      last_status: "running",
      last_error: "",
    },
    userId
  );

  let syncedSitesCount = 0;

  try {
    // 1. Auto-sync connected Gravatar linked sites before sweeping feeds
    const gravConn = getUserGravatarConnection(userId);
    if (initialSchedule.sync_gravatar && gravConn.identifier) {
      try {
        const synced = await syncGravatarForUser(userId, gravConn.identifier, gravConn.auto_sync);
        syncedSitesCount = synced.syncedSites.length;
      } catch (err) {
        console.warn(`Gravatar pre-run sync skipped for user ${userId}:`, err);
      }
    }

    // 2. Check sites & connected platforms (strictly Gravatar-included websites when gravatar_only is enabled)
    const enforceGravatarOnly = initialSchedule.gravatar_only !== false;
    const enabledSites = listSites(userId).filter(
      (s) => s.enabled && (!enforceGravatarOnly || s.source === "gravatar")
    );
    if (enabledSites.length === 0) {
      throw new Error(
        enforceGravatarOnly
          ? "No websites included on your Gravatar profile were found. Add website links on your Gravatar profile and re-sync."
          : "No enabled sites found. Connect a Gravatar profile with linked websites or add a site under Sites & Feeds."
      );
    }

    const plats = listPlatformStates(userId);
    const enabledPlats = plats.filter((p) => p.enabled);
    const readyPlats = enabledPlats.filter((p) => p.ready);

    if (enabledPlats.length === 0) {
      throw new Error("No social platforms are enabled. Enable at least one platform under Platforms & Keys.");
    }

    let runMode: "live" | "preview-all" = "live";
    if (initialSchedule.mode === "dry") {
      runMode = "preview-all";
    } else if (readyPlats.length === 0) {
      if (trigger === "manual") {
        throw new Error(
          "No enabled social platform has credentials configured yet. Add keys under Platforms & Keys or switch Automatic Mode to Dry Preview."
        );
      }
      throw new Error(
        "Scheduled live post skipped: add credentials for at least one enabled platform under Platforms & Keys."
      );
    }

    // 3. Execute full pipeline: scrape Gravatar websites -> write captions -> 1200x630 PNG -> upload/sign -> publish
    const run = await runPipeline({
      userId,
      mode: runMode,
      gravatarOnly: enforceGravatarOnly,
    });

    const nextRunAt = initialSchedule.enabled
      ? computeNextRunAt(initialSchedule.frequency, initialSchedule.post_time, initialSchedule.timezone, nowSec)
      : null;

    const hasErrorsOnly = run.counts.error > 0 && run.counts.ok === 0 && run.counts.dry === 0;
    const emptyNote =
      !hasErrorsOnly && run.items.length === 0
        ? "No new unposted articles found within your lookback window."
        : "";
    const updated: ScheduleSettings = {
      ...initialSchedule,
      last_run_at: nowSec,
      next_run_at: nextRunAt,
      last_status: hasErrorsOnly ? "error" : "ok",
      last_error: hasErrorsOnly
        ? "All platform post attempts failed; check Ledger & Reports for details."
        : emptyNote,
      last_run_id: run.id,
    };
    setSetting("schedule", updated, userId);

    return { run, syncedSitesCount, schedule: updated };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const nextRunAt = initialSchedule.enabled
      ? computeNextRunAt(initialSchedule.frequency, initialSchedule.post_time, initialSchedule.timezone, nowSec)
      : null;
    const failed: ScheduleSettings = {
      ...initialSchedule,
      last_run_at: nowSec,
      next_run_at: nextRunAt,
      last_status: "error",
      last_error: msg.slice(0, 400),
    };
    setSetting("schedule", failed, userId);

    if (trigger === "manual") {
      throw err;
    }
    return { run: null, syncedSitesCount, schedule: failed };
  } finally {
    activeRuns.delete(userId);
  }
}

export async function runSchedulerTick(): Promise<void> {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    const now = Math.floor(Date.now() / 1000);
    const userIds = listAllUserIds();
    for (const userId of userIds) {
      const sched = getUserSchedule(userId);
      if (!sched.enabled || !sched.next_run_at) continue;
      if (sched.next_run_at <= now && !activeRuns.has(userId)) {
        const sites = listSites(userId).filter(
          (s) => s.enabled && (!sched.gravatar_only || s.source === "gravatar")
        );
        const grav = getUserGravatarConnection(userId);
        // Only run background scheduled tick when the user has sites OR a synced Gravatar identifier configured
        if (sites.length === 0 && !grav.identifier) {
          saveUserSchedule(userId, {
            next_run_at: computeNextRunAt(sched.frequency, sched.post_time, sched.timezone, now),
          });
          continue;
        }
        await executeAutoPostCycle(userId, "scheduled");
      }
    }
  } catch (err) {
    console.error("Daily scheduler tick error:", err);
  } finally {
    tickInFlight = false;
  }
}

export function startDailyScheduler(intervalMs = 30_000): void {
  if (schedulerTimer) return;
  setTimeout(() => {
    runSchedulerTick().catch((err) => console.error("Initial scheduler check error:", err));
  }, 5000);
  schedulerTimer = setInterval(() => {
    runSchedulerTick().catch((err) => console.error("Periodic scheduler check error:", err));
  }, intervalMs);
}
