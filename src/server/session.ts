import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { users } from "../../drizzle/schema";
import { getDb } from "./db";

const COOKIE_NAME = "novel_session";
const JWT_EXPIRY_SECS = 30 * 24 * 60 * 60; // 30 days

// ── JWT (HS256) ────────────────────────────────────────────────────────────

interface JwtPayload {
  sub: string; // userId
  exp: number; // unix timestamp seconds
}

function jwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be set in production (min 32 chars)");
  }
  return "dev-only-insecure-secret-not-for-production-use-ever!";
}

function b64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

function b64urlDecode(s: string): string {
  return Buffer.from(s, "base64url").toString("utf8");
}

function hmacSha256(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function signJwt(userId: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + JWT_EXPIRY_SECS }));
  const sig = hmacSha256(`${header}.${payload}`, jwtSecret());
  return `${header}.${payload}.${sig}`;
}

function verifyJwt(token: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, sig] = parts as [string, string, string];
  const expected = hmacSha256(`${header}.${payload}`, jwtSecret());
  // timing-safe compare (pad to same length — both are base64url of same HMAC)
  try {
    if (!timingSafeEqual(Buffer.from(sig, "base64url"), Buffer.from(expected, "base64url"))) return null;
  } catch {
    return null;
  }
  let parsed: JwtPayload;
  try {
    parsed = JSON.parse(b64urlDecode(payload)) as JwtPayload;
  } catch {
    return null;
  }
  if (!parsed.sub || !parsed.exp) return null;
  if (Math.floor(Date.now() / 1000) > parsed.exp) return null;
  return parsed;
}

// ── Session reading ────────────────────────────────────────────────────────

export async function getSessionUserId(request: Request): Promise<string | null> {
  // Test seam: NODE_ENV=test accepts the x-user-id header so unit tests work
  // without real JWTs or a database. Never active in production.
  if (process.env.NODE_ENV === "test") {
    const testId = request.headers.get("x-user-id");
    if (testId) return testId;
  }

  const token = parseCookie(request.headers.get("cookie"), COOKIE_NAME);
  if (!token) return null;
  return verifyJwt(token)?.sub ?? null;
}

// ── Password hashing (scrypt) ──────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = await scryptAsync(password, salt, 64);
  return `${salt}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, storedHex] = stored.split(":");
  if (!salt || !storedHex) return false;
  try {
    const derived = await scryptAsync(password, salt, 64);
    return timingSafeEqual(Buffer.from(storedHex, "hex"), derived);
  } catch {
    return false;
  }
}

function scryptAsync(password: string, salt: string, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

// ── User store ─────────────────────────────────────────────────────────────

export async function getUserByEmail(email: string) {
  return getDb().query.users.findFirst({ where: (u, { eq }) => eq(u.email, email) });
}

export async function createUser(email: string, passwordHash: string): Promise<string> {
  const rows = await getDb()
    .insert(users)
    .values({ email, passwordHash })
    .returning({ id: users.id });
  return rows[0]!.id;
}

// ── Cookie helpers ─────────────────────────────────────────────────────────

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, v] = part.trim().split("=", 2);
    if (k?.trim() === name) return v?.trim() ?? null;
  }
  return null;
}

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${JWT_EXPIRY_SECS}${secure}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
