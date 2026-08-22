import type { AppPreferences, AppState, MonitorInput } from '../domain/model';
import { isAppState } from '../domain/storage';

export interface AuthStatus {
  available: boolean;
  authenticated: boolean;
}

export interface PushKeyStatus {
  available: boolean;
  publicKey?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function errorDetails(payload: unknown, fallback: string): { message: string; code?: string } {
  if (!isRecord(payload)) return { message: fallback };
  if (typeof payload.error === 'string') return { message: payload.error };
  if (isRecord(payload.error)) {
    return {
      message: typeof payload.error.message === 'string' ? payload.error.message : fallback,
      code: typeof payload.error.code === 'string' ? payload.error.code : undefined
    };
  }
  return { message: typeof payload.message === 'string' ? payload.message : fallback };
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin'
  });
  const contentType = response.headers.get('content-type') ?? '';
  const payload: unknown = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : null;

  if (!response.ok) {
    const details = errorDetails(payload, `サーバーとの通信に失敗しました（${response.status}）`);
    throw new ApiError(details.message, response.status, details.code);
  }
  return payload as T;
}

function jsonBody(value: unknown): Pick<RequestInit, 'body' | 'headers'> {
  return {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  };
}

export function stateFromPayload(payload: unknown): AppState | null {
  if (isAppState(payload)) return payload;
  if (isRecord(payload) && isAppState(payload.state)) return payload.state;
  return null;
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const payload = await requestJson<unknown>('/api/auth/status');
  if (!isRecord(payload)) throw new ApiError('接続状態の応答を確認できませんでした', 502);
  return {
    available: payload.available === true,
    authenticated: payload.authenticated === true
  };
}

export function login(secret: string): Promise<unknown> {
  return requestJson('/api/auth/login', { method: 'POST', ...jsonBody({ secret }) });
}

export function logout(pushEndpoint?: string): Promise<unknown> {
  return requestJson('/api/auth/logout', {
    method: 'POST',
    ...jsonBody(pushEndpoint ? { pushEndpoint } : {})
  });
}

export function getState(): Promise<unknown> {
  return requestJson('/api/state');
}

export function createMonitor(input: MonitorInput): Promise<unknown> {
  return requestJson('/api/monitors', { method: 'POST', ...jsonBody(input) });
}

export function updateMonitor(monitorId: string, input: MonitorInput): Promise<unknown> {
  return requestJson(`/api/monitors/${encodeURIComponent(monitorId)}`, {
    method: 'PATCH',
    ...jsonBody(input)
  });
}

export function updateMonitorStatus(monitorId: string, status: 'active' | 'paused'): Promise<unknown> {
  return requestJson(`/api/monitors/${encodeURIComponent(monitorId)}`, {
    method: 'PATCH',
    ...jsonBody({ status })
  });
}

export function deleteMonitor(monitorId: string): Promise<unknown> {
  return requestJson(`/api/monitors/${encodeURIComponent(monitorId)}`, { method: 'DELETE' });
}

export function runMonitor(monitorId: string): Promise<unknown> {
  return requestJson(`/api/monitors/${encodeURIComponent(monitorId)}/run`, {
    method: 'POST',
    ...jsonBody({})
  });
}

export function updateNotification(
  notificationId: string,
  update: { status: 'read' | 'snoozed'; snoozedUntil?: string }
): Promise<unknown> {
  return requestJson(`/api/notifications/${encodeURIComponent(notificationId)}`, {
    method: 'PATCH',
    ...jsonBody(update)
  });
}

export function markNotificationsRead(): Promise<unknown> {
  return requestJson('/api/notifications', {
    method: 'PATCH',
    ...jsonBody({ status: 'read' })
  });
}

export function updatePreferences(preferences: Partial<AppPreferences>): Promise<unknown> {
  return requestJson('/api/preferences', {
    method: 'PATCH',
    ...jsonBody(preferences)
  });
}

export function migrateState(state: AppState): Promise<unknown> {
  return requestJson('/api/migrate', {
    method: 'POST',
    ...jsonBody({ state })
  });
}

export function getPushKey(): Promise<PushKeyStatus> {
  return requestJson('/api/push/key');
}

export function savePushSubscription(subscription: PushSubscriptionJSON): Promise<unknown> {
  return requestJson('/api/push/subscribe', {
    method: 'POST',
    ...jsonBody({ subscription })
  });
}

export function removePushSubscription(endpoint: string): Promise<unknown> {
  return requestJson('/api/push/unsubscribe', {
    method: 'POST',
    ...jsonBody({ endpoint })
  });
}
