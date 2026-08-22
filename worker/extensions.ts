import { z } from 'zod';
import { apiError, jsonResponse, readJsonBody, type ApiRouteExtension } from './api';
import { getAppState } from './db';
import { isSafePushEndpoint, isVapidConfigured } from './push';
import { MonitorBusyError, MonitorNotFoundError, runMonitor } from './runner';

const pushSubscriptionSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(4096),
    expirationTime: z.number().int().positive().nullable().optional(),
    keys: z.object({
      p256dh: z.string().min(1).max(1024),
      auth: z.string().min(1).max(1024)
    }).strict()
  }).strict()
}).strict();

const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url().max(4096)
}).strict();

function routeMonitorRun(pathname: string): string | null {
  const match = pathname.match(/^\/api\/monitors\/([^/]+)\/run$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

function vapidAvailable(env: Env): boolean {
  return isVapidConfigured(env);
}

export function createApiExtension(env: Env): ApiRouteExtension {
  return async (request, context) => {
    const method = request.method.toUpperCase();
    const monitorId = routeMonitorRun(context.url.pathname);
    if (monitorId && method === 'POST') {
      try {
        const execution = await runMonitor(env, context.userId, monitorId, {
          trigger: 'manual',
          now: context.now
        });
        const state = await getAppState(context.db, context.userId, new Date());
        return jsonResponse({ state, execution });
      } catch (error) {
        if (error instanceof MonitorNotFoundError) {
          return apiError(404, 'NOT_FOUND', '監視項目が見つかりません');
        }
        if (error instanceof MonitorBusyError) {
          return apiError(409, 'MONITOR_BUSY', 'この監視項目はすでに実行中です');
        }
        throw error;
      }
    }

    if (context.url.pathname === '/api/push/key' && method === 'GET') {
      const available = vapidAvailable(env);
      return jsonResponse({
        available,
        ...(available ? { publicKey: env.VAPID_PUBLIC_KEY } : {})
      });
    }

    if (context.url.pathname === '/api/push/subscribe' && method === 'POST') {
      if (!vapidAvailable(env)) {
        return apiError(503, 'PUSH_NOT_CONFIGURED', 'Web Pushのサーバー設定が未完了です');
      }
      const { subscription } = pushSubscriptionSchema.parse(await readJsonBody(request));
      if (!isSafePushEndpoint(subscription.endpoint)) {
        return apiError(400, 'UNSAFE_PUSH_ENDPOINT', '安全なHTTPS Pushエンドポイントが必要です');
      }
      const now = context.now.toISOString();
      await context.db.batch([
        context.db.prepare(
          `INSERT INTO push_subscriptions
          (user_id, id, endpoint, p256dh, auth, expiration_time, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, endpoint) DO UPDATE SET
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           expiration_time = excluded.expiration_time,
           updated_at = excluded.updated_at`
        ).bind(
          context.userId,
          crypto.randomUUID(),
          subscription.endpoint,
          subscription.keys.p256dh,
          subscription.keys.auth,
          subscription.expirationTime ?? null,
          now,
          now
        ),
        context.db.prepare(
          'UPDATE preferences SET push_enabled = 1, updated_at = ? WHERE user_id = ?'
        ).bind(now, context.userId)
      ]);
      const state = await getAppState(context.db, context.userId, context.now);
      return jsonResponse({ state, subscribed: true });
    }

    if (context.url.pathname === '/api/push/unsubscribe' && method === 'POST') {
      const { endpoint } = pushUnsubscribeSchema.parse(await readJsonBody(request));
      await context.db.prepare(
        'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?'
      ).bind(context.userId, endpoint).run();
      const remaining = await context.db.prepare(
        'SELECT COUNT(*) AS total FROM push_subscriptions WHERE user_id = ?'
      ).bind(context.userId).first<{ total: number }>();
      if ((remaining?.total ?? 0) === 0) {
        await context.db.prepare(
          'UPDATE preferences SET push_enabled = 0, updated_at = ? WHERE user_id = ?'
        ).bind(context.now.toISOString(), context.userId).run();
      }
      const state = await getAppState(context.db, context.userId, context.now);
      return jsonResponse({ state, subscribed: false });
    }

    return null;
  };
}
