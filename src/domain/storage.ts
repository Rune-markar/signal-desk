import { APP_SCHEMA_VERSION, type AppState } from './model';

export const STORAGE_KEY = 'signal-desk.state.v1';

const monitorStatuses = ['active', 'paused', 'error'];
const categories = ['market', 'news', 'website', 'report'];
const severities = ['info', 'warning', 'critical'];
const frequencies = ['hourly', 'daily', 'weekdays', 'weekly'];
const outcomes = ['matched', 'clear', 'failed', 'never'];
const origins = ['native', 'chatgpt-manual', 'demo'];
const runStatuses = ['matched', 'clear', 'failed', 'simulated'];
const notificationStatuses = ['unread', 'read', 'snoozed'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isMonitor(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.schedule)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.instruction === 'string' &&
    categories.includes(String(value.category)) &&
    monitorStatuses.includes(String(value.status)) &&
    frequencies.includes(String(value.schedule.frequency)) &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value.schedule.time)) &&
    typeof value.schedule.timezone === 'string' &&
    severities.includes(String(value.severity)) &&
    typeof value.notificationsEnabled === 'boolean' &&
    origins.includes(String(value.origin)) &&
    outcomes.includes(String(value.lastOutcome)) &&
    typeof value.lastSummary === 'string' &&
    typeof value.consecutiveFailures === 'number' &&
    Number.isInteger(value.consecutiveFailures) &&
    value.consecutiveFailures >= 0 &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    isOptionalString(value.sourceUrl) &&
    isOptionalString(value.lastRunAt) &&
    isOptionalString(value.lastSuccessAt) &&
    isOptionalString(value.nextRunAt) &&
    isOptionalString(value.errorMessage)
  );
}

function isRun(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.monitorId === 'string' &&
    typeof value.monitorTitle === 'string' &&
    runStatuses.includes(String(value.status)) &&
    typeof value.summary === 'string' &&
    isStringArray(value.evidenceUrls) &&
    typeof value.startedAt === 'string' &&
    typeof value.finishedAt === 'string' &&
    typeof value.isDemo === 'boolean'
  );
}

function isNotification(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.monitorId === 'string' &&
    typeof value.monitorTitle === 'string' &&
    typeof value.title === 'string' &&
    typeof value.body === 'string' &&
    severities.includes(String(value.severity)) &&
    notificationStatuses.includes(String(value.status)) &&
    typeof value.detectedAt === 'string' &&
    typeof value.dedupeKey === 'string' &&
    typeof value.isDemo === 'boolean' &&
    isOptionalString(value.runId) &&
    isOptionalString(value.readAt) &&
    isOptionalString(value.snoozedUntil) &&
    isOptionalString(value.sourceUrl)
  );
}

function isStoredState(value: unknown): value is AppState {
  if (!isRecord(value) || !isRecord(value.preferences)) return false;
  const candidate = value;
  const preferences = value.preferences;
  return (
    candidate.schemaVersion === APP_SCHEMA_VERSION &&
    Array.isArray(candidate.monitors) && candidate.monitors.every(isMonitor) &&
    Array.isArray(candidate.runs) && candidate.runs.every(isRun) &&
    Array.isArray(candidate.notifications) && candidate.notifications.every(isNotification) &&
    typeof preferences.timezone === 'string' &&
    typeof preferences.quietHoursEnabled === 'boolean' &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(String(preferences.quietFrom)) &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(String(preferences.quietTo)) &&
    typeof preferences.pushEnabled === 'boolean' &&
    typeof preferences.demoMode === 'boolean'
  );
}

export function loadState(storage: Storage): AppState | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStoredState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveState(storage: Storage, state: AppState): boolean {
  try {
    if (!isStoredState(state)) return false;
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
