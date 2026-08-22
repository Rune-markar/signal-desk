import { ensureUser } from './db';

export const DEFAULT_USER_ID = 'owner';
export const SESSION_COOKIE_NAME = 'signal_desk_session';
export const CSRF_COOKIE_NAME = 'signal_desk_csrf';

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1_000;
const LOGIN_BLOCK_MS = 15 * 60 * 1_000;
const LOGIN_ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1_000;
const MAX_LOGIN_FAILURES = 5;
const MIN_LOGIN_SECRET_LENGTH = 16;

const encoder = new TextEncoder();

export interface SessionCreationResult {
  cookie: string;
  expiresAt: string;
  sessionId: string;
}

export interface LoginAttemptResult {
  authenticated: boolean;
  rateLimited: boolean;
  retryAfterSeconds?: number;
}

interface SessionRow {
  user_id: string;
}

interface LoginAttemptRow {
  blocked_until: number;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function hashValue(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function secureStringEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right))
  ]);
  return crypto.subtle.timingSafeEqual(leftDigest, rightDigest);
}

export async function verifyLoginSecret(candidate: string, configured: string): Promise<boolean> {
  if (!isLoginSecretConfigured(configured)) return false;
  return secureStringEqual(candidate, configured);
}

export function isLoginSecretConfigured(configured: string | undefined): boolean {
  if (typeof configured !== 'string' || configured.length < MIN_LOGIN_SECRET_LENGTH) return false;
  const normalized = configured.toLowerCase();
  return !normalized.startsWith('replace-with-') && !normalized.includes('placeholder');
}

export function createSecureToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

function sessionCookie(token: string, maxAge = SESSION_MAX_AGE_SECONDS): string {
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict'
  ].join('; ');
}

export function clearSessionCookie(): string {
  return sessionCookie('', 0);
}

export async function createSession(
  db: D1Database,
  userId = DEFAULT_USER_ID,
  now = new Date()
): Promise<SessionCreationResult> {
  const token = createSecureToken();
  const tokenHash = await hashValue(token);
  const sessionId = crypto.randomUUID();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1_000).toISOString();

  await ensureUser(db, userId, now);
  await db.batch([
    db.prepare(
      `INSERT INTO sessions
        (id, user_id, token_hash, expires_at, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(sessionId, userId, tokenHash, expiresAt, createdAt, createdAt),
    db.prepare(
      'DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?'
    ).bind(userId, createdAt)
  ]);

  return {
    cookie: sessionCookie(token),
    expiresAt,
    sessionId
  };
}

export async function getAuthenticatedUser(
  request: Request,
  db: D1Database,
  now = new Date()
): Promise<string | null> {
  const token = getCookie(request, SESSION_COOKIE_NAME);
  if (!token) return null;
  const tokenHash = await hashValue(token);
  const row = await db.prepare(
    `SELECT user_id
       FROM sessions
      WHERE token_hash = ? AND expires_at > ?
      LIMIT 1`
  ).bind(tokenHash, now.toISOString()).first<SessionRow>();
  return row?.user_id ?? null;
}

export async function destroySession(request: Request, db: D1Database): Promise<void> {
  const token = getCookie(request, SESSION_COOKIE_NAME);
  if (!token) return;
  const tokenHash = await hashValue(token);
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

function clientAddress(request: Request): string {
  const connectingIp = request.headers.get('CF-Connecting-IP')?.trim();
  if (connectingIp) return connectingIp;
  const forwarded = request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim();
  return forwarded || 'unknown';
}

async function loginAttemptKey(request: Request, configuredSecret: string): Promise<string> {
  return hashValue(`${configuredSecret}\0${clientAddress(request)}`);
}

export async function authenticateLoginAttempt(
  request: Request,
  db: D1Database,
  candidate: string,
  configuredSecret: string,
  userId = DEFAULT_USER_ID,
  now = new Date()
): Promise<LoginAttemptResult> {
  if (!isLoginSecretConfigured(configuredSecret)) {
    return { authenticated: false, rateLimited: false };
  }

  await ensureUser(db, userId, now);
  const ipHash = await loginAttemptKey(request, configuredSecret);
  const nowMs = now.getTime();
  const existing = await db.prepare(
    `SELECT blocked_until
       FROM login_attempts
      WHERE user_id = ? AND ip_hash = ?`
  ).bind(userId, ipHash).first<LoginAttemptRow>();

  if (existing && existing.blocked_until > nowMs) {
    return {
      authenticated: false,
      rateLimited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.blocked_until - nowMs) / 1_000))
    };
  }

  if (await verifyLoginSecret(candidate, configuredSecret)) {
    await db.prepare(
      'DELETE FROM login_attempts WHERE user_id = ? AND ip_hash = ?'
    ).bind(userId, ipHash).run();
    return { authenticated: true, rateLimited: false };
  }

  const resetBefore = nowMs - LOGIN_WINDOW_MS;
  const blockedUntil = nowMs + LOGIN_BLOCK_MS;
  await db.batch([
    db.prepare(
      `INSERT INTO login_attempts
        (user_id, ip_hash, window_started_at, failed_attempts, blocked_until, updated_at)
       VALUES (?, ?, ?, 1, 0, ?)
       ON CONFLICT(user_id, ip_hash) DO UPDATE SET
         failed_attempts = CASE
           WHEN login_attempts.window_started_at <= ? THEN 1
           ELSE login_attempts.failed_attempts + 1
         END,
         window_started_at = CASE
           WHEN login_attempts.window_started_at <= ? THEN excluded.window_started_at
           ELSE login_attempts.window_started_at
         END,
         blocked_until = CASE
           WHEN login_attempts.window_started_at <= ? THEN 0
           WHEN login_attempts.failed_attempts + 1 >= ?
             THEN MAX(login_attempts.blocked_until, ?)
           ELSE login_attempts.blocked_until
         END,
         updated_at = excluded.updated_at`
    ).bind(
      userId,
      ipHash,
      nowMs,
      now.toISOString(),
      resetBefore,
      resetBefore,
      resetBefore,
      MAX_LOGIN_FAILURES,
      blockedUntil
    ),
    db.prepare(
      'DELETE FROM login_attempts WHERE user_id = ? AND updated_at < ?'
    ).bind(userId, new Date(nowMs - LOGIN_ATTEMPT_RETENTION_MS).toISOString())
  ]);

  const updated = await db.prepare(
    `SELECT blocked_until
       FROM login_attempts
      WHERE user_id = ? AND ip_hash = ?`
  ).bind(userId, ipHash).first<LoginAttemptRow>();

  if (updated && updated.blocked_until > nowMs) {
    return {
      authenticated: false,
      rateLimited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((updated.blocked_until - nowMs) / 1_000))
    };
  }

  return { authenticated: false, rateLimited: false };
}

export function isSameOriginRequest(request: Request): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return true;

  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) return false;

  const origin = request.headers.get('Origin');
  if (origin) {
    try {
      return new URL(origin).origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }

  const referer = request.headers.get('Referer');
  if (referer) {
    try {
      return new URL(referer).origin === new URL(request.url).origin;
    } catch {
      return false;
    }
  }

  // Some mobile browsers omit Origin on same-origin HTML form submissions.
  // Sec-Fetch-Site is a browser-controlled header and still distinguishes the
  // legitimate form POST from a cross-site CSRF attempt.
  return fetchSite === 'same-origin';
}

export function makeCsrfCookie(path = '/authorize'): { cookie: string; token: string } {
  const token = createSecureToken();
  const cookie = [
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Path=${path}`,
    'Max-Age=600',
    'HttpOnly',
    'Secure',
    'SameSite=Strict'
  ].join('; ');
  return { cookie, token };
}

export async function verifyCsrfToken(request: Request, submittedToken: string): Promise<boolean> {
  const cookieToken = getCookie(request, CSRF_COOKIE_NAME);
  if (!cookieToken || !submittedToken) return false;
  return secureStringEqual(cookieToken, submittedToken);
}
