import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getSecret } from "./db.ts";
import type { Article, CopyDeck, SiteConfig } from "./types.ts";
import { UA, stripHtml } from "./util.ts";

export interface PublishResult {
  url: string;
  id: string;
}

export function textForPlatform(copyKey: string, copy: CopyDeck, article: Article): string {
  if (copyKey === "reddit") return copy.reddit_title || article.title;
  if (copyKey === "devto") return copy.devto_title || article.title;
  if (copyKey === "pinterest") return copy.pinterest || copy.facebook_page || article.title;
  const val = (copy as unknown as Record<string, unknown>)[copyKey];
  if (typeof val === "string" && val.trim()) return val;
  return copy.facebook_page || article.title;
}

export function computeBlueskyFacets(text: string): Array<Record<string, unknown>> {
  const facets: Array<Record<string, unknown>> = [];
  const urlRe = /(https?:\/\/[^\s<>"]+)/g;
  let m: RegExpExecArray | null;

  while ((m = urlRe.exec(text)) !== null) {
    const start = Buffer.byteLength(text.slice(0, m.index), "utf8");
    const end = Buffer.byteLength(text.slice(0, m.index + m[0].length), "utf8");
    facets.push({
      index: { byteStart: start, byteEnd: end },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: m[1] }],
    });
  }

  const tagRe = /#(\w{1,40})/g;
  while ((m = tagRe.exec(text)) !== null) {
    const start = Buffer.byteLength(text.slice(0, m.index), "utf8");
    const end = Buffer.byteLength(text.slice(0, m.index + m[0].length), "utf8");
    facets.push({
      index: { byteStart: start, byteEnd: end },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag: m[1] }],
    });
  }

  return facets;
}

function pctEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function buildOAuth1Header(
  method: string,
  url: string,
  params: Record<string, string> = {},
  userId?: string
): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: getSecret("X_API_KEY", userId),
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: getSecret("X_ACCESS_TOKEN", userId),
    oauth_version: "1.0",
  };
  const allParams: Record<string, string> = { ...params, ...oauth };
  const norm = Object.keys(allParams)
    .sort()
    .map((k) => `${pctEncode(k)}=${pctEncode(allParams[k])}`)
    .join("&");
  const base = `${method.toUpperCase()}&${pctEncode(url)}&${pctEncode(norm)}`;
  const key = `${pctEncode(getSecret("X_API_SECRET", userId))}&${pctEncode(getSecret("X_ACCESS_SECRET", userId))}`;
  oauth.oauth_signature = crypto.createHmac("sha1", key).update(base).digest("base64");

  return (
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${pctEncode(k)}="${pctEncode(oauth[k])}"`)
      .join(", ")
  );
}

async function publishBluesky(
  text: string,
  imagePath: string | null,
  article: Article,
  userId?: string
): Promise<PublishResult> {
  const PDS = "https://bsky.social/xrpc";
  const handle = getSecret("BSKY_HANDLE", userId);
  const password = getSecret("BSKY_APP_PASSWORD", userId);

  const sessRes = await fetch(`${PDS}/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ identifier: handle, password }),
    signal: AbortSignal.timeout(25000),
  });
  if (!sessRes.ok) {
    throw new Error(`Bluesky login failed (${sessRes.status}): ${(await sessRes.text()).slice(0, 200)}`);
  }
  const sess = (await sessRes.json()) as { accessJwt: string; did: string };

  const record: Record<string, unknown> = {
    $type: "app.bsky.feed.post",
    text,
    langs: ["en"],
    createdAt: new Date().toISOString(),
    facets: computeBlueskyFacets(text),
  };

  if (imagePath && fs.existsSync(imagePath)) {
    try {
      const imgBuf = fs.readFileSync(imagePath);
      const blobRes = await fetch(`${PDS}/com.atproto.repo.uploadBlob`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sess.accessJwt}`,
          "Content-Type": "image/png",
          "User-Agent": UA,
        },
        body: imgBuf,
        signal: AbortSignal.timeout(45000),
      });
      if (blobRes.ok) {
        const blobData = (await blobRes.json()) as { blob: unknown };
        record.embed = {
          $type: "app.bsky.embed.images",
          images: [{ alt: stripHtml(article.title, 280), image: blobData.blob }],
        };
      }
    } catch {
      // Skip image if blob upload fails
    }
  }

  const postRes = await fetch(`${PDS}/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sess.accessJwt}`,
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify({
      repo: sess.did,
      collection: "app.bsky.feed.post",
      record,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!postRes.ok) {
    throw new Error(`Bluesky createRecord failed (${postRes.status}): ${(await postRes.text()).slice(0, 240)}`);
  }
  const postData = (await postRes.json()) as { uri: string };
  const rkey = postData.uri.split("/").pop() || "";
  return {
    url: `https://bsky.app/profile/${handle.replace(/^@/, "")}/post/${rkey}`,
    id: postData.uri,
  };
}

async function publishMastodon(
  text: string,
  imagePath: string | null,
  article: Article,
  cfg: Record<string, unknown>,
  userId?: string
): Promise<PublishResult> {
  const base = String(cfg.instance || "https://mastodon.social").replace(/\/+$/, "");
  const token = getSecret("MASTODON_TOKEN", userId);
  let mediaId = "";

  if (imagePath && fs.existsSync(imagePath)) {
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(imagePath)], { type: "image/png" }), path.basename(imagePath));
    form.append("description", stripHtml(article.title, 300));
    const mediaRes = await fetch(`${base}/api/v2/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "User-Agent": UA },
      body: form,
      signal: AbortSignal.timeout(45000),
    });
    if (mediaRes.ok) {
      const mData = (await mediaRes.json()) as { id?: string };
      mediaId = String(mData.id || "");
    }
  }

  const payload: Record<string, unknown> = { status: text, visibility: "public" };
  if (mediaId) payload.media_ids = [mediaId];

  const res = await fetch(`${base}/api/v1/statuses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`Mastodon failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { url?: string; id?: string };
  return { url: data.url || "", id: String(data.id || "") };
}

async function publishTelegram(
  text: string,
  imagePath: string | null,
  cfg: Record<string, unknown>,
  userId?: string
): Promise<PublishResult> {
  const token = getSecret("TELEGRAM_BOT_TOKEN", userId);
  const chatId = String(cfg.chat_id || "@your_channel");
  let res: Response;

  if (imagePath && fs.existsSync(imagePath)) {
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("caption", text.slice(0, 1024));
    form.append("parse_mode", "HTML");
    form.append("photo", new Blob([fs.readFileSync(imagePath)], { type: "image/png" }), path.basename(imagePath));
    res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(45000),
    });
  } else {
    res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096), disable_web_page_preview: false }),
      signal: AbortSignal.timeout(30000),
    });
  }

  const body = (await res.json()) as { ok?: boolean; description?: string; result?: { message_id?: number } };
  if (!body.ok) {
    throw new Error(`Telegram failed: ${body.description || res.statusText}`);
  }
  const mid = body.result?.message_id ?? "";
  return {
    url: `https://t.me/${chatId.replace(/^@/, "")}/${mid}`,
    id: String(mid),
  };
}

async function publishDiscord(
  text: string,
  imagePath: string | null,
  imageUrl: string,
  article: Article,
  site: SiteConfig,
  userId?: string
): Promise<PublishResult> {
  const webhookUrl = getSecret("DISCORD_WEBHOOK_URL", userId);
  const colorInt = parseInt((site.brand_color || "#1a73e8").replace(/^#/, ""), 16) || 0x1a73e8;
  const embed: Record<string, unknown> = {
    title: stripHtml(article.title, 240),
    url: article.url,
    description: stripHtml(article.summary, 300),
    color: colorInt,
    footer: { text: site.name },
  };
  if (imageUrl) embed.image = { url: imageUrl };

  let res: Response;
  if (imagePath && fs.existsSync(imagePath) && !imageUrl) {
    const form = new FormData();
    form.append("payload_json", JSON.stringify({ content: text, embeds: [embed] }));
    form.append("files[0]", new Blob([fs.readFileSync(imagePath)], { type: "image/png" }), path.basename(imagePath));
    res = await fetch(webhookUrl, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(45000),
    });
  } else {
    res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text, embeds: [embed] }),
      signal: AbortSignal.timeout(30000),
    });
  }

  if (!res.ok) {
    throw new Error(`Discord webhook failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  return { url: article.url, id: res.headers.get("x-message-id") || "" };
}

async function publishReddit(
  text: string,
  article: Article,
  cfg: Record<string, unknown>,
  userId?: string
): Promise<PublishResult> {
  const clientId = getSecret("REDDIT_CLIENT_ID", userId);
  const clientSecret = getSecret("REDDIT_CLIENT_SECRET", userId);
  const username = getSecret("REDDIT_USERNAME", userId);
  const password = getSecret("REDDIT_PASSWORD", userId);
  const ua = getSecret("REDDIT_USER_AGENT", userId) || UA;

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const tokRes = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "User-Agent": ua,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "password", username, password }),
    signal: AbortSignal.timeout(30000),
  });
  const tokData = (await tokRes.json()) as { access_token?: string };
  if (!tokRes.ok || !tokData.access_token) {
    throw new Error(`Reddit token failed (${tokRes.status})`);
  }

  const subs = Array.isArray(cfg.subreddits) && cfg.subreddits.length ? cfg.subreddits.map(String) : ["test"];
  const urls: string[] = [];

  for (const sub of subs) {
    const params = new URLSearchParams({
      sr: sub,
      kind: "link",
      title: text,
      url: article.url,
      api_type: "json",
      resubmit: "false",
      sendreplies: "false",
    });
    if (cfg.flair_id) params.set("flair_id", String(cfg.flair_id));

    const subRes = await fetch("https://oauth.reddit.com/api/submit", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokData.access_token}`,
        "User-Agent": ua,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
      signal: AbortSignal.timeout(30000),
    });
    const body = (await subRes.json()) as { json?: { errors?: unknown[]; data?: { url?: string } } };
    const errs = body.json?.errors || [];
    if (!subRes.ok || errs.length > 0) {
      throw new Error(`r/${sub} submit failed: ${JSON.stringify(errs)}`);
    }
    if (body.json?.data?.url) urls.push(body.json.data.url);
  }

  return { url: urls.join(", "), id: "" };
}

async function publishFacebookPage(
  text: string,
  imagePath: string | null,
  cfg: Record<string, unknown>,
  userId?: string
): Promise<PublishResult> {
  const GRAPH = "https://graph.facebook.com/v21.0";
  const pageId = String(cfg.page_id || getSecret("FB_PAGE_ID", userId) || "").trim();
  const token = getSecret("FB_PAGE_TOKEN", userId);
  if (!pageId) throw new Error("Facebook page_id missing in platform config or secrets");

  let res: Response;
  if (imagePath && fs.existsSync(imagePath)) {
    const form = new FormData();
    form.append("message", text);
    form.append("access_token", token);
    form.append("published", "true");
    form.append("source", new Blob([fs.readFileSync(imagePath)], { type: "image/png" }), path.basename(imagePath));
    res = await fetch(`${GRAPH}/${pageId}/photos`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60000),
    });
  } else {
    res = await fetch(`${GRAPH}/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message: text, access_token: token }),
      signal: AbortSignal.timeout(30000),
    });
  }

  const body = (await res.json()) as { post_id?: string; id?: string; error?: { message?: string } };
  if (!res.ok || body.error) {
    throw new Error(`Facebook error: ${body.error?.message || res.statusText}`);
  }
  const pid = body.post_id || body.id || "";
  return { url: pid ? `https://www.facebook.com/${pid}` : "", id: pid };
}

async function publishLinkedIn(
  text: string,
  imagePath: string | null,
  article: Article,
  cfg: Record<string, unknown>,
  userId?: string
): Promise<PublishResult> {
  const API = "https://api.linkedin.com";
  const author = String(cfg.author_urn || "").trim();
  if (!author) throw new Error("LinkedIn author_urn missing in platform config");

  const token = getSecret("LINKEDIN_TOKEN", userId);
  const hdr: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": "202411",
    "X-Restli-Protocol-Version": "2.0.0",
    "Content-Type": "application/json",
  };

  let imageUrn = "";
  if (imagePath && fs.existsSync(imagePath)) {
    const initRes = await fetch(`${API}/rest/images?action=initializeUpload`, {
      method: "POST",
      headers: hdr,
      body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
      signal: AbortSignal.timeout(30000),
    });
    if (initRes.ok) {
      const initData = (await initRes.json()) as { value: { uploadUrl: string; image: string } };
      const putRes = await fetch(initData.value.uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
        },
        body: fs.readFileSync(imagePath),
        signal: AbortSignal.timeout(60000),
      });
      if (putRes.ok) imageUrn = initData.value.image;
    }
  }

  const shareContent: Record<string, unknown> = {
    shareCommentary: { text },
    shareMediaCategory: imageUrn ? "IMAGE" : "NONE",
  };
  if (imageUrn) {
    shareContent.media = [
      {
        status: "READY",
        media: imageUrn,
        description: { text: stripHtml(article.title, 200) },
      },
    ];
  }

  const res = await fetch(`${API}/v2/ugcPosts`, {
    method: "POST",
    headers: hdr,
    body: JSON.stringify({
      author,
      lifecycleState: "PUBLISHED",
      specificContent: { "com.linkedin.ugc.ShareContent": shareContent },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`LinkedIn failed (${res.status}): ${(await res.text()).slice(0, 220)}`);
  }
  const data = (await res.json()) as { id?: string };
  const urn = res.headers.get("x-restli-id") || data.id || "";
  return { url: urn ? `https://www.linkedin.com/feed/update/${urn}/` : "", id: urn };
}

async function publishDevTo(
  text: string,
  imageUrl: string,
  article: Article,
  site: SiteConfig,
  copy: CopyDeck,
  userId?: string
): Promise<PublishResult> {
  const parts: string[] = [];
  if (imageUrl) parts.push(`![${article.title}](${imageUrl})`);
  parts.push(article.summary || article.title);
  parts.push(`**Read the full post ->** [${article.title}](${article.url})`);
  const body = `${parts.join("\n\n")}\n\n---\n\n_Originally published at [${site.name}](${article.url})._`;

  const payload = {
    article: {
      title: text.slice(0, 100),
      published: true,
      body_markdown: body,
      tags: (site.hashtags || []).map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20)).filter(Boolean).slice(0, 4),
      description: copy.devto_description || (article.summary ? article.summary.slice(0, 140) : article.title.slice(0, 140)),
      canonical_url: article.url,
      cover_image: imageUrl || null,
    },
  };

  const res = await fetch("https://dev.to/api/articles", {
    method: "POST",
    headers: {
      "api-key": getSecret("DEVTO_API_KEY", userId),
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`Dev.to failed (${res.status}): ${(await res.text()).slice(0, 240)}`);
  }
  const d = (await res.json()) as { url?: string; id?: number };
  return { url: d.url || "", id: String(d.id || "") };
}

async function publishX(text: string, imagePath: string | null, userId?: string): Promise<PublishResult> {
  const mediaIds: string[] = [];
  if (imagePath && fs.existsSync(imagePath)) {
    const upUrl = "https://upload.twitter.com/1.1/media/upload.json";
    const auth = buildOAuth1Header("POST", upUrl, {}, userId);
    const form = new FormData();
    form.append("media", new Blob([fs.readFileSync(imagePath)], { type: "image/png" }), path.basename(imagePath));
    const upRes = await fetch(upUrl, {
      method: "POST",
      headers: { Authorization: auth, "User-Agent": UA },
      body: form,
      signal: AbortSignal.timeout(45000),
    });
    if (upRes.ok) {
      const m = (await upRes.json()) as { media_id_string?: string };
      if (m.media_id_string) mediaIds.push(m.media_id_string);
    }
  }

  const tweetUrl = "https://api.twitter.com/2/tweets";
  const payload: Record<string, unknown> = { text };
  if (mediaIds.length > 0) payload.media = { media_ids: mediaIds };

  const res = await fetch(tweetUrl, {
    method: "POST",
    headers: {
      Authorization: buildOAuth1Header("POST", tweetUrl, {}, userId),
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`X API failed (${res.status}): ${(await res.text()).slice(0, 240)}`);
  }
  const data = (await res.json()) as { data?: { id?: string } };
  const tid = data.data?.id || "";
  return { url: tid ? `https://x.com/i/web/status/${tid}` : "", id: tid };
}

async function publishThreads(
  text: string,
  imageUrl: string,
  site: SiteConfig,
  cfg: Record<string, unknown>,
  userId?: string
): Promise<PublishResult> {
  const BASE = "https://graph.threads.net/v1.0";
  const uid = String(cfg.user_id || "me");
  const token = getSecret("THREADS_TOKEN", userId);
  const params = new URLSearchParams({
    media_type: imageUrl ? "IMAGE" : "TEXT",
    text,
    access_token: token,
  });
  if (imageUrl) params.set("image_url", imageUrl);

  const cRes = await fetch(`${BASE}/${uid}/threads`, {
    method: "POST",
    body: params,
    signal: AbortSignal.timeout(45000),
  });
  if (!cRes.ok) {
    throw new Error(`Threads container failed (${cRes.status}): ${(await cRes.text()).slice(0, 200)}`);
  }
  const cData = (await cRes.json()) as { id: string };
  await new Promise((r) => setTimeout(r, 8000));

  const pRes = await fetch(`${BASE}/${uid}/threads_publish`, {
    method: "POST",
    body: new URLSearchParams({ creation_id: cData.id, access_token: token }),
    signal: AbortSignal.timeout(45000),
  });
  if (!pRes.ok) {
    throw new Error(`Threads publish failed (${pRes.status}): ${(await pRes.text()).slice(0, 200)}`);
  }
  const pData = (await pRes.json()) as { id?: string };
  const handle = site.handles?.threads || "";
  return { url: handle ? `https://www.threads.net/@${handle}` : "", id: pData.id || "" };
}

async function publishPinterest(
  text: string,
  imageUrl: string,
  article: Article,
  cfg: Record<string, unknown>,
  copy: CopyDeck,
  userId?: string
): Promise<PublishResult> {
  const boardId = String(cfg.board_id || getSecret("PINTEREST_BOARD_ID", userId) || "").trim();
  if (!boardId || !imageUrl) {
    throw new Error("Pinterest board_id and a public image URL (media_host) are required");
  }
  const apiBase = String(cfg.api_base || "https://api.pinterest.com").replace(/\/+$/, "");
  const res = await fetch(`${apiBase}/v5/pins`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getSecret("PINTEREST_TOKEN", userId)}`,
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify({
      board_id: boardId,
      title: stripHtml(article.title, 95),
      description: text.slice(0, 480),
      alt_text: stripHtml(copy.hook || article.title, 480),
      link: article.url,
      media_source: { source_type: "image_url", url: imageUrl },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    throw new Error(`Pinterest failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const d = (await res.json()) as { id?: string };
  return { url: d.id ? `https://www.pinterest.com/pin/${d.id}/` : "", id: String(d.id || "") };
}

export async function publishToPlatform(
  platformName: string,
  text: string,
  imagePath: string | null,
  imageUrl: string,
  article: Article,
  site: SiteConfig,
  cfg: Record<string, unknown>,
  copy: CopyDeck,
  userId?: string
): Promise<PublishResult> {
  switch (platformName) {
    case "bluesky":
      return publishBluesky(text, imagePath, article, userId);
    case "mastodon":
      return publishMastodon(text, imagePath, article, cfg, userId);
    case "telegram":
      return publishTelegram(text, imagePath, cfg, userId);
    case "discord":
      return publishDiscord(text, imagePath, imageUrl, article, site, userId);
    case "reddit":
      return publishReddit(text, article, cfg, userId);
    case "facebook_page":
      return publishFacebookPage(text, imagePath, cfg, userId);
    case "linkedin":
      return publishLinkedIn(text, imagePath, article, cfg, userId);
    case "devto":
      return publishDevTo(text, imageUrl, article, site, copy, userId);
    case "x":
      return publishX(text, imagePath, userId);
    case "threads":
      return publishThreads(text, imageUrl, site, cfg, userId);
    case "pinterest":
      return publishPinterest(text, imageUrl, article, cfg, copy, userId);
    default:
      throw new Error(`Unsupported platform: ${platformName}`);
  }
}

export async function verifyPlatformCredentials(
  platformName: string,
  cfg: Record<string, unknown>,
  userId?: string
): Promise<{ detail: string }> {
  switch (platformName) {
    case "bluesky": {
      const identifier = getSecret("BSKY_HANDLE", userId);
      const password = getSecret("BSKY_APP_PASSWORD", userId);
      if (!identifier || !password) throw new Error("BSKY_HANDLE and BSKY_APP_PASSWORD are required.");
      const res = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": UA },
        body: JSON.stringify({ identifier, password }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`Bluesky auth failed (${res.status}): ${(await res.text()).slice(0, 160)}`);
      const d = (await res.json()) as { handle?: string; did?: string };
      return { detail: `Authenticated as @${d.handle || identifier}` };
    }
    case "mastodon": {
      const base = String(cfg.instance || "").replace(/\/+$/, "");
      const token = getSecret("MASTODON_TOKEN", userId);
      if (!base || !token) throw new Error("Mastodon instance URL and MASTODON_TOKEN are required.");
      const res = await fetch(`${base}/api/v1/accounts/verify_credentials`, {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": UA },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`Mastodon verify failed (${res.status})`);
      const d = (await res.json()) as { acct?: string; username?: string };
      return { detail: `Connected as @${d.acct || d.username || "account"}` };
    }
    case "telegram": {
      const token = getSecret("TELEGRAM_BOT_TOKEN", userId);
      const chatId = String(cfg.chat_id || "").trim();
      if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required.");
      const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
        signal: AbortSignal.timeout(15000),
      });
      const me = (await meRes.json()) as { ok?: boolean; result?: { username?: string }; description?: string };
      if (!me.ok) throw new Error(`Telegram getMe failed: ${me.description || meRes.statusText}`);
      if (!chatId || chatId === "@your_channel") {
        throw new Error(`Bot @${me.result?.username} valid, but configure a real channel chat_id first.`);
      }
      const chatRes = await fetch(
        `https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`,
        { signal: AbortSignal.timeout(15000) }
      );
      const chat = (await chatRes.json()) as { ok?: boolean; result?: { title?: string; username?: string }; description?: string };
      if (!chat.ok) {
        throw new Error(`Bot @${me.result?.username} ok, but chat "${chatId}" check failed: ${chat.description || chatRes.statusText}`);
      }
      return { detail: `Bot @${me.result?.username} -> ${chat.result?.title || chatId}` };
    }
    case "discord": {
      const webhookUrl = getSecret("DISCORD_WEBHOOK_URL", userId);
      if (!webhookUrl) throw new Error("DISCORD_WEBHOOK_URL is required.");
      const res = await fetch(webhookUrl, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`Discord webhook check failed (${res.status})`);
      const d = (await res.json()) as { name?: string };
      return { detail: `Webhook "${d.name || "Discord"}" active` };
    }
    case "devto": {
      const key = getSecret("DEVTO_API_KEY", userId);
      if (!key) throw new Error("DEVTO_API_KEY is required.");
      const res = await fetch("https://dev.to/api/users/me", {
        headers: { "api-key": key, "User-Agent": UA },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`Dev.to auth failed (${res.status})`);
      const d = (await res.json()) as { username?: string; name?: string };
      return { detail: `Connected as @${d.username || d.name || "devto"}` };
    }
    case "facebook_page": {
      const pageId = String(cfg.page_id || getSecret("FB_PAGE_ID", userId) || "").trim();
      const token = getSecret("FB_PAGE_TOKEN", userId);
      if (!pageId || !token) throw new Error("Facebook page_id and FB_PAGE_TOKEN are required.");
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(pageId)}?fields=id,name&access_token=${encodeURIComponent(token)}`,
        { signal: AbortSignal.timeout(15000) }
      );
      const d = (await res.json()) as { name?: string; error?: { message?: string } };
      if (!res.ok || d.error) throw new Error(d.error?.message || `Facebook verify failed (${res.status})`);
      return { detail: `Page "${d.name || pageId}" verified` };
    }
    case "linkedin": {
      const author = String(cfg.author_urn || "").trim();
      const token = getSecret("LINKEDIN_TOKEN", userId);
      if (!author || !token) throw new Error("LinkedIn author_urn and LINKEDIN_TOKEN are required.");
      const res = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const d = (await res.json()) as { name?: string };
        return { detail: `Token valid${d.name ? ` (${d.name})` : ""} for ${author}` };
      }
      if (res.status === 401) throw new Error("LinkedIn token rejected (401 Unauthorized)");
      return { detail: `Author ${author} configured (token HTTP ${res.status} on userinfo; w_member_social cannot be read-verified via userinfo)` };
    }
    case "threads": {
      const uid = String(cfg.user_id || "me").trim();
      const token = getSecret("THREADS_TOKEN", userId);
      if (!token) throw new Error("THREADS_TOKEN is required.");
      const res = await fetch(
        `https://graph.threads.net/v1.0/${encodeURIComponent(uid)}?fields=id,username&access_token=${encodeURIComponent(token)}`,
        { signal: AbortSignal.timeout(15000) }
      );
      const d = (await res.json()) as { username?: string; error?: { message?: string } };
      if (!res.ok || d.error) throw new Error(d.error?.message || `Threads verify failed (${res.status})`);
      return { detail: `Connected as @${d.username || uid}` };
    }
    case "pinterest": {
      const boardId = String(cfg.board_id || getSecret("PINTEREST_BOARD_ID", userId) || "").trim();
      const token = getSecret("PINTEREST_TOKEN", userId);
      if (!boardId || !token) throw new Error("Pinterest board_id and PINTEREST_TOKEN are required.");
      const apiBase = String(cfg.api_base || "https://api.pinterest.com").replace(/\/+$/, "");
      const res = await fetch(`${apiBase}/v5/boards/${encodeURIComponent(boardId)}`, {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": UA },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        const errBody = (await res.text()).slice(0, 160);
        throw new Error(`Pinterest board verify failed (${res.status}): ${errBody || res.statusText}`);
      }
      const d = (await res.json()) as { name?: string };
      return { detail: `Board "${d.name || boardId}" verified` };
    }
    case "reddit": {
      const clientId = getSecret("REDDIT_CLIENT_ID", userId);
      const clientSecret = getSecret("REDDIT_CLIENT_SECRET", userId);
      const username = getSecret("REDDIT_USERNAME", userId);
      const password = getSecret("REDDIT_PASSWORD", userId);
      const ua = getSecret("REDDIT_USER_AGENT", userId) || UA;
      if (!clientId || !clientSecret || !username || !password) {
        throw new Error("All 4 Reddit credentials are required.");
      }
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const tokRes = await fetch("https://www.reddit.com/api/v1/access_token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "User-Agent": ua,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ grant_type: "password", username, password }),
        signal: AbortSignal.timeout(15000),
      });
      const tok = (await tokRes.json()) as { access_token?: string; error?: string };
      if (!tokRes.ok || !tok.access_token) {
        throw new Error(`Reddit token failed: ${tok.error || tokRes.status}`);
      }
      return { detail: `OAuth token issued for u/${username}` };
    }
    case "x": {
      const url = "https://api.twitter.com/2/users/me";
      const res = await fetch(url, {
        headers: {
          Authorization: buildOAuth1Header("GET", url, {}, userId),
          "User-Agent": UA,
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`X verify failed (${res.status}): ${(await res.text()).slice(0, 140)}`);
      const d = (await res.json()) as { data?: { username?: string } };
      return { detail: `Connected as @${d.data?.username || "user"}` };
    }
    default:
      throw new Error(`Unsupported platform: ${platformName}`);
  }
}
