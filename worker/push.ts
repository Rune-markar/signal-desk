import { createECDH, timingSafeEqual } from 'node:crypto';
import webPush from 'web-push';
import { isSafePublicHttpsUrl } from '../src/domain/publicUrl';

export { isSafePublicHttpsUrl } from '../src/domain/publicUrl';

const PUSH_TIMEOUT_MS = 15_000;

export interface PushBindings {
  DB: D1Database;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expiration_time: number | null;
  created_at: string;
  updated_at: string;
}

export interface PushNotificationMessage {
  userId: string;
  notificationId: string;
  monitorId: string;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  sourceUrl?: string;
}

export interface PushDeliveryReport {
  available: boolean;
  attempted: number;
  delivered: number;
  failed: number;
  removed: number;
  skippedReason?: 'disabled' | 'quiet-hours' | 'not-configured' | 'no-subscriptions';
}

interface PreferenceRow {
  timezone: string;
  quiet_hours_enabled: number;
  quiet_from: string;
  quiet_to: string;
  push_enabled: number;
}

function emptyReport(
  available: boolean,
  skippedReason?: PushDeliveryReport['skippedReason']
): PushDeliveryReport {
  return { available, attempted: 0, delivered: 0, failed: 0, removed: 0, skippedReason };
}

function clockTimeInZone(date: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date);
    const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
    const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
    return `${hour}:${minute}`;
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

function isClockTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isWithinQuietHours(preferences: PreferenceRow, now: Date): boolean {
  if (
    preferences.quiet_hours_enabled !== 1 ||
    !isClockTime(preferences.quiet_from) ||
    !isClockTime(preferences.quiet_to) ||
    preferences.quiet_from === preferences.quiet_to
  ) {
    return false;
  }

  const current = clockTimeInZone(now, preferences.timezone);
  if (preferences.quiet_from < preferences.quiet_to) {
    return current >= preferences.quiet_from && current < preferences.quiet_to;
  }

  return current >= preferences.quiet_from || current < preferences.quiet_to;
}

export const isSafePushEndpoint = isSafePublicHttpsUrl;

function isValidVapidSubject(subject: string): boolean {
  if (subject.startsWith('mailto:')) {
    return subject.length > 'mailto:'.length;
  }

  try {
    return new URL(subject).protocol === 'https:';
  } catch {
    return false;
  }
}

function decodeCanonicalBase64Url(value: string, expectedLength: number): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.byteLength === expectedLength && decoded.toString('base64url') === value
      ? decoded
      : null;
  } catch {
    return null;
  }
}

export function isVapidConfigured(env: Pick<PushBindings, 'VAPID_PUBLIC_KEY' | 'VAPID_PRIVATE_KEY' | 'VAPID_SUBJECT'>): boolean {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return false;
  if (!isValidVapidSubject(env.VAPID_SUBJECT)) return false;

  const publicKey = decodeCanonicalBase64Url(env.VAPID_PUBLIC_KEY, 65);
  const privateKey = decodeCanonicalBase64Url(env.VAPID_PRIVATE_KEY, 32);
  if (!publicKey || !privateKey || publicKey[0] !== 0x04) return false;

  try {
    const curve = createECDH('prime256v1');
    curve.setPrivateKey(privateKey);
    const derivedPublicKey = curve.getPublicKey();
    return derivedPublicKey.byteLength === publicKey.byteLength && timingSafeEqual(derivedPublicKey, publicKey);
  } catch {
    return false;
  }
}

type DeliveryOutcome = 'delivered' | 'failed' | 'removed';

interface DeliveryResult {
  outcome: DeliveryOutcome;
  subscriptionId: string;
}

async function deliverToSubscription(
  env: PushBindings,
  subscription: PushSubscriptionRow,
  message: PushNotificationMessage
): Promise<DeliveryResult> {
  if (!isSafePushEndpoint(subscription.endpoint)) {
    return { outcome: 'removed', subscriptionId: subscription.id };
  }

  const payload = JSON.stringify({
    notificationId: message.notificationId,
    monitorId: message.monitorId,
    title: message.title.slice(0, 120),
    body: message.body.slice(0, 800),
    severity: message.severity,
    sourceUrl: message.sourceUrl,
    tag: message.notificationId,
    url: `/signal-desk/?view=inbox&notification=${encodeURIComponent(message.notificationId)}`
  });

  try {
    const details = webPush.generateRequestDetails(
      {
        endpoint: subscription.endpoint,
        expirationTime: subscription.expiration_time,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth }
      },
      payload,
      {
        TTL: 60 * 60,
        urgency: message.severity === 'critical' ? 'high' : 'normal',
        topic: message.notificationId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32),
        vapidDetails: {
          subject: env.VAPID_SUBJECT!,
          publicKey: env.VAPID_PUBLIC_KEY!,
          privateKey: env.VAPID_PRIVATE_KEY!
        }
      }
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(details.endpoint, {
        method: details.method,
        headers: details.headers,
        body: details.body,
        signal: controller.signal,
        redirect: 'error'
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.ok) {
      await response.body?.cancel();
      return { outcome: 'delivered', subscriptionId: subscription.id };
    }

    if (response.status === 404 || response.status === 410) {
      await response.body?.cancel();
      return { outcome: 'removed', subscriptionId: subscription.id };
    }

    await response.body?.cancel();
    return { outcome: 'failed', subscriptionId: subscription.id };
  } catch {
    return { outcome: 'failed', subscriptionId: subscription.id };
  }
}

export async function sendPushForNotification(
  env: PushBindings,
  message: PushNotificationMessage,
  now = new Date()
): Promise<PushDeliveryReport> {
  if (!isVapidConfigured(env)) {
    return emptyReport(false, 'not-configured');
  }

  const preferences = await env.DB.prepare(
    `SELECT timezone, quiet_hours_enabled, quiet_from, quiet_to, push_enabled
       FROM preferences
      WHERE user_id = ?`
  )
    .bind(message.userId)
    .first<PreferenceRow>();

  if (!preferences || preferences.push_enabled !== 1) {
    return emptyReport(true, 'disabled');
  }

  if (isWithinQuietHours(preferences, now)) {
    return emptyReport(true, 'quiet-hours');
  }

  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM push_subscriptions
        WHERE user_id = ? AND expiration_time IS NOT NULL AND expiration_time <= ?`
    ).bind(message.userId, now.getTime()),
    env.DB.prepare(
      `UPDATE preferences
          SET push_enabled = 0, updated_at = ?
        WHERE user_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM push_subscriptions WHERE user_id = ?
          )`
    ).bind(now.toISOString(), message.userId, message.userId)
  ]);

  const subscriptions = await env.DB.prepare(
    `SELECT id, user_id, endpoint, p256dh, auth, expiration_time, created_at, updated_at
       FROM push_subscriptions
      WHERE user_id = ?
        AND (expiration_time IS NULL OR expiration_time > ?)
      ORDER BY updated_at DESC
      LIMIT 5`
  )
    .bind(message.userId, now.getTime())
    .all<PushSubscriptionRow>();

  if (subscriptions.results.length === 0) {
    return emptyReport(true, 'no-subscriptions');
  }

  const outcomes = await Promise.all(
    subscriptions.results.map((subscription) => deliverToSubscription(env, subscription, message))
  );

  const removedIds = outcomes
    .filter((result) => result.outcome === 'removed')
    .map((result) => result.subscriptionId);
  if (removedIds.length > 0) {
    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM push_subscriptions
          WHERE user_id = ? AND id IN (${removedIds.map(() => '?').join(', ')})`
      ).bind(message.userId, ...removedIds),
      env.DB.prepare(
        `UPDATE preferences
            SET push_enabled = 0, updated_at = ?
          WHERE user_id = ?
            AND NOT EXISTS (
              SELECT 1 FROM push_subscriptions WHERE user_id = ?
            )`
      ).bind(now.toISOString(), message.userId, message.userId)
    ]);
  }

  return {
    available: true,
    attempted: outcomes.length,
    delivered: outcomes.filter((result) => result.outcome === 'delivered').length,
    failed: outcomes.filter((result) => result.outcome === 'failed').length,
    removed: removedIds.length
  };
}
