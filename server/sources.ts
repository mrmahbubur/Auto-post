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

export function resolveRelativeUrl(base: string, href: string): string {
  const cleaned = decodeHtmlEntities(String(href || "")).trim();
  if (!cleaned || /^(?:javascript|data|mailto|tel|blob):/i.test(cleaned)) {
    return "";
  }
  try {
    const resolved = base ? new URL(cleaned, base) : new URL(cleaned);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return "";
    }
    return resolved.toString();
  } catch {
    return "";
  }
}

function parseHtmlAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(tag)) !== null) {
    const key = m[1].toLowerCase();
    const rawVal = m[2] ?? m[3] ?? m[4] ?? "";
    attrs[key] = decodeHtmlEntities(rawVal).trim();
  }
  return attrs;
}

export interface ExtractedHtmlMeta {
  title: string;
  siteName: string;
  description: string;
  image: string;
  themeColor: string;
  canonicalUrl: string;
  baseUrl: string;
  feeds: string[];
  sitemaps: string[];
}

export function extractHtmlMetadata(html: string, pageUrl: string): ExtractedHtmlMeta {
  const chunk = html.slice(0, 400_000);

  // Respect <base href="..."> when resolving relative meta/link URLs
  let baseUrl = pageUrl;
  const baseTag = chunk.match(/<base\b[^>]*>/i)?.[0];
  if (baseTag) {
    const baseHref = parseHtmlAttributes(baseTag).href;
    const resolvedBase = baseHref ? resolveRelativeUrl(pageUrl, baseHref) : "";
    if (resolvedBase) baseUrl = resolvedBase;
  }

  const metaValues = new Map<string, string>();
  const metaTags = chunk.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const attrs = parseHtmlAttributes(tag);
    const content = attrs.content || attrs.value || "";
    if (!content) continue;
    const keys = [attrs.property, attrs.name, attrs.itemprop]
      .filter(Boolean)
      .map((k) => k.toLowerCase());
    for (const key of keys) {
      if (!metaValues.has(key)) {
        metaValues.set(key, content);
      }
    }
  }

  const pickMeta = (keys: string[]): string => {
    for (const k of keys) {
      const val = metaValues.get(k);
      if (val && val.trim()) return val.trim();
    }
    return "";
  };

  let imageSrcLink = "";
  let canonicalUrl = "";
  const feeds: string[] = [];
  const sitemaps: string[] = [];

  const linkTags = chunk.match(/<link\b[^>]*>/gi) || [];
  for (const tag of linkTags) {
    const attrs = parseHtmlAttributes(tag);
    const relTokens = (attrs.rel || "").toLowerCase().split(/\s+/).filter(Boolean);
    const type = (attrs.type || "").toLowerCase();
    const href = attrs.href || "";
    if (!href) continue;

    const abs = resolveRelativeUrl(baseUrl, href);
    if (!abs) continue;

    if (relTokens.includes("canonical") && !canonicalUrl) {
      canonicalUrl = abs;
    } else if (relTokens.includes("image_src") && !imageSrcLink) {
      imageSrcLink = abs;
    } else if (
      relTokens.includes("alternate") &&
      (type.includes("rss") ||
        type.includes("atom") ||
        (/\bxml\b/.test(type) && /\b(rss|feed|atom)\b/i.test(`${attrs.title || ""} ${href}`)))
    ) {
      if (!feeds.includes(abs)) feeds.push(abs);
    } else if (relTokens.includes("sitemap")) {
      if (!sitemaps.includes(abs)) sitemaps.push(abs);
    }
  }

  const rawTitleTag = chunk.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  const docTitle = stripHtml(rawTitleTag, 180);

  const rawOgTitle = pickMeta(["og:title", "twitter:title"]);
  const title = rawOgTitle ? stripHtml(rawOgTitle, 180) : docTitle;

  const rawSiteName = pickMeta(["og:site_name", "application-name", "og:title", "twitter:title"]);
  const siteName = rawSiteName ? stripHtml(rawSiteName, 90) : stripHtml(rawTitleTag, 90);

  const rawDesc = pickMeta(["og:description", "twitter:description", "description"]);
  const description = rawDesc ? stripHtml(rawDesc, 600) : "";

  const rawImage = pickMeta([
    "og:image:secure_url",
    "og:image:url",
    "og:image",
    "twitter:image:src",
    "twitter:image",
    "image",
  ]);
  const image = (rawImage ? resolveRelativeUrl(baseUrl, rawImage) : "") || imageSrcLink;

  const rawTheme = pickMeta(["theme-color"]);
  const themeColor = /^#[0-9a-fA-F]{3,8}$/.test(rawTheme) ? rawTheme : "";

  return {
    title,
    siteName,
    description,
    image,
    themeColor,
    canonicalUrl,
    baseUrl,
    feeds,
    sitemaps,
  };
}

function extractImageFromEntry(entry: XmlNode, baseUrl = "", rawHtmlBody = ""): string {
  const mediaGroups = asNodes(entry["media:group"]);
  const mediaContents = asNodes(entry["media:content"]);
  const groupMediaContents = mediaGroups.flatMap((g) => asNodes(g["media:content"]));
  const linkNodes = asNodes(entry.link);
  const linkEnclosures = linkNodes.filter((l) => {
    const tokens = String(l["@_rel"] || "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return (
      tokens.includes("enclosure") ||
      tokens.includes("preview") ||
      tokens.includes("thumbnail") ||
      (tokens.includes("image") && /image/i.test(String(l["@_type"] || "")))
    );
  });
  const candidates: Array<{ node: unknown; isThumbnail: boolean }> = [
    // 1. Explicit thumbnail nodes take strict priority over generic media attachments
    ...toArray(entry["media:thumbnail"]).map((node) => ({ node, isThumbnail: true })),
    ...mediaGroups.flatMap((g) =>
      toArray(g["media:thumbnail"]).map((node) => ({ node, isThumbnail: true }))
    ),
    ...mediaContents.flatMap((mc) =>
      toArray(mc["media:thumbnail"]).map((node) => ({ node, isThumbnail: true }))
    ),
    ...groupMediaContents.flatMap((mc) =>
      toArray(mc["media:thumbnail"]).map((node) => ({ node, isThumbnail: true }))
    ),
    ...toArray(entry["itunes:image"]).map((node) => ({ node, isThumbnail: true })),
    ...toArray(entry.thumbnail).map((node) => ({ node, isThumbnail: true })),
    ...toArray(entry.featuredImage).map((node) => ({ node, isThumbnail: true })),
    ...toArray(entry.featured_image).map((node) => ({ node, isThumbnail: true })),
    ...toArray(entry.coverImage).map((node) => ({ node, isThumbnail: true })),
    ...toArray(entry.cover_image).map((node) => ({ node, isThumbnail: true })),
    // 2. Generic media content, enclosures, Atom enclosure links & image tags
    ...mediaContents.map((node) => ({ node, isThumbnail: false })),
    ...groupMediaContents.map((node) => ({ node, isThumbnail: false })),
    ...toArray(entry["enclosure"]).map((node) => ({ node, isThumbnail: false })),
    ...linkEnclosures.map((node) => ({ node, isThumbnail: false })),
    ...toArray(entry["image:image"]).map((node) => ({ node, isThumbnail: false })),
    ...toArray(entry.image).map((node) => ({ node, isThumbnail: false })),
    ...toArray(entry.poster).map((node) => ({ node, isThumbnail: false })),
    ...toArray(entry.photo).map((node) => ({ node, isThumbnail: false })),
  ];
  for (const { node: rawNode, isThumbnail } of candidates) {
    let rawUrl = "";
    let typ = "";
    if (typeof rawNode === "string") {
      rawUrl = rawNode.trim();
    } else if (rawNode && typeof rawNode === "object") {
      const c = rawNode as XmlNode;
      rawUrl = String(
        c["@_url"] ||
          c["@_href"] ||
          c["@_src"] ||
          textVal(c.url) ||
          textVal(c["image:loc"]) ||
          textVal(c.loc) ||
          textVal(c) ||
          ""
      ).trim();
      typ = String(c["@_type"] || c["@_medium"] || "");
    }
    if (
      rawUrl &&
      (isThumbnail ||
        /image/i.test(typ) ||
        /\.(png|jpe?g|webp|avif|heic|heif|gif|svg)(\?|#|$)/i.test(rawUrl))
    ) {
      const resolved = resolveRelativeUrl(baseUrl, rawUrl);
      if (resolved) return resolved;
    }
  }
  if (rawHtmlBody) {
    const htmlSource = /<(img|source|video)\b/i.test(rawHtmlBody)
      ? rawHtmlBody
      : decodeHtmlEntities(rawHtmlBody);
    const imgTags = htmlSource.match(/<img\b[^>]*>/gi) || [];
    for (const tag of imgTags) {
      const attrs = parseHtmlAttributes(tag);
      if (attrs.width === "1" || attrs.height === "1") continue;
      const srcsetFirst = attrs.srcset
        ? attrs.srcset.split(",")[0]?.trim().split(/\s+/)[0] || ""
        : "";
      const src =
        attrs.src ||
        attrs["data-src"] ||
        attrs["data-lazy-src"] ||
        attrs["data-original"] ||
        srcsetFirst;
      if (src) {
        const resolved = resolveRelativeUrl(baseUrl, src);
        if (resolved) return resolved;
      }
    }
    const sourceTags = htmlSource.match(/<source\b[^>]*>/gi) || [];
    for (const tag of sourceTags) {
      const attrs = parseHtmlAttributes(tag);
      const src = attrs.srcset
        ? attrs.srcset.split(",")[0]?.trim().split(/\s+/)[0] || ""
        : attrs.src || "";
      if (
        src &&
        (/image/i.test(attrs.type || "") ||
          /\.(png|jpe?g|webp|avif|gif|svg)(\?|#|$)/i.test(src))
      ) {
        const resolved = resolveRelativeUrl(baseUrl, src);
        if (resolved) return resolved;
      }
    }
    const videoTags = htmlSource.match(/<video\b[^>]*>/gi) || [];
    for (const tag of videoTags) {
      const poster = parseHtmlAttributes(tag).poster || "";
      if (poster) {
        const resolved = resolveRelativeUrl(baseUrl, poster);
        if (resolved) return resolved;
      }
    }
  }
  return "";
}

function extractLinkFromEntry(entry: XmlNode, baseUrl = ""): string {
  const rawLink = entry.link;
  if (typeof rawLink === "string" && rawLink.trim()) {
    const resolved = resolveRelativeUrl(baseUrl, rawLink.trim());
    if (resolved) return resolved;
  }
  for (const l of toArray(rawLink)) {
    if (typeof l === "string" && l.trim()) {
      const resolved = resolveRelativeUrl(baseUrl, l.trim());
      if (resolved) return resolved;
    }
    if (l && typeof l === "object") {
      const obj = l as XmlNode;
      const href = String(obj["@_href"] || "").trim();
      const rel = String(obj["@_rel"] || "alternate").trim();
      if (href && (rel === "alternate" || !rel)) {
        const resolved = resolveRelativeUrl(baseUrl, href);
        if (resolved) return resolved;
      }
      const txt = textVal(obj);
      if (txt) {
        const resolved = resolveRelativeUrl(baseUrl, txt);
        if (resolved) return resolved;
      }
    }
  }
  for (const obj of asNodes(rawLink)) {
    if (obj["@_href"]) {
      const resolved = resolveRelativeUrl(baseUrl, String(obj["@_href"]));
      if (resolved) return resolved;
    }
  }
  const id = textVal(entry.id);
  return id.startsWith("http") ? id : "";
}

export function parseFeed(xmlText: string, siteName: string, baseUrl = ""): Article[] {
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

  const channelLinkRaw = channel ? extractLinkFromEntry(channel, baseUrl) : "";
  const effectiveBase = channelLinkRaw || baseUrl;

  return entries.map((e) => {
    const url = extractLinkFromEntry(e, effectiveBase);
    const title = stripHtml(textVal(e.title)) || "(untitled)";
    const rawContentEncoded = textVal(e["content:encoded"]);
    const rawContent = textVal(e.content);
    const rawDescription = textVal(e.description);
    const rawSummary = textVal(e.summary);
    const rawDesc = rawContentEncoded || rawContent || rawDescription || rawSummary;
    const rawHtmlCombined = [rawContentEncoded, rawContent, rawDescription, rawSummary]
      .filter(Boolean)
      .join("\n");
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
      image: extractImageFromEntry(e, url || effectiveBase, rawHtmlCombined),
      published,
      guid,
      tags: cats,
      key: keyFor(siteName, guid || url, url),
    };
  });
}

export function parseSitemap(xmlText: string, siteName: string, baseUrl = ""): Article[] {
  const doc = xmlParser.parse(xmlText.trim()) as XmlNode;
  const urlset = (doc.urlset || doc) as XmlNode;
  const nodes = asNodes(urlset.url);

  const out: Article[] = [];
  for (const node of nodes) {
    const rawLoc = textVal(node.loc);
    const loc = resolveRelativeUrl(baseUrl, rawLoc) || rawLoc;
    if (!loc) continue;
    const lastmod = textVal(node.lastmod);
    const tail = loc.replace(/\/+$/, "").split("/").pop() || loc;
    const pretty = tail
      .replace(/\.(html?|php)$/i, "")
      .replace(/[-_]+/g, " ")
      .trim();
    const title = pretty ? pretty.replace(/\b\w/g, (c) => c.toUpperCase()) : loc;
    const sitemapImage = extractImageFromEntry(node, loc);
    out.push({
      site: siteName,
      title,
      url: loc,
      summary: "",
      image: sitemapImage,
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
    const finalUrl = res.url || art.url;
    const meta = extractHtmlMetadata(html, finalUrl);

    const image = art.image || meta.image;
    const summary = art.summary || meta.description;
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
  const baseUrl = site.url || sourceUrl;

  const isSitemap = Boolean(site.sitemap?.trim() && !site.feed?.trim()) || /<urlset[\s>]/i.test(xmlText);
  const items = isSitemap
    ? parseSitemap(xmlText, site.name, baseUrl)
    : parseFeed(xmlText, site.name, baseUrl);
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
      const finalUrl = res.url || url;
      const meta = extractHtmlMetadata(html, finalUrl);
      if (meta.title) art.title = meta.title;
      if (meta.description) art.summary = meta.description;
      if (meta.image) art.image = meta.image;
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
      const finalUrl = res.url || canonicalUrl;

      // Direct XML feed or sitemap URL passed on Gravatar
      if (
        contentType.includes("xml") ||
        /<rss[\s>]|<feed[\s>]|<rdf:RDF[\s>]/i.test(body.slice(0, 800))
      ) {
        return {
          url: origin,
          title,
          feed: finalUrl,
          sitemap: "",
          brand_color: "",
          discovery: "rss",
        };
      }
      if (/<urlset[\s>]/i.test(body.slice(0, 800))) {
        return {
          url: origin,
          title,
          feed: "",
          sitemap: finalUrl,
          brand_color: "",
          discovery: "sitemap",
        };
      }

      const meta = extractHtmlMetadata(body, finalUrl);
      if (meta.siteName) title = meta.siteName;
      if (meta.themeColor) brandColor = meta.themeColor;
      for (const f of meta.feeds) {
        if (!candidateFeeds.includes(f)) candidateFeeds.push(f);
      }
      for (const sm of meta.sitemaps) {
        if (!candidateSitemaps.includes(sm)) candidateSitemaps.push(sm);
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
    ...(hostPathBase !== origin
      ? [`${hostPathBase}/feed/`, `${hostPathBase}/rss.xml`, `${hostPathBase}/atom.xml`]
      : []),
    `${origin}/feed/`,
    `${origin}/feed`,
    `${origin}/rss.xml`,
    `${origin}/atom.xml`,
    `${origin}/feed.xml`,
    `${origin}/feed.atom`,
    `${origin}/index.xml`,
    `${origin}/rss`,
  ];
  for (const fp of fallbackFeedPaths) {
    if (!candidateFeeds.includes(fp)) candidateFeeds.push(fp);
  }
  for (const smPath of [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`]) {
    if (!candidateSitemaps.includes(smPath)) candidateSitemaps.push(smPath);
  }

  // Probe feed candidates in parallel
  const feedChecks = await Promise.all(
    candidateFeeds.slice(0, 10).map(async (u) => ({ url: u, kind: await verifyXmlFeedUrl(u) }))
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
    candidateSitemaps.slice(0, 3).map(async (u) => ({ url: u, kind: await verifyXmlFeedUrl(u) }))
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
