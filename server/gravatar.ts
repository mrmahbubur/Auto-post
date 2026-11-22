import crypto from "node:crypto";
import { probeWebsiteFeed } from "./sources.ts";
import type { Article, GravatarAccount, GravatarProfile, SiteConfig } from "./types.ts";
import { UA, keyFor, slug, stripHtml } from "./util.ts";

export type { GravatarAccount, GravatarProfile };

const SOCIAL_ONLY_HOSTS = new Set([
  "x.com",
  "twitter.com",
  "bsky.app",
  "bsky.social",
  "facebook.com",
  "www.facebook.com",
  "instagram.com",
  "www.instagram.com",
  "threads.net",
  "www.threads.net",
  "linkedin.com",
  "www.linkedin.com",
  "pinterest.com",
  "www.pinterest.com",
  "reddit.com",
  "www.reddit.com",
  "t.me",
  "discord.com",
  "discord.gg",
  "tiktok.com",
  "www.tiktok.com",
  "youtube.com",
  "www.youtube.com",
  "github.com",
  "mastodon.social",
  "gravatar.com",
  "en.gravatar.com",
]);

function isWebsiteCandidateUrl(rawUrl: string, serviceType = ""): boolean {
  try {
    const u = new URL(rawUrl);
    if (!u.protocol.startsWith("http")) return false;
    const host = u.hostname.toLowerCase();
    const st = serviceType.toLowerCase();
    // Skip pure social-profile hubs (they are target destinations, not source websites),
    // unless it's a blogging/publishing host like Substack, Medium, WordPress, Tumblr, Ghost, Hashnode, Dev.to, GitHub Pages.
    if (host.endsWith(".github.io") || host.endsWith(".wordpress.com") || host.endsWith(".substack.com") || host.endsWith(".medium.com") || host.endsWith(".tumblr.com") || host.endsWith(".blogspot.com") || host.endsWith(".hashnode.dev")) {
      return true;
    }
    if (host === "medium.com" || host === "dev.to" || host === "hashnode.com") {
      return u.pathname.length > 1;
    }
    if (SOCIAL_ONLY_HOSTS.has(host)) return false;
    if (["twitter", "x", "bluesky", "facebook", "instagram", "threads", "linkedin", "mastodon", "tiktok", "youtube", "github"].includes(st)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function extractGravatarHandles(profile: GravatarProfile): Record<string, string> {
  const handles: Record<string, string> = {};
  for (const acc of profile.verified_accounts) {
    try {
      const u = new URL(acc.url);
      const host = u.hostname.toLowerCase();
      const segs = u.pathname.split("/").filter(Boolean);
      const last = segs[segs.length - 1] || "";
      if ((host.includes("bsky") || acc.service_type === "bluesky") && segs.length > 0) {
        const idx = segs.indexOf("profile");
        const handle = idx >= 0 && segs[idx + 1] ? segs[idx + 1] : last;
        if (handle) handles.bsky = handle.replace(/^@/, "");
      } else if (host.includes("threads.net") && last) {
        handles.threads = last.replace(/^@/, "");
      } else if ((host === "x.com" || host === "twitter.com") && last) {
        handles.x = last.replace(/^@/, "");
      }
    } catch {
      // ignore invalid account URL
    }
  }
  return handles;
}

function parseGravatarInput(raw: string): { candidates: string[] } {
  const input = raw.trim();
  if (!input) {
    throw new Error("Enter a Gravatar username, profile URL, email address, or hash.");
  }

  // Email address -> try SHA-256 (v3 primary) and MD5 (legacy)
  if (input.includes("@") && !input.startsWith("http")) {
    const normalized = input.toLowerCase();
    const sha256 = crypto.createHash("sha256").update(normalized).digest("hex");
    const md5 = crypto.createHash("md5").update(normalized).digest("hex");
    return { candidates: [sha256, md5] };
  }

  // URL like https://gravatar.com/beau or https://en.gravatar.com/beau.json
  if (/^https?:\/\//i.test(input)) {
    try {
      const u = new URL(input);
      const seg = u.pathname
        .replace(/\/+$/, "")
        .split("/")
        .filter(Boolean)
        .pop();
      if (seg) {
        const clean = seg.replace(/\.(json|xml|qr|vcf)$/i, "");
        return { candidates: [clean] };
      }
    } catch {
      // fall through
    }
  }

  const clean = input.replace(/^@/, "").replace(/\.(json|xml)$/i, "").trim();
  return { candidates: [clean] };
}

async function fetchV3Profile(id: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`https://api.gravatar.com/v3/profiles/${encodeURIComponent(id)}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    if (data && typeof data === "object" && !data.error) return data;
    return null;
  } catch {
    return null;
  }
}

async function fetchLegacyJsonProfile(id: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`https://en.gravatar.com/${encodeURIComponent(id)}.json`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { entry?: Array<Record<string, unknown>> };
    if (Array.isArray(data?.entry) && data.entry[0]) return data.entry[0];
    return null;
  } catch {
    return null;
  }
}

async function fetchHtmlProfileLinks(profileUrl: string): Promise<Array<{ label: string; url: string }>> {
  try {
    const res = await fetch(profileUrl, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const matches = html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi);
    const seen = new Map<string, { label: string; url: string; isRoot: boolean }>();

    for (const m of matches) {
      const attrs = m[1] || "";
      if (!/card-item__link|rel=["'][^"']*\bme\b/i.test(attrs)) continue;
      const hrefMatch = attrs.match(/href=["'](https?:\/\/[^"']+)["']/i);
      if (!hrefMatch) continue;
      const href = hrefMatch[1].trim();
      if (!isWebsiteCandidateUrl(href)) continue;

      const titleMatch = attrs.match(/title=["']([^"']+)["']/i);
      const innerText = stripHtml(m[2] || "").replace(/[↗]+/g, "").trim();
      const rawLabel = (innerText || titleMatch?.[1] || "").trim();
      const cleanLabel = rawLabel && !/^https?:\/\//i.test(rawLabel) ? rawLabel : "";

      let isRoot = false;
      try {
        const u = new URL(href);
        isRoot = u.pathname === "" || u.pathname === "/";
      } catch {
        // ignore
      }

      const norm = href.replace(/\/+$/, "").toLowerCase();
      const existing = seen.get(norm);
      if (!existing || (!existing.label && cleanLabel)) {
        seen.set(norm, { label: cleanLabel || titleMatch?.[1] || "", url: href, isRoot });
      }
    }

    const sorted = Array.from(seen.values()).sort((a, b) => Number(b.isRoot) - Number(a.isRoot));
    // Collapse subpath links that share the same hostname as a root website link
    const byHost = new Map<string, { label: string; url: string }>();
    for (const item of sorted) {
      let hostKey = item.url.toLowerCase();
      try {
        hostKey = new URL(item.url).hostname.replace(/^www\./i, "").toLowerCase();
      } catch {
        // keep full url key
      }
      if (!byHost.has(hostKey)) {
        byHost.set(hostKey, { label: item.label, url: item.url });
      }
    }
    return Array.from(byHost.values());
  } catch {
    return [];
  }
}

export async function fetchGravatarProfile(rawInput: string): Promise<GravatarProfile> {
  const { candidates } = parseGravatarInput(rawInput);

  let v3: Record<string, unknown> | null = null;
  let legacy: Record<string, unknown> | null = null;
  let matchedId = candidates[0];

  for (const id of candidates) {
    const [r3, rLeg] = await Promise.all([fetchV3Profile(id), fetchLegacyJsonProfile(id)]);
    if (r3 || rLeg) {
      v3 = r3;
      legacy = rLeg;
      matchedId = id;
      break;
    }
  }

  if (!v3 && !legacy) {
    throw new Error(
      `No public Gravatar profile found for "${rawInput.trim()}". Try a public Gravatar username (e.g. "beau"), profile URL, or an email with a public Gravatar profile.`
    );
  }

  const hash = String(v3?.hash || legacy?.hash || matchedId);
  const profileUrl = String(v3?.profile_url || legacy?.profileUrl || `https://gravatar.com/${matchedId}`);
  const username = String(
    legacy?.preferredUsername ||
      profileUrl.replace(/\/+$/, "").split("/").pop() ||
      matchedId
  );
  const rawAvatar = String(v3?.avatar_url || legacy?.thumbnailUrl || `https://0.gravatar.com/avatar/${hash}`);
  const avatarUrl = rawAvatar.includes("?") ? `${rawAvatar}&s=512` : `${rawAvatar}?s=512`;

  const displayName = stripHtml(
    String(v3?.display_name || legacy?.displayName || username)
  ) || username;

  const jobTitle = stripHtml(String(v3?.job_title || legacy?.job_title || ""));
  const company = stripHtml(String(v3?.company || legacy?.company || ""));
  const location = stripHtml(String(v3?.location || legacy?.currentLocation || ""));
  const pronouns = stripHtml(String(v3?.pronouns || legacy?.pronouns || ""));
  const description = stripHtml(String(v3?.description || legacy?.aboutMe || ""), 600);

  const bgObj = legacy?.profileBackground as Record<string, unknown> | undefined;
  const bgColor = String(
    v3?.background_color || bgObj?.primaryColor || bgObj?.color || "#1a73e8"
  ).trim();
  const safeHex = /^#?[0-9a-fA-F]{6}$/.test(bgColor)
    ? bgColor.startsWith("#")
      ? bgColor
      : `#${bgColor}`
    : "#1a73e8";

  const headerImage = String(v3?.header_image || bgObj?.url || "");

  const v3Accounts = Array.isArray(v3?.verified_accounts)
    ? (v3?.verified_accounts as Array<Record<string, unknown>>)
    : [];
  const legAccounts = Array.isArray(legacy?.accounts)
    ? (legacy?.accounts as Array<Record<string, unknown>>)
    : [];

  const accountsMap = new Map<string, GravatarAccount>();
  for (const a of v3Accounts) {
    if (a.is_hidden) continue;
    const url = String(a.url || "");
    if (!url) continue;
    accountsMap.set(url, {
      label: String(a.service_label || a.service_type || "Link"),
      url,
      service_type: String(a.service_type || ""),
    });
  }
  for (const a of legAccounts) {
    if (a.is_hidden) continue;
    const url = String(a.url || "");
    if (!url || accountsMap.has(url)) continue;
    accountsMap.set(url, {
      label: String(a.name || a.shortname || a.domain || "Link"),
      url,
      service_type: String(a.shortname || a.domain || ""),
    });
  }

  const rawLinks = Array.isArray(v3?.links)
    ? (v3?.links as Array<Record<string, unknown>>)
    : Array.isArray(legacy?.urls)
    ? (legacy?.urls as Array<Record<string, unknown>>)
    : [];
  let links = rawLinks
    .map((l) => {
      const rawUrl = String(l.url || l.value || "").trim();
      const normalizedUrl =
        rawUrl && !/^https?:\/\//i.test(rawUrl) && /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(rawUrl)
          ? `https://${rawUrl}`
          : rawUrl;
      return {
        label: stripHtml(String(l.label || l.title || l.value || "")),
        url: normalizedUrl,
      };
    })
    .filter((l) => /^https?:\/\//i.test(l.url));

  // Unauthenticated Gravatar JSON API often omits links even when publicly listed on the profile page
  if (links.length === 0 && profileUrl) {
    links = await fetchHtmlProfileLinks(profileUrl);
  }

  return {
    hash,
    username,
    display_name: displayName,
    profile_url: profileUrl,
    avatar_url: avatarUrl,
    job_title: jobTitle,
    company,
    location,
    pronouns,
    description,
    background_color: safeHex,
    header_image: headerImage,
    verified_accounts: Array.from(accountsMap.values()),
    links,
  };
}

export async function resolveLinkedSitesFromGravatar(profile: GravatarProfile): Promise<
  Array<{
    site: SiteConfig;
    discovery: "rss" | "sitemap" | "page";
  }>
> {
  const candidates = new Map<string, { label: string; url: string }>();

  for (const link of profile.links) {
    if (!isWebsiteCandidateUrl(link.url)) continue;
    const normKey = link.url.replace(/\/+$/, "").toLowerCase();
    if (!candidates.has(normKey)) {
      candidates.set(normKey, { label: link.label || "", url: link.url });
    }
  }

  for (const acc of profile.verified_accounts) {
    if (!isWebsiteCandidateUrl(acc.url, acc.service_type)) continue;
    const normKey = acc.url.replace(/\/+$/, "").toLowerCase();
    if (!candidates.has(normKey)) {
      candidates.set(normKey, { label: acc.label || "", url: acc.url });
    }
  }

  const entries = Array.from(candidates.values()).slice(0, 8);
  if (entries.length === 0) return [];

  const handles = extractGravatarHandles(profile);
  const tagSet = new Set<string>(["blog", "gravatar"]);
  if (profile.company) {
    const cleanCo = profile.company.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (cleanCo && cleanCo.length <= 20) tagSet.add(cleanCo);
  }
  const defaultTags = Array.from(tagSet).slice(0, 4);

  const probed = await Promise.all(
    entries.map(async (entry) => {
      const probe = await probeWebsiteFeed(entry.url);
      let hostLabel = "";
      try {
        hostLabel = new URL(entry.url).hostname.replace(/^www\./i, "");
      } catch {
        hostLabel = entry.url;
      }
      const cleanName = (entry.label && !entry.label.startsWith("http") ? entry.label : probe.title || hostLabel).slice(0, 72);
      const idBase = slug(hostLabel || cleanName, 36) || `site-${Date.now()}`;
      const site: SiteConfig = {
        id: `grav-${slug(profile.username, 12)}-${idBase}`.slice(0, 48),
        name: cleanName,
        url: probe.url,
        feed: probe.feed,
        sitemap: probe.sitemap,
        brand_color: probe.brand_color || profile.background_color || "#1a73e8",
        accent_color: "#ff6d00",
        hashtags: defaultTags,
        handles,
        enabled: true,
        source: "gravatar",
      };
      return { site, discovery: probe.discovery };
    })
  );

  // Deduplicate by discovered feed URL / canonical URL
  const unique = new Map<string, { site: SiteConfig; discovery: "rss" | "sitemap" | "page" }>();
  for (const item of probed) {
    const key = (item.site.feed || item.site.sitemap || item.site.url).toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, item);
    }
  }

  return Array.from(unique.values());
}

export function gravatarToArticleAndSite(
  profile: GravatarProfile,
  baseSite?: SiteConfig
): { article: Article; site: SiteConfig } {
  const roleLine = [profile.job_title, profile.company ? `at ${profile.company}` : ""]
    .filter(Boolean)
    .join(" ");
  const title = roleLine ? `${profile.display_name} — ${roleLine}` : profile.display_name;

  const detailParts: string[] = [];
  if (profile.description) detailParts.push(profile.description);
  if (roleLine) detailParts.push(`Role: ${roleLine}.`);
  if (profile.location) detailParts.push(`Based in ${profile.location}.`);
  if (profile.verified_accounts.length > 0) {
    detailParts.push(
      `Verified profiles: ${profile.verified_accounts.map((a) => `${a.label} (${a.url})`).join(", ")}.`
    );
  }
  if (profile.links.length > 0) {
    detailParts.push(
      `Links: ${profile.links.map((l) => `${l.label || l.url}: ${l.url}`).join(", ")}.`
    );
  }

  const tagSet = new Set<string>(["gravatar", "profile"]);
  for (const acc of profile.verified_accounts.slice(0, 2)) {
    const clean = acc.label.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (clean) tagSet.add(clean);
  }
  if (profile.company) {
    const c = profile.company.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (c && c.length <= 18) tagSet.add(c);
  }

  const tags = Array.from(tagSet).slice(0, 4);

  const article: Article = {
    site: `Gravatar · ${profile.display_name}`,
    title,
    url: profile.profile_url,
    summary: stripHtml(detailParts.join(" "), 600),
    image: profile.avatar_url,
    published: Math.floor(Date.now() / 1000),
    guid: profile.profile_url,
    tags,
    key: keyFor("gravatar", profile.hash, profile.profile_url),
  };

  const site: SiteConfig = {
    id: baseSite?.id || `gravatar-${profile.username}`,
    name: `${profile.display_name} · Gravatar`,
    url: profile.profile_url,
    feed: "",
    sitemap: "",
    brand_color: profile.background_color || baseSite?.brand_color || "#1a73e8",
    accent_color: baseSite?.accent_color || "#ff8a00",
    hashtags: tags,
    handles: baseSite?.handles || extractGravatarHandles(profile),
    enabled: true,
    source: "gravatar",
  };

  return { article, site };
}
