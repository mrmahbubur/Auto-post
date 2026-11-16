import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getOrCreateAppSecret, getSecret } from "./db.ts";
import type { MediaHostSettings } from "./types.ts";

export function signMediaFilename(userId: string, filename: string): string {
  const secret = getOrCreateAppSecret("media_signing_secret");
  return crypto
    .createHmac("sha256", secret)
    .update(`${path.basename(userId)}:${path.basename(filename)}`)
    .digest("hex")
    .slice(0, 32);
}

export function verifyMediaSignature(userId: string, filename: string, sig: string): boolean {
  if (!userId || !filename || !sig || !/^[0-9a-f]{32}$/.test(sig)) return false;
  const expected = signMediaFilename(userId, filename);
  return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(sig, "utf8"));
}

export async function uploadPublicMedia(
  imagePath: string,
  cfg: MediaHostSettings,
  userId?: string
): Promise<string> {
  if (!cfg || cfg.provider === "none") {
    return "";
  }

  const filename = path.basename(imagePath);

  if (cfg.provider === "app_url") {
    const appUrl = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
    if (!appUrl || !/^https?:\/\//i.test(appUrl) || !userId || appUrl.includes("MY_APP_URL")) {
      return "";
    }
    const sig = signMediaFilename(userId, filename);
    return `${appUrl}/api/media/${encodeURIComponent(path.basename(userId))}/${sig}/${encodeURIComponent(filename)}`;
  }

  if (cfg.provider !== "github_raw") {
    return "";
  }

  const repo = (cfg.repo || "").trim();
  const token = getSecret("GITHUB_TOKEN", userId);
  if (!repo || !token) {
    return "";
  }

  const branch = (cfg.branch || "main").trim();
  const prefix = (cfg.path_prefix || "autopost").replace(/^\/+|\/+$/g, "");
  const rel = prefix ? `${prefix}/${filename}` : filename;
  const api = `https://api.github.com/repos/${repo}/contents/${rel}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "AutoPost/1.0",
  };

  const content = fs.readFileSync(imagePath).toString("base64");
  const payload: Record<string, string> = {
    message: `autopost: ${filename}`,
    content,
    branch,
  };

  try {
    const existing = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (existing.ok) {
      const data = (await existing.json()) as { sha?: string };
      if (data.sha) payload.sha = data.sha;
    }
  } catch {
    // Proceed without sha for new files
  }

  const putRes = await fetch(api, {
    method: "PUT",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error(`GitHub media upload failed (${putRes.status}): ${errText.slice(0, 180)}`);
  }

  return `https://raw.githubusercontent.com/${repo}/${branch}/${rel}`;
}
