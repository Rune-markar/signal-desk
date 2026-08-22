import { ZodError } from 'zod';
import {
  authenticateLoginAttempt,
  clearSessionCookie,
  createSession,
  DEFAULT_USER_ID,
  destroySession,
  getAuthenticatedUser,
  isLoginSecretConfigured,
  isSameOriginRequest
} from './auth';
import {
  createMonitorRecord,
  deleteMonitorRecord,
  getAppState,
  MonitorMutationBusyError,
  markNotificationsRead,
  migrateLocalState,
  updateMonitorRecord,
  updateNotificationRecord,
  updatePreferencesRecord
} from './db';
import {
  loginInputSchema,
  logoutInputSchema,
  migrationInputSchema,
  monitorInputSchema,
  monitorPatchSchema,
  notificationBatchPatchSchema,
  notificationPatchSchema,
  preferencesPatchSchema,
  type MonitorPatch,
  type NotificationPatch
} from './validation';

const MAX_JSON_BODY_BYTES = 1_048_576;

export interface ApiDependencies {
  db: D1Database;
  loginSecret?: string;
  now?: () => Date;
  userId?: string;
}

export interface AuthenticatedApiContext {
  db: D1Database;
  now: Date;
  url: URL;
  userId: string;
}

export type ApiRouteExtension = (
  request: Request,
  context: AuthenticatedApiContext
) => Promise<Response | null>;

class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function responseHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set('Cache-Control', 'no-store');
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.append('Vary', 'Cookie');
  return headers;
}

export function jsonResponse(
  body: unknown,
  init: ResponseInit = {}
): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: responseHeaders(init.headers)
  });
}

export function apiError(
  status: number,
  code: string,
  message: string,
  headers?: HeadersInit
): Response {
  return jsonResponse({ error: { code, message } }, { status, headers });
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new ApiRequestError(415, 'UNSUPPORTED_MEDIA_TYPE', 'JSON形式で送信してください');
  }

  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    throw new ApiRequestError(413, 'PAYLOAD_TOO_LARGE', '送信データが大きすぎます');
  }
  if (!request.body) {
    throw new ApiRequestError(400, 'INVALID_JSON', 'JSON本文が必要です');
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_JSON_BODY_BYTES) {
        await reader.cancel('payload too large');
        throw new ApiRequestError(413, 'PAYLOAD_TOO_LARGE', '送信データが大きすぎます');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new ApiRequestError(400, 'INVALID_JSON', 'JSONを解析できませんでした');
  }
}

function routeId(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const encoded = pathname.slice(prefix.length);
  if (!encoded || encoded.includes('/')) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

async function stateResponse(
  db: D1Database,
  userId: string,
  now: Date,
  status = 200,
  extra?: Record<string, unknown>
): Promise<Response> {
  const state = await getAppState(db, userId, now);
  return jsonResponse({ state, ...extra }, { status });
}

async function handleAuthenticatedRoute(
  request: Request,
  context: AuthenticatedApiContext,
  extensions: readonly ApiRouteExtension[]
): Promise<Response | null> {
  const { db, now, url, userId } = context;
  const method = request.method.toUpperCase();

  if (method === 'GET' && ['/api/state', '/api/monitors', '/api/runs', '/api/notifications'].includes(url.pathname)) {
    return stateResponse(db, userId, now);
  }

  if (url.pathname === '/api/monitors' && method === 'POST') {
    const input = monitorInputSchema.parse(await readJsonBody(request));
    await createMonitorRecord(db, userId, input, now);
    return stateResponse(db, userId, now, 201);
  }

  const monitorId = routeId(url.pathname, '/api/monitors/');
  if (monitorId && method === 'PATCH') {
    const patch = monitorPatchSchema.parse(await readJsonBody(request)) as MonitorPatch;
    const monitor = await updateMonitorRecord(db, userId, monitorId, patch, now);
    if (!monitor) return apiError(404, 'NOT_FOUND', '監視項目が見つかりません');
    return stateResponse(db, userId, now);
  }
  if (monitorId && method === 'DELETE') {
    if (!await deleteMonitorRecord(db, userId, monitorId)) {
      return apiError(404, 'NOT_FOUND', '監視項目が見つかりません');
    }
    return stateResponse(db, userId, now);
  }

  if (url.pathname === '/api/notifications' && method === 'PATCH') {
    const patch = notificationBatchPatchSchema.parse(await readJsonBody(request));
    await markNotificationsRead(db, userId, patch.notificationIds, now);
    return stateResponse(db, userId, now);
  }

  const notificationId = routeId(url.pathname, '/api/notifications/');
  if (notificationId && method === 'PATCH') {
    const patch = notificationPatchSchema.parse(await readJsonBody(request)) as NotificationPatch;
    if (!await updateNotificationRecord(db, userId, notificationId, patch, now)) {
      return apiError(404, 'NOT_FOUND', '通知が見つかりません');
    }
    return stateResponse(db, userId, now);
  }

  if (url.pathname === '/api/preferences' && method === 'PATCH') {
    const patch = preferencesPatchSchema.parse(await readJsonBody(request));
    await updatePreferencesRecord(db, userId, patch, now);
    return stateResponse(db, userId, now);
  }

  if (url.pathname === '/api/migrate' && method === 'POST') {
    const input = migrationInputSchema.parse(await readJsonBody(request));
    const imported = await migrateLocalState(db, userId, input.state, now);
    return stateResponse(db, userId, now, 200, { imported });
  }

  for (const extension of extensions) {
    const response = await extension(request, context);
    if (response) return response;
  }

  return null;
}

export async function handleApiRequest(
  request: Request,
  dependencies: ApiDependencies,
  extensions: readonly ApiRouteExtension[] = []
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return null;

  const method = request.method.toUpperCase();
  const now = dependencies.now?.() ?? new Date();
  const userId = dependencies.userId ?? DEFAULT_USER_ID;
  const loginSecret = dependencies.loginSecret ?? '';

  try {
    if (url.pathname === '/api/auth/status' && method === 'GET') {
      const authenticated = Boolean(await getAuthenticatedUser(request, dependencies.db, now));
      return jsonResponse({ available: isLoginSecretConfigured(loginSecret), authenticated });
    }

    if (url.pathname === '/api/auth/login' && method === 'POST') {
      if (!isSameOriginRequest(request)) {
        return apiError(403, 'ORIGIN_REJECTED', '同一オリジンから送信してください');
      }
      if (!isLoginSecretConfigured(loginSecret)) {
        return apiError(503, 'AUTH_NOT_CONFIGURED', 'アプリのログイン設定が未完了です');
      }
      const { secret } = loginInputSchema.parse(await readJsonBody(request));
      const attempt = await authenticateLoginAttempt(
        request,
        dependencies.db,
        secret,
        loginSecret,
        userId,
        now
      );
      if (attempt.rateLimited) {
        return apiError(
          429,
          'RATE_LIMITED',
          'ログイン試行が多すぎます。しばらく待ってから再試行してください',
          { 'Retry-After': String(attempt.retryAfterSeconds ?? 60) }
        );
      }
      if (!attempt.authenticated) {
        return apiError(401, 'INVALID_CREDENTIALS', 'ログイン情報が正しくありません');
      }
      const session = await createSession(dependencies.db, userId, now);
      return jsonResponse(
        { available: true, authenticated: true },
        { headers: { 'Set-Cookie': session.cookie } }
      );
    }

    if (url.pathname === '/api/auth/logout' && method === 'POST') {
      if (!isSameOriginRequest(request)) {
        return apiError(403, 'ORIGIN_REJECTED', '同一オリジンから送信してください');
      }
      const { pushEndpoint } = logoutInputSchema.parse(await readJsonBody(request));
      const authenticatedUser = await getAuthenticatedUser(request, dependencies.db, now);
      if (pushEndpoint && !authenticatedUser) {
        return apiError(401, 'AUTHENTICATION_REQUIRED', 'Push購読を解除するには再ログインが必要です');
      }
      if (pushEndpoint && authenticatedUser) {
        await dependencies.db.prepare(
          'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?'
        ).bind(authenticatedUser, pushEndpoint).run();
        const remaining = await dependencies.db.prepare(
          'SELECT COUNT(*) AS total FROM push_subscriptions WHERE user_id = ?'
        ).bind(authenticatedUser).first<{ total: number }>();
        if ((remaining?.total ?? 0) === 0) {
          await dependencies.db.prepare(
            'UPDATE preferences SET push_enabled = 0, updated_at = ? WHERE user_id = ?'
          ).bind(now.toISOString(), authenticatedUser).run();
        }
      }
      await destroySession(request, dependencies.db);
      return jsonResponse(
        { available: isLoginSecretConfigured(loginSecret), authenticated: false },
        { headers: { 'Set-Cookie': clearSessionCookie() } }
      );
    }

    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !isSameOriginRequest(request)) {
      return apiError(403, 'ORIGIN_REJECTED', '同一オリジンから送信してください');
    }

    const authenticatedUser = await getAuthenticatedUser(request, dependencies.db, now);
    if (!authenticatedUser) {
      return apiError(401, 'AUTHENTICATION_REQUIRED', 'ログインが必要です');
    }
    if (authenticatedUser !== userId) {
      return apiError(403, 'USER_MISMATCH', 'このデータにはアクセスできません');
    }

    const response = await handleAuthenticatedRoute(
      request,
      { db: dependencies.db, now, url, userId: authenticatedUser },
      extensions
    );
    return response ?? apiError(404, 'NOT_FOUND', 'APIが見つかりません');
  } catch (error) {
    if (error instanceof MonitorMutationBusyError) {
      return apiError(409, 'MONITOR_BUSY', error.message);
    }
    if (error instanceof ApiRequestError) {
      return apiError(error.status, error.code, error.message);
    }
    if (error instanceof ZodError) {
      return apiError(400, 'VALIDATION_ERROR', error.issues[0]?.message ?? '入力内容を確認してください');
    }
    console.error(JSON.stringify({
      event: 'api_error',
      method,
      path: url.pathname,
      error: error instanceof Error ? error.message : 'unknown error'
    }));
    return apiError(500, 'INTERNAL_ERROR', 'サーバーで処理できませんでした');
  }
}
