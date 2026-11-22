import { XMLParser } from "fast-xml-parser";
import type { Article, SiteConfig } from "./types.ts";
import { UA, decodeHtmlEntities, keyFor, stripHtml } from "./util.ts";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
  parseTagValue: false,
});

type XmlNode = Record<string, unknown>;

function toArray(val: unknown): unknown[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

function asNodes(val: unknown): XmlNode[] {
  return toArray(val).filter((x): x is XmlNode => Boolean(x) && typeof x === "object");
}

function textVal(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node).trim();
  if (typeof node === "object") {
    const obj = node as XmlNode;
    if ("#text" in obj && obj["#text"] != null) return String(obj["#text"]).trim();
    if ("__cdata" in obj && obj["__cdata"] != null) return String(obj["__cdata"]).trim();
  }
  return "";
}

function parseDateSec(raw: string): number {
  if (!raw) return 0;
  const ms = Date.parse(raw.trim());
  if (!Number.isNaN(ms)) return Math.floor(ms / 1000);
  return 0;
}

function extractImageFromEntry(entry: XmlNode): string {
  const candidates = [
    ...asNodes(entry["media:content"]),
    ...asNodes(entry["media:thumbnail"]),
    ...asNodes(entry["enclosure"]),
  ];
  for (const c of candidates) {
    const url = String(c["@_url"] || "");
    const typ = String(c["@_type"] || c["@_medium"] || "");
    if (url && (/image/i.test(typ) || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url))) {
      return url;
    }
  }
  const itunesImg = entry["itunes:image"] as XmlNode | undefined;
  if (itunesImg && typeof itunesImg === "object" && itunesImg["@_href"]) {
    return String(itunesImg["@_href"]);
  }
  return "";
}

function extractLinkFromEntry(entry: XmlNode): string {
  const rawLink = entry.link;
  if (typeof rawLink === "string" && rawLink.startsWith("http")) return rawLink.trim();
  for (const l of toArray(rawLink)) {
    if (typeof l === "string" && l.startsWith("http")) return l.trim();
    if (l && typeof l === "object") {
      const obj = l as XmlNode;
      const href = String(obj["@_href"] || "");
      const rel = String(obj["@_rel"] || "alternate");
      if (href && (rel === "alternate" || !rel)) return href;
    }
  }
  for (const obj of asNodes(rawLink)) {
    if (obj["@_href"]) return String(obj["@_href"]);
  }
  const id = textVal(entry.id);
  return id.startsWith("http") ? id : "";
}

export function parseFeed(xmlText: string, siteName: string): Article[] {
  const doc = xmlParser.parse(xmlText.trim()) as XmlNode;
  let entries: XmlNode[] = [];

  const rss = doc.rss as XmlNode | undefined;
  const channel = (rss?.channel || doc.channel || (doc["rdf:RDF"] as XmlNode | undefined)) as
    | XmlNode
    | undefined;
  if (channel?.item) {
    entries = asNodes(channel.item);
  } else if (doc.feed && typeof doc.feed === "object") {
    const feed = doc.feed as XmlNode;
    entries = asNodes(feed.entry);
  }

  return entries.map((e) => {
    const url = extractLinkFromEntry(e);
    const title = stripHtml(textVal(e.title)) || "(untitled)";
    const rawDesc =
      textVal(e["content:encoded"]) ||
      textVal(e.content) ||
      textVal(e.description) ||
      textVal(e.summary);
    const summary = stripHtml(rawDesc, 600);
    const guid = textVal(e.guid) || textVal(e.id) || url;
    const pubRaw = textVal(e.pubDate) || textVal(e.published) || textVal(e.updated) || textVal(e["dc:date"]);
    const published = parseDateSec(pubRaw);
    const cats = toArray(e.category)
      .map((c) => {
        if (typeof c === "string") return c.trim();
        if (c && typeof c === "object") {
          const rec = c as XmlNode;
          return String(rec["@_term"] || textVal(rec) || "").trim();
        }
        return "";
      })
      .filter(Boolean);

    return {
      site: siteName,
      title,
      url,
      summary,
      image: extractImageFromEntry(e),
      published,
      guid,
      tags: cats,
      key: keyFor(siteName, guid || url, url),
    };
  });
}

export function parseSitemap(xmlText: string, siteName: string): Article[] {
  const doc = xmlParser.parse(xmlText.trim()) as XmlNode;
  const urlset = (doc.urlset || doc) as XmlNode;
  const nodes = asNodes(urlset.url);

  const out: Article[] = [];
  for (const node of nodes) {
    const loc = textVal(node.loc);
    if (!loc) continue;
    const lastmod = textVal(node.lastmod);
    const tail = loc.replace(/\/+$/, "").split("/").pop() || loc;
    const pretty = tail
      .replace(/\.(html?|php)$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
    const title = pretty ? pretty.replace(/\b\w/g, (c) => c.toUpperCase()) : loc;
    out.push({
      site: siteName,
      title,
      url: loc,
      summary: "",
      image: "",
      published: parseDateSec(lastmod),
      guid: loc,
      tags: [],
      key: keyFor(siteName, loc, loc),
    });
  }
  return out;
}

export async function enrichFromPage(art: Article): Promise<Article> {
  if ((art.image && art.summary) || !art.url.startsWith("http")) {
    return art;
  }
  try {
    const res = await fetch(art.url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return art;
    const html = (await res.text()).slice(0, 400_000);
    let image = art.image;
    let summary = art.summary;

    if (!image) {
      const patterns = [
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
        /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      ];
      for (const pat of patterns) {
        const m = html.match(pat);
        if (m?.[1]) {
          image = resolveRelativeUrl(art.url, m[1]) || decodeHtmlEntities(m[1]).trim();
          break;
        }
      }
    }
    if (!summary) {
      const m = html.match(
        /<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]+content=["']([^"']+)["']/i
      );
      if (m?.[1]) {
        summary = stripHtml(m[1], 600);
      }
    }
    return { ...art, image, summary };
  } catch {
    return art;
  }
}

export async function discover(site: SiteConfig, lookbackDays = 30, limit = 5): Promise<Article[]> {
  const sourceUrl = site.feed?.trim() || site.sitemap?.trim();
  if (!sourceUrl) {
    if (site.url && /^https?:\/\//i.test(site.url)) {
      const pageArt = await discoverUrl(site.url, site);
      return [pageArt];
    }
    return [];
  }

  if (!sourceUrl.startsWith("http://") && !sourceUrl.startsWith("https://")) {
    throw new Error("Feed or sitemap URL must start with http:// or https://");
  }

  const res = await fetch(sourceUrl, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(18000),
  });
  if (!res.ok) {
    throw new Error(`Feed fetch failed (${res.status} ${res.statusText})`);
  }
  const xmlText = await res.text();

  const isSitemap = Boolean(site.sitemap?.trim() && !site.feed?.trim()) || /<urlset[\s>]/i.test(xmlText);
  const items = isSitemap ? parseSitemap(xmlText, site.name) : parseFeed(xmlText, site.name);
  const cutoff = Math.floor(Date.now() / 1000) - lookbackDays * 86400;

  return items
    .filter((a) => a.url && (a.published === 0 || a.published >= cutoff))
    .sort((a, b) => b.published - a.published)
    .slice(0, limit);
}

export async function discoverUrl(url: string, site: SiteConfig): Promise<Article> {
  const art: Article = {
    site: site.name,
    title: url,
    url,
    summary: "",
    image: "",
    published: Math.floor(Date.now() / 1000),
    guid: url,
    tags: site.hashtags || [],
    key: keyFor(site.name, url, url),
  };

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const html = (await res.text()).slice(0, 400_000);
      const ogTitle =
        html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] ||
        html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
      if (ogTitle) art.title = stripHtml(ogTitle, 180);

      const ogDesc =
        html.match(/<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:og:)?description["']/i)?.[1];
      if (ogDesc) art.summary = stripHtml(ogDesc, 600);

      const ogImg =
        html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1] ||
        html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i)?.[1];
      if (ogImg) art.image = resolveRelativeUrl(url, ogImg) || decodeHtmlEntities(ogImg);
    }
  } catch {
    // Keep URL fallback
  }

  return art;
}

export interface ProbedSiteFeed {
  url: string;
  title: string;
  feed: string;
  sitemap: string;
  brand_color: string;
  discovery: "rss" | "sitemap" | "page";
}

function resolveRelativeUrl(base: string, href: string): string {
  try {
    return new URL(decodeHtmlEntities(href), base).toString();
  } catch {
    return "";
  }
}

async function verifyXmlFeedUrl(url: string): Promise<"rss" | "sitemap" | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(6500),
    });
    if (!res.ok) return null;
    const text = (await res.text()).slice(0, 200_000);
    if (/<rss[\s>]|<feed[\s>]|<rdf:RDF[\s>]/i.test(text)) {
      return "rss";
    }
    if (/<urlset[\s>]/i.test(text)) {
      return "sitemap";
    }
    return null;
  } catch {
    return null;
  }
}

export async function probeWebsiteFeed(rawUrl: string): Promise<ProbedSiteFeed> {
  const parsedUrl = new URL(rawUrl);
  const canonicalUrl = parsedUrl.toString();
  const origin = parsedUrl.origin;

  let title = parsedUrl.hostname.replace(/^www\./i, "");
  let brandColor = "";
  const candidateFeeds: string[] = [];
  const candidateSitemaps: string[] = [];

  try {
    const res = await fetch(canonicalUrl, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const contentType = res.headers.get("content-type") || "";
      const body = (await res.text()).slice(0, 260_000);

      // Direct XML URL passed on Gravatar
      if (contentType.includes("xml") || /<rss[\s>]|<feed[\s>]/i.test(body.slice(0, 600))) {
        return {
          url: origin,
          title,
          feed: canonicalUrl,
          sitemap: "",
          brand_color: "",
          discovery: "rss",
        };
      }

      const rawTitle =
        body.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
        body.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
        body.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
      if (rawTitle) {
        const cleaned = stripHtml(rawTitle, 90);
        if (cleaned) title = cleaned;
      }

      const theme = body.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["'](#[0-9a-fA-F]{3,6})["']/i)?.[1];
      if (theme) brandColor = theme;

      // Extract <link rel="alternate" type="application/rss+xml|atom+xml" href="...">
      const linkTags = body.match(/<link\b[^>]*>/gi) || [];
      for (const tag of linkTags) {
        const rel = tag.match(/rel=["']([^"']+)["']/i)?.[1]?.toLowerCase() || "";
        const type = tag.match(/type=["']([^"']+)["']/i)?.[1]?.toLowerCase() || "";
        const href = tag.match(/href=["']([^"']+)["']/i)?.[1] || "";
        if (!href) continue;
        const abs = resolveRelativeUrl(canonicalUrl, href);
        if (!abs) continue;
        if (rel.includes("alternate") && (type.includes("rss") || type.includes("atom"))) {
          if (!candidateFeeds.includes(abs)) candidateFeeds.push(abs);
        } else if (rel.includes("sitemap")) {
          if (!candidateSitemaps.includes(abs)) candidateSitemaps.push(abs);
        }
      }
    }
  } catch {
    // Continue to standard feed path probes
  }

  // Standard blog feed paths on the same origin / host
  const hostPathBase = `${origin}${parsedUrl.pathname.replace(/\/+$/, "")}`;
  const fallbackFeedPaths = [
    ...(parsedUrl.hostname.endsWith("medium.com") && parsedUrl.pathname.length > 1
      ? [`${origin}/feed${parsedUrl.pathname}`]
      : []),
    ...(hostPathBase !== origin ? [`${hostPathBase}/feed/`, `${hostPathBase}/rss.xml`] : []),
    `${origin}/feed/`,
    `${origin}/feed`,
    `${origin}/rss.xml`,
    `${origin}/atom.xml`,
    `${origin}/feed.xml`,
    `${origin}/index.xml`,
    `${origin}/rss`,
  ];
  for (const fp of fallbackFeedPaths) {
    if (!candidateFeeds.includes(fp)) candidateFeeds.push(fp);
  }
  if (!candidateSitemaps.includes(`${origin}/sitemap.xml`)) {
    candidateSitemaps.push(`${origin}/sitemap.xml`);
  }

  // Probe up to 6 feed candidates in parallel
  const feedChecks = await Promise.all(
    candidateFeeds.slice(0, 6).map(async (u) => ({ url: u, kind: await verifyXmlFeedUrl(u) }))
  );
  const validFeed = feedChecks.find((c) => c.kind === "rss");
  if (validFeed) {
    return {
      url: canonicalUrl,
      title,
      feed: validFeed.url,
      sitemap: "",
      brand_color: brandColor,
      discovery: "rss",
    };
  }

  const sitemapChecks = await Promise.all(
    candidateSitemaps.slice(0, 2).map(async (u) => ({ url: u, kind: await verifyXmlFeedUrl(u) }))
  );
  const validSitemap = sitemapChecks.find((c) => c.kind === "sitemap");
  if (validSitemap) {
    return {
      url: canonicalUrl,
      title,
      feed: "",
      sitemap: validSitemap.url,
      brand_color: brandColor,
      discovery: "sitemap",
    };
  }

  return {
    url: canonicalUrl,
    title,
    feed: "",
    sitemap: "",
    brand_color: brandColor,
    discovery: "page",
  };
}
