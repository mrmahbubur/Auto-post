import { Resvg } from "@resvg/resvg-js";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { Article, CopyDeck, SiteConfig, ThumbnailSettings } from "./types.ts";
import { IMAGES_DIR, UA, escapeHtml, slug, stripHtml } from "./util.ts";

const BOLD_FONT = "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf";
const REG_FONT = "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf";
const FALLBACK_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const FALLBACK_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf";

function fontFilesList(): string[] {
  return [BOLD_FONT, REG_FONT, FALLBACK_BOLD, FALLBACK_REG].filter((p) => fs.existsSync(p));
}

function parseHex(hex: string, fallback: [number, number, number]): [number, number, number] {
  let c = (hex || "").trim().replace(/^#/, "");
  if (c.length === 3) {
    c = c
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(c)) return fallback;
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}

function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

export function sniffImageMime(buf: Buffer, headerCt: string, url: string): string {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length >= 6 &&
    (buf.subarray(0, 6).toString("ascii") === "GIF87a" || buf.subarray(0, 6).toString("ascii") === "GIF89a")
  ) {
    return "image/gif";
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buf.length >= 12 && buf.subarray(4, 8).toString("ascii") === "ftyp") {
    const major = buf.subarray(8, 12).toString("ascii");
    if (major === "avif" || major === "avis") {
      return "image/avif";
    }
    const brandScanEnd = Math.min(buf.length, 64);
    for (let offset = 16; offset + 4 <= brandScanEnd; offset += 4) {
      const compat = buf.subarray(offset, offset + 4).toString("ascii");
      if (compat === "avif" || compat === "avis") {
        return "image/avif";
      }
    }
    if (major === "heic" || major === "heix" || major === "mif1") {
      return "image/heif";
    }
  }
  const headText = buf.subarray(0, Math.min(buf.length, 512)).toString("utf8").trimStart();
  if (/^(?:<\?xml\b[^>]*>\s*)?<svg[\s>]/i.test(headText)) {
    return "image/svg+xml";
  }
  const cleanCt = headerCt.split(";")[0].trim().toLowerCase();
  if (cleanCt.startsWith("image/")) return cleanCt;
  if (/\.avif(\?|$)/i.test(url)) return "image/avif";
  if (/\.webp(\?|$)/i.test(url)) return "image/webp";
  if (/\.png(\?|$)/i.test(url)) return "image/png";
  if (/\.jpe?g(\?|$)/i.test(url)) return "image/jpeg";
  if (/\.gif(\?|$)/i.test(url)) return "image/gif";
  if (/\.svg(\?|$)/i.test(url)) return "image/svg+xml";
  return "";
}

async function fetchOgPhotoDataUri(url: string): Promise<string | null> {
  if (!url || !url.startsWith("http")) return null;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "image/png, image/jpeg, image/gif, image/webp, image/avif;q=0.9, image/*;q=0.8",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 150 || buf.length > 6_000_000) return null;

    const mime = sniffImageMime(buf, ct, url);
    if (!mime) return null;

    // Resvg only natively decodes PNG/JPEG/GIF; transcode AVIF, WebP, HEIF, SVG, or other formats to PNG
    if (mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/gif") {
      const pngBuf = await sharp(buf).rotate().png().toBuffer();
      if (pngBuf.length === 0) return null;
      return `data:image/png;base64,${pngBuf.toString("base64")}`;
    }

    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function estimateTextWidth(text: string, fontSize: number, bold = true): number {
  const factor = bold ? 0.56 : 0.51;
  let width = 0;
  for (const ch of text) {
    if ("ilIjtfr.,!|:; ".includes(ch)) width += fontSize * factor * 0.55;
    else if ("mwMW@%".includes(ch)) width += fontSize * factor * 1.42;
    else if (ch >= "A" && ch <= "Z") width += fontSize * factor * 1.15;
    else width += fontSize * factor;
  }
  return width;
}

function wrapLines(text: string, fontSize: number, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const trial = cur ? `${cur} ${word}` : word;
    if (estimateTextWidth(trial, fontSize, true) <= maxW || !cur) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function ellipsize(text: string, fontSize: number, maxW: number, bold = true): string {
  if (estimateTextWidth(text, fontSize, bold) <= maxW) return text;
  let t = text;
  while (t.length > 1 && estimateTextWidth(`${t}…`, fontSize, bold) > maxW) {
    t = t.slice(0, -1).trimEnd();
  }
  return t ? `${t}…` : "";
}

function fitHeadlineBlock(
  text: string,
  maxW: number,
  maxH: number,
  start = 74,
  floor = 36
): { lines: string[]; fontSize: number; lineH: number } {
  for (let size = start; size >= floor; size -= 2) {
    const lineH = Math.round(size * 1.22);
    const maxLines = Math.max(1, Math.floor(maxH / lineH));
    const lines = wrapLines(text, size, maxW);
    if (lines.length <= maxLines && lines.every((ln) => estimateTextWidth(ln, size, true) <= maxW)) {
      return { lines, fontSize: size, lineH };
    }
  }
  const lineH = Math.round(floor * 1.22);
  const maxLines = Math.max(1, Math.floor(maxH / lineH));
  const lines = wrapLines(text, floor, maxW).slice(0, maxLines);
  if (lines.length > 0) {
    lines[lines.length - 1] = ellipsize(lines[lines.length - 1], floor, maxW, true);
  }
  return { lines, fontSize: floor, lineH };
}

export async function buildThumbnail(
  article: Article,
  copy: CopyDeck,
  site: SiteConfig,
  cfg: ThumbnailSettings,
  options?: { avatarUrl?: string; userId?: string }
): Promise<{ filename: string; fullPath: string }> {
  const targetDir = options?.userId ? path.join(IMAGES_DIR, path.basename(options.userId)) : IMAGES_DIR;
  fs.mkdirSync(targetDir, { recursive: true });

  const w = Number(cfg.width) || 1200;
  const h = Number(cfg.height) || 630;
  const brand = parseHex(site.brand_color || "#1a73e8", [26, 115, 232]);
  const accent = parseHex(site.accent_color || "#ff6d00", [255, 109, 0]);
  const bgStart = mixRgb(brand, [0, 0, 0], 0.04);
  const bgEnd = mixRgb(brand, [0, 0, 0], 0.68);
  const accentCss = `rgb(${accent[0]},${accent[1]},${accent[2]})`;

  const luma = 0.299 * brand[0] + 0.587 * brand[1] + 0.114 * brand[2];
  const glowOpacity = luma < 60 ? 0.32 : 0.18;

  let photoDataUri: string | null = null;
  if (cfg.style !== "solid" && cfg.use_og_image && article.image && !options?.avatarUrl) {
    photoDataUri = await fetchOgPhotoDataUri(article.image);
  }
  const avatarDataUri = options?.avatarUrl ? await fetchOgPhotoDataUri(options.avatarUrl) : null;
  const photoOpacity = cfg.style === "photo" ? 0.68 : 0.32;

  const pad = 64;
  const footerH = 128;
  const chipH = 52;

  // Site chip
  let chipFontSize = 24;
  let chipLabel = site.name.toUpperCase();
  const maxChipW = avatarDataUri ? w * 0.5 : w * 0.55;
  while (estimateTextWidth(chipLabel, chipFontSize, true) + 44 > maxChipW && chipFontSize > 16) {
    chipFontSize -= 1;
  }
  if (estimateTextWidth(chipLabel, chipFontSize, true) + 44 > maxChipW) {
    chipLabel = ellipsize(chipLabel, chipFontSize, maxChipW - 44, true);
  }
  const chipW = Math.round(estimateTextWidth(chipLabel, chipFontSize, true) + 48);

  // Avatar geometry (for Gravatar profile cards)
  const avatarSize = 248;
  const avatarX = w - pad - avatarSize;
  const avatarY = Math.round((h - footerH - avatarSize) / 2) + 18;
  const avatarCx = avatarX + avatarSize / 2;
  const avatarCy = avatarY + avatarSize / 2;
  const avatarR = avatarSize / 2;

  // Headline block
  const hook = stripHtml(copy.hook || article.title) || article.title;
  const boxTop = pad + chipH + 34;
  const boxW = avatarDataUri ? w - pad * 2 - avatarSize - 48 : w - pad * 2;
  const boxH = h - footerH - boxTop;
  const fitted = fitHeadlineBlock(hook, boxW, boxH);
  const blockH = fitted.lines.length * fitted.lineH;
  const startY = Math.max(boxTop, h - footerH - blockH + 6);

  // Footer
  const host = article.url.split("//")[1]?.split("/")[0] || site.url.replace(/^https?:\/\//, "").split("/")[0] || "blog";
  const hostText = ellipsize(host, 24, w * 0.45, false);
  const rawTags = (copy.hashtags || []).slice(0, 2).map((t) => `#${String(t).replace(/^#/, "")}`).join(" ");
  const tagsText = rawTags ? ellipsize(rawTags, 24, w * 0.42, false) : "";

  const headlineSvg = fitted.lines
    .map((line, i) => {
      const y = startY + i * fitted.lineH + fitted.fontSize;
      const esc = escapeHtml(line);
      return `
        <text x="${pad + 3}" y="${y + 4}" font-family="Noto Sans, DejaVu Sans, sans-serif" font-weight="700" font-size="${fitted.fontSize}" fill="rgba(0,0,0,0.48)">${esc}</text>
        <text x="${pad}" y="${y}" font-family="Noto Sans, DejaVu Sans, sans-serif" font-weight="700" font-size="${fitted.fontSize}" fill="#ffffff">${esc}</text>
      `;
    })
    .join("");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${bgStart}" />
      <stop offset="100%" stop-color="${bgEnd}" />
    </linearGradient>
    <radialGradient id="accentGlow" cx="84%" cy="16%" r="58%">
      <stop offset="0%" stop-color="${accentCss}" stop-opacity="${glowOpacity}" />
      <stop offset="100%" stop-color="${accentCss}" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="scrimGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#05070c" stop-opacity="0.88" />
      <stop offset="65%" stop-color="#05070c" stop-opacity="0.56" />
      <stop offset="100%" stop-color="#05070c" stop-opacity="0.34" />
    </linearGradient>
    ${
      photoDataUri
        ? `<filter id="softBlur"><feGaussianBlur stdDeviation="2.2" /></filter>`
        : ""
    }
    ${
      avatarDataUri
        ? `<clipPath id="avatarClip"><circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarR}" /></clipPath>`
        : ""
    }
  </defs>

  <rect width="${w}" height="${h}" fill="url(#brandGrad)" />
  ${
    photoDataUri
      ? `<image href="${photoDataUri}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" opacity="${photoOpacity}" filter="url(#softBlur)" />`
      : `<g opacity="0.22">
           <circle cx="${w - 130}" cy="110" r="260" fill="none" stroke="rgba(255,255,255,0.26)" stroke-width="1.5" />
           <circle cx="${w - 130}" cy="110" r="180" fill="none" stroke="${accentCss}" stroke-width="2" />
           <circle cx="${w - 130}" cy="110" r="105" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1" />
           <line x1="0" y1="${h - footerH}" x2="${w}" y2="${h - footerH}" stroke="rgba(255,255,255,0.22)" stroke-width="1" />
         </g>`
  }
  <rect width="${w}" height="${h}" fill="url(#accentGlow)" />
  <rect width="${w}" height="${h}" fill="url(#scrimGrad)" />

  <rect x="${pad}" y="${pad}" width="${chipW}" height="${chipH}" rx="${Math.round(chipH / 2)}" fill="${accentCss}" />
  <text x="${pad + 24}" y="${pad + Math.round(chipH / 2) + Math.round(chipFontSize * 0.35)}"
    font-family="Noto Sans, DejaVu Sans, sans-serif" font-weight="700" font-size="${chipFontSize}" fill="#0c0e14">
    ${escapeHtml(chipLabel)}
  </text>

  ${headlineSvg}

  ${
    avatarDataUri
      ? `<circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarR + 6}" fill="rgba(255,255,255,0.16)" stroke="${accentCss}" stroke-width="5" />
         <image href="${avatarDataUri}" x="${avatarX}" y="${avatarY}" width="${avatarSize}" height="${avatarSize}" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)" />`
      : ""
  }

  <text x="${pad}" y="${h - footerH + 66}" font-family="Noto Sans, DejaVu Sans, sans-serif" font-weight="400" font-size="25" fill="rgba(255,255,255,0.82)">
    ${escapeHtml(hostText)}
  </text>
  ${
    tagsText
      ? `<text x="${w - pad}" y="${h - footerH + 66}" text-anchor="end" font-family="Noto Sans, DejaVu Sans, sans-serif" font-weight="400" font-size="25" fill="rgba(255,255,255,0.68)">${escapeHtml(tagsText)}</text>`
      : ""
  }

  <rect x="0" y="${h - 10}" width="${w}" height="10" fill="${accentCss}" />
</svg>`;

  const fontFiles = fontFilesList();
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: w },
    font: {
      fontFiles,
      loadSystemFonts: fontFiles.length === 0,
      defaultFontFamily: "Noto Sans",
    },
  });
  const pngBuffer = resvg.render().asPng();

  const filename = `${slug(site.name)}-${slug(article.title, 44)}.png`;
  const fullPath = path.join(targetDir, filename);
  fs.writeFileSync(fullPath, pngBuffer);
  return { filename, fullPath };
}
