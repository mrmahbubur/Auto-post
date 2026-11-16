import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");
export const DATA_DIR = path.join(ROOT, "data");
export const IMAGES_DIR = path.join(DATA_DIR, "images");
export const UA = "AutoPost/1.0 (+https://github.com/; social cross-poster)";

export function decodeHtmlEntities(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function stripHtml(s: string | null | undefined, limit = 0): string {
  if (!s) return "";
  let out = decodeHtmlEntities(
    s
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t\r\f\v\n]+/g, " ")
    .trim();

  if (limit > 0 && out.length > limit) {
    const cut = out.slice(0, limit);
    const idx = cut.lastIndexOf(" ");
    out = (idx > 0 ? cut.slice(0, idx) : cut).replace(/[,.;:]+$/, "") + "…";
  }
  return out;
}

export function slug(s: string, maxlen = 60): string {
  const cleaned = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.slice(0, maxlen).replace(/-+$/, "") || "post";
}

export function keyFor(...parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 20);
}

export function formatHashtags(tags: string[], limit = 4): string {
  const out: string[] = [];
  for (const t of tags.slice(0, limit)) {
    const clean = String(t).replace(/[^0-9A-Za-z_]/g, "");
    if (clean) out.push(`#${clean}`);
  }
  return out.join(" ");
}

export function truncateAt(text: string, limit: number): string {
  if (text.length <= limit) return text;
  let cut = text.slice(0, Math.max(1, limit - 1));
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > 0) {
    cut = cut.slice(0, lastSpace);
  }
  return cut.replace(/[ ,;:-]+$/, "") + "…";
}

export function firstSentences(text: string, maxlen: number): string {
  const clean = (text || "").trim();
  if (clean.length <= maxlen) return clean;
  const parts = clean.split(/(?<=[.!?])\s+/);
  let out = "";
  for (const sent of parts) {
    const next = out ? `${out} ${sent}` : sent;
    if (next.length > maxlen) break;
    out = next;
  }
  if (out) return out;
  const idx = clean.slice(0, maxlen).lastIndexOf(" ");
  const cut = (idx > 0 ? clean.slice(0, idx) : clean.slice(0, maxlen)).replace(/[ ,;:\-—]+$/, "");
  if (!cut) return "";
  return /[.!?]$/.test(cut) ? cut : `${cut}…`;
}

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
