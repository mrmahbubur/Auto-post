import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { getUserBySessionHash } from "./db.ts";
import type { PublicUser } from "./types.ts";

export const SESSION_COOKIE_NAME = "autopost_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface AuthenticatedRequest extends Request {
  user?: PublicUser;
  sessionTokenHash?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email: string): boolean {
  const s = email.trim();
  return s.length <= 254 && EMAIL_RE.test(s);
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = crypto.scryptSync(password, salt, 64);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashSessionToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

export function extractTokenFromRequest(req: Request): string {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const tok = authHeader.slice(7).trim();
    if (tok) return tok;
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE_NAME] || "";
}

function isRequestHttps(req: Request): boolean {
  if (req.secure) return true;
  const proto = req.headers["x-forwarded-proto"];
  if (typeof proto === "string") {
    return proto.split(",")[0].trim().toLowerCase() === "https";
  }
  return false;
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  const secure = isRequestHttps(req);
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${SESSION_TTL_SECONDS}`,
    "HttpOnly",
    secure ? "SameSite=None" : "SameSite=Lax",
  ];
  if (secure) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

export function clearSessionCookie(req: Request, res: Response): void {
  const secure = isRequestHttps(req);
  const attrs = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    secure ? "SameSite=None" : "SameSite=Lax",
  ];
  if (secure) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

export function getClientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.trim()) {
    return fwd.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

// Sliding-window rate limiter for auth endpoints
const attempts = new Map<string, number[]>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 12;

export function checkAuthRateLimit(key: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const list = (attempts.get(key) || []).filter((ts) => ts > cutoff);
  if (list.length >= MAX_ATTEMPTS) {
    const oldest = list[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    attempts.set(key, list);
    return { allowed: false, retryAfterSec };
  }
  list.push(now);
  attempts.set(key, list);
  return { allowed: true, retryAfterSec: 0 };
}

export function clearAuthRateLimit(key: string): void {
  attempts.delete(key);
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const rawToken = extractTokenFromRequest(req);
  if (!rawToken) {
    res.status(401).json({ error: "Authentication required. Please sign in." });
    return;
  }
  const tokenHash = hashSessionToken(rawToken);
  const user = getUserBySessionHash(tokenHash);
  if (!user) {
    clearSessionCookie(req, res);
    res.status(401).json({ error: "Session expired or invalid. Please sign in again." });
    return;
  }
  req.user = user;
  req.sessionTokenHash = tokenHash;
  next();
}
