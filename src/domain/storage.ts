import { APP_SCHEMA_VERSION, type AppState } from './model';

export const STORAGE_KEY = 'signal-desk.state.v1';
export const SERVER_CACHE_KEY = 'signal-desk.server-cache.v1';

const monitorStatuses = ['active', 'paused', 'error'];
const categories = ['market', 'news', 'website', 'report'];
const severities = ['info', 'warning', 'critical'];
const frequencies = ['hourly', 'daily', 'weekdays', 'weekly'];
const outcomes = ['matched', 'clear', 'failed', 'never'];
const origins = ['native', 'chatgpt-manual', 'demo'];
const runStatuses = ['matched', 'clear', 'failed', 'simulated'];
const notificationStatuses = ['unread', 'read', 'snoozed'];
const clockTimePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const monitorKeys = [
  'id', 'title', 'instruction', 'category', 'sourceUrl', 'status', 'schedule', 'severity',
  'notificationsEnabled', 'origin', 'lastRunAt', 'lastSuccessAt', 'nextRunAt', 'lastOutcome',
  'lastSummary', 'consecutiveFailures', 'errorMessage', 'createdAt', 'updatedAt'
] as const;
const scheduleKeys = ['frequency', 'time', 'timezone'] as const;
const runKeys = [
  'id', 'monitorId', 'monitorTitle', 'status', 'summary', 'evidenceUrls', 'startedAt',
  'finishedAt', 'isDemo'
] as const;
const notificationKeys = [
  'id', 'monitorId', 'monitorTitle', 'runId', 'title', 'body', 'severity', 'status',
  'detectedAt', 'readAt', 'snoozedUntil', 'sourceUrl', 'dedupeKey', 'isDemo'
] as const;
const preferenceKeys = [
  'timezone', 'quietHoursEnabled', 'quietFrom', 'quietTo', 'pushEnabled', 'demoMode'
] as const;
const appStateKeys = ['schemaVersion', 'monitors', 'runs', 'notifications', 'preferences'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isTrimmedString(value: unknown, minimum: number, maximum: number): value is string {
  if (typeof value !== 'string' || value !== value.trim()) return false;
  return value.length >= minimum && value.length <= maximum;
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum;
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === 'string' && value.includes('T') && Number.isFinite(Date.parse(value));
}

function isOptionalIsoDateTime(value: unknown): boolean {
  return value === undefined || isIsoDateTime(value);
}

function isTimezone(value: unknown): value is string {
  if (!isTrimmedString(value, 1, 100)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function isLegacyImportUrl(value: unknown): value is string {
  if (!isTrimmedString(value, 0, 2_048)) return false;
  if (value.length === 0) return true;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isOptionalLegacyImportUrl(value: unknown): boolean {
  return value === undefined || isLegacyImportUrl(value);
}

function isId(value: unknown): value is string {
  return isTrimmedString(value, 1, 200);
}

function isClockTime(value: unknown): value is string {
  return typeof value === 'string' && clockTimePattern.test(value);
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

function isMigrationMonitor(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, monitorKeys)) return false;
  if (!isRecord(value.schedule) || !hasOnlyKeys(value.schedule, scheduleKeys)) return false;
  return (
    isId(value.id) &&
    isTrimmedString(value.title, 1, 80) &&
    isTrimmedString(value.instruction, 1, 500) &&
    categories.includes(String(value.category)) &&
    isOptionalLegacyImportUrl(value.sourceUrl) &&
    monitorStatuses.includes(String(value.status)) &&
    frequencies.includes(String(value.schedule.frequency)) &&
    isClockTime(value.schedule.time) &&
    isTimezone(value.schedule.timezone) &&
    severities.includes(String(value.severity)) &&
    typeof value.notificationsEnabled === 'boolean' &&
    origins.includes(String(value.origin)) &&
    isOptionalIsoDateTime(value.lastRunAt) &&
    isOptionalIsoDateTime(value.lastSuccessAt) &&
    isOptionalIsoDateTime(value.nextRunAt) &&
    outcomes.includes(String(value.lastOutcome)) &&
    isBoundedString(value.lastSummary, 4_000) &&
    typeof value.consecutiveFailures === 'number' &&
    Number.isInteger(value.consecutiveFailures) &&
    value.consecutiveFailures >= 0 &&
    value.consecutiveFailures <= 1_000_000 &&
    (value.errorMessage === undefined || isBoundedString(value.errorMessage, 4_000)) &&
    isIsoDateTime(value.createdAt) &&
    isIsoDateTime(value.updatedAt)
  );
}

function isMigrationRun(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, runKeys) &&
    isId(value.id) &&
    isId(value.monitorId) &&
    isBoundedString(value.monitorTitle, 80) &&
    runStatuses.includes(String(value.status)) &&
    isBoundedString(value.summary, 8_000) &&
    Array.isArray(value.evidenceUrls) &&
    value.evidenceUrls.length <= 50 &&
    value.evidenceUrls.every(isLegacyImportUrl) &&
    isIsoDateTime(value.startedAt) &&
    isIsoDateTime(value.finishedAt) &&
    typeof value.isDemo === 'boolean'
  );
}

function isMigrationNotification(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, notificationKeys) &&
    isId(value.id) &&
    isId(value.monitorId) &&
    isBoundedString(value.monitorTitle, 80) &&
    (value.runId === undefined || isId(value.runId)) &&
    isBoundedString(value.title, 200) &&
    isBoundedString(value.body, 8_000) &&
    severities.includes(String(value.severity)) &&
    notificationStatuses.includes(String(value.status)) &&
    isIsoDateTime(value.detectedAt) &&
    isOptionalIsoDateTime(value.readAt) &&
    isOptionalIsoDateTime(value.snoozedUntil) &&
    isOptionalLegacyImportUrl(value.sourceUrl) &&
    typeof value.dedupeKey === 'string' &&
    value.dedupeKey.length >= 1 &&
    value.dedupeKey.length <= 500 &&
    typeof value.isDemo === 'boolean'
  );
}

function isMigrationPreferences(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, preferenceKeys) &&
    isTimezone(value.timezone) &&
    typeof value.quietHoursEnabled === 'boolean' &&
    isClockTime(value.quietFrom) &&
    isClockTime(value.quietTo) &&
    typeof value.pushEnabled === 'boolean' &&
    typeof value.demoMode === 'boolean'
  );
}

/**
 * Validates a portable local migration file without pulling the server-side Zod
 * bundle into the browser. Legacy HTTP URLs are accepted here so the UI can
 * identify and ask the user to repair them before sending anything to D1.
 */
export function isMigrationFileState(value: unknown): value is AppState {
  if (!isRecord(value) || !hasOnlyKeys(value, appStateKeys)) return false;
  return (
    value.schemaVersion === APP_SCHEMA_VERSION &&
    Array.isArray(value.monitors) &&
    value.monitors.length <= 5_000 &&
    value.monitors.every(isMigrationMonitor) &&
    Array.isArray(value.runs) &&
    value.runs.length <= 5_000 &&
    value.runs.every(isMigrationRun) &&
    Array.isArray(value.notifications) &&
    value.notifications.length <= 5_000 &&
    value.notifications.every(isMigrationNotification) &&
    isMigrationPreferences(value.preferences)
  );
}

export function isAppState(value: unknown): value is AppState {
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

export function loadState(storage: Storage, key = STORAGE_KEY): AppState | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isAppState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveState(storage: Storage, state: AppState, key = STORAGE_KEY): boolean {
  try {
    if (!isAppState(state)) return false;
    storage.setItem(key, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
