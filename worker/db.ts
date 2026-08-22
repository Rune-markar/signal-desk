import {
  APP_SCHEMA_VERSION,
  type AlertNotification,
  type AppPreferences,
  type AppState,
  type Monitor,
  type MonitorInput,
  type MonitorRun
} from '../src/domain/model';
import { getNextRunAt } from '../src/domain/schedule';
import { buildMonitor } from '../src/domain/store';
import type { MonitorPatch, NotificationPatch } from './validation';

export const DEFAULT_PREFERENCES: AppPreferences = {
  timezone: 'Asia/Tokyo',
  quietHoursEnabled: true,
  quietFrom: '22:00',
  quietTo: '07:00',
  pushEnabled: false,
  demoMode: false
};

interface PreferencesRow {
  timezone: string;
  quiet_hours_enabled: number;
  quiet_from: string;
  quiet_to: string;
  push_enabled: number;
  demo_mode: number;
}

export interface MonitorRow {
  user_id: string;
  id: string;
  title: string;
  instruction: string;
  category: Monitor['category'];
  source_url: string | null;
  status: Monitor['status'];
  schedule_frequency: Monitor['schedule']['frequency'];
  schedule_time: string;
  schedule_timezone: string;
  severity: Monitor['severity'];
  notifications_enabled: number;
  origin: Monitor['origin'];
  last_run_at: string | null;
  last_success_at: string | null;
  next_run_at: string | null;
  last_outcome: Monitor['lastOutcome'];
  last_summary: string;
  consecutive_failures: number;
  error_message: string | null;
  lease_until: string | null;
  lease_token: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunRow {
  user_id: string;
  id: string;
  monitor_id: string;
  monitor_title: string;
  status: MonitorRun['status'];
  summary: string;
  evidence_urls: string;
  started_at: string;
  finished_at: string;
  is_demo: number;
}

export interface NotificationRow {
  user_id: string;
  id: string;
  monitor_id: string;
  monitor_title: string;
  run_id: string | null;
  title: string;
  body: string;
  severity: AlertNotification['severity'];
  status: AlertNotification['status'];
  detected_at: string;
  read_at: string | null;
  snoozed_until: string | null;
  source_url: string | null;
  dedupe_key: string;
  is_demo: number;
}

export interface MigrationCounts {
  monitors: number;
  runs: number;
  notifications: number;
}

export class MonitorMutationBusyError extends Error {
  constructor() {
    super('実行中の監視項目は変更または削除できません。完了後に再試行してください。');
    this.name = 'MonitorMutationBusyError';
  }
}

function optional<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

function parseEvidenceUrls(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function monitorFromRow(row: MonitorRow): Monitor {
  return {
    id: row.id,
    title: row.title,
    instruction: row.instruction,
    category: row.category,
    sourceUrl: optional(row.source_url),
    status: row.status,
    schedule: {
      frequency: row.schedule_frequency,
      time: row.schedule_time,
      timezone: row.schedule_timezone
    },
    severity: row.severity,
    notificationsEnabled: row.notifications_enabled === 1,
    origin: row.origin,
    lastRunAt: optional(row.last_run_at),
    lastSuccessAt: optional(row.last_success_at),
    nextRunAt: optional(row.next_run_at),
    lastOutcome: row.last_outcome,
    lastSummary: row.last_summary,
    consecutiveFailures: row.consecutive_failures,
    errorMessage: optional(row.error_message),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function runFromRow(row: RunRow): MonitorRun {
  return {
    id: row.id,
    monitorId: row.monitor_id,
    monitorTitle: row.monitor_title,
    status: row.status,
    summary: row.summary,
    evidenceUrls: parseEvidenceUrls(row.evidence_urls),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    isDemo: row.is_demo === 1
  };
}

export function notificationFromRow(row: NotificationRow): AlertNotification {
  return {
    id: row.id,
    monitorId: row.monitor_id,
    monitorTitle: row.monitor_title,
    runId: optional(row.run_id),
    title: row.title,
    body: row.body,
    severity: row.severity,
    status: row.status,
    detectedAt: row.detected_at,
    readAt: optional(row.read_at),
    snoozedUntil: optional(row.snoozed_until),
    sourceUrl: optional(row.source_url),
    dedupeKey: row.dedupe_key,
    isDemo: row.is_demo === 1
  };
}

function preferencesFromRow(row: PreferencesRow | null): AppPreferences {
  if (!row) return { ...DEFAULT_PREFERENCES };
  return {
    timezone: row.timezone,
    quietHoursEnabled: row.quiet_hours_enabled === 1,
    quietFrom: row.quiet_from,
    quietTo: row.quiet_to,
    pushEnabled: row.push_enabled === 1,
    demoMode: row.demo_mode === 1
  };
}

export async function ensureUser(db: D1Database, userId: string, now = new Date()): Promise<void> {
  const at = now.toISOString();
  await db.batch([
    db.prepare(
      `INSERT INTO users (id, created_at, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    ).bind(userId, at, at),
    db.prepare(
      `INSERT INTO preferences
        (user_id, timezone, quiet_hours_enabled, quiet_from, quiet_to,
         push_enabled, demo_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO NOTHING`
    ).bind(
      userId,
      DEFAULT_PREFERENCES.timezone,
      Number(DEFAULT_PREFERENCES.quietHoursEnabled),
      DEFAULT_PREFERENCES.quietFrom,
      DEFAULT_PREFERENCES.quietTo,
      Number(DEFAULT_PREFERENCES.pushEnabled),
      Number(DEFAULT_PREFERENCES.demoMode),
      at,
      at
    )
  ]);
}

export async function getPreferences(db: D1Database, userId: string): Promise<AppPreferences> {
  const row = await db.prepare(
    `SELECT timezone, quiet_hours_enabled, quiet_from, quiet_to, push_enabled, demo_mode
       FROM preferences
      WHERE user_id = ?`
  ).bind(userId).first<PreferencesRow>();
  return preferencesFromRow(row);
}

export async function getAppState(
  db: D1Database,
  userId: string,
  now = new Date()
): Promise<AppState> {
  await ensureUser(db, userId, now);
  const at = now.toISOString();
  await db.prepare(
    `UPDATE notifications
        SET status = 'unread', snoozed_until = NULL
      WHERE user_id = ?
        AND status = 'snoozed'
        AND snoozed_until IS NOT NULL
        AND snoozed_until <= ?`
  ).bind(userId, at).run();

  const [monitorsResult, runsResult, notificationsResult, preferencesRow] = await Promise.all([
    db.prepare(
      `SELECT * FROM monitors WHERE user_id = ? ORDER BY created_at DESC, id DESC`
    ).bind(userId).all<MonitorRow>(),
    db.prepare(
      `SELECT * FROM runs WHERE user_id = ? ORDER BY finished_at DESC, id DESC LIMIT 500`
    ).bind(userId).all<RunRow>(),
    db.prepare(
      `SELECT * FROM notifications WHERE user_id = ? ORDER BY detected_at DESC, id DESC LIMIT 500`
    ).bind(userId).all<NotificationRow>(),
    db.prepare(
      `SELECT timezone, quiet_hours_enabled, quiet_from, quiet_to, push_enabled, demo_mode
         FROM preferences
        WHERE user_id = ?`
    ).bind(userId).first<PreferencesRow>()
  ]);

  return {
    schemaVersion: APP_SCHEMA_VERSION,
    monitors: monitorsResult.results.map(monitorFromRow),
    runs: runsResult.results.map(runFromRow),
    notifications: notificationsResult.results.map(notificationFromRow),
    preferences: preferencesFromRow(preferencesRow)
  };
}

export async function getMonitor(
  db: D1Database,
  userId: string,
  monitorId: string
): Promise<Monitor | null> {
  const row = await db.prepare(
    'SELECT * FROM monitors WHERE user_id = ? AND id = ?'
  ).bind(userId, monitorId).first<MonitorRow>();
  return row ? monitorFromRow(row) : null;
}

function insertMonitorStatement(db: D1Database, userId: string, monitor: Monitor): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO monitors
      (user_id, id, title, instruction, category, source_url, status,
       schedule_frequency, schedule_time, schedule_timezone, severity,
       notifications_enabled, origin, last_run_at, last_success_at, next_run_at,
       last_outcome, last_summary, consecutive_failures, error_message,
       lease_until, lease_token, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM preferences
         WHERE user_id = ? AND timezone = ?
      )`
  ).bind(
    userId,
    monitor.id,
    monitor.title,
    monitor.instruction,
    monitor.category,
    monitor.sourceUrl ?? null,
    monitor.status,
    monitor.schedule.frequency,
    monitor.schedule.time,
    monitor.schedule.timezone,
    monitor.severity,
    Number(monitor.notificationsEnabled),
    monitor.origin,
    monitor.lastRunAt ?? null,
    monitor.lastSuccessAt ?? null,
    monitor.nextRunAt ?? null,
    monitor.lastOutcome,
    monitor.lastSummary,
    monitor.consecutiveFailures,
    monitor.errorMessage ?? null,
    monitor.createdAt,
    monitor.updatedAt,
    userId,
    monitor.schedule.timezone
  );
}

function updateMonitorStatement(
  db: D1Database,
  userId: string,
  monitor: Monitor,
  existing: Monitor,
  now: Date
): D1PreparedStatement {
  return db.prepare(
    `UPDATE monitors SET
       title = ?, instruction = ?, category = ?, source_url = ?, status = ?,
       schedule_frequency = ?, schedule_time = ?, schedule_timezone = ?, severity = ?,
       notifications_enabled = ?, origin = ?, last_run_at = ?, last_success_at = ?,
       next_run_at = ?, last_outcome = ?, last_summary = ?, consecutive_failures = ?,
       error_message = ?, lease_until = NULL, lease_token = NULL, updated_at = ?
     WHERE user_id = ? AND id = ?
       AND (lease_until IS NULL OR lease_until <= ?)
       AND schedule_timezone = ? AND updated_at = ?`
  ).bind(
    monitor.title,
    monitor.instruction,
    monitor.category,
    monitor.sourceUrl ?? null,
    monitor.status,
    monitor.schedule.frequency,
    monitor.schedule.time,
    monitor.schedule.timezone,
    monitor.severity,
    Number(monitor.notificationsEnabled),
    monitor.origin,
    monitor.lastRunAt ?? null,
    monitor.lastSuccessAt ?? null,
    monitor.nextRunAt ?? null,
    monitor.lastOutcome,
    monitor.lastSummary,
    monitor.consecutiveFailures,
    monitor.errorMessage ?? null,
    monitor.updatedAt,
    userId,
    monitor.id,
    now.toISOString(),
    existing.schedule.timezone,
    existing.updatedAt
  );
}

export async function createMonitorRecord(
  db: D1Database,
  userId: string,
  input: MonitorInput,
  now = new Date()
): Promise<Monitor> {
  await ensureUser(db, userId, now);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const monitor = buildMonitor(input, {
      id: `monitor-${crypto.randomUUID()}`,
      now,
      timezone: (await getPreferences(db, userId)).timezone
    });
    const result = await insertMonitorStatement(db, userId, monitor).run();
    if ((result.meta.changes ?? 0) === 1) return monitor;
  }
  throw new MonitorMutationBusyError();
}

export async function updateMonitorRecord(
  db: D1Database,
  userId: string,
  monitorId: string,
  patch: MonitorPatch,
  now = new Date()
): Promise<Monitor | null> {
  const existingRow = await db.prepare(
    'SELECT * FROM monitors WHERE user_id = ? AND id = ?'
  ).bind(userId, monitorId).first<MonitorRow>();
  if (!existingRow) return null;
  if (existingRow.lease_until && existingRow.lease_until > now.toISOString()) {
    throw new MonitorMutationBusyError();
  }
  const existing = monitorFromRow(existingRow);

  const startActive = patch.status
    ? patch.status === 'active'
    : patch.startActive ?? existing.status !== 'paused';
  const input: MonitorInput = {
    title: patch.title ?? existing.title,
    instruction: patch.instruction ?? existing.instruction,
    category: patch.category ?? existing.category,
    sourceUrl: patch.sourceUrl === null ? undefined : patch.sourceUrl ?? existing.sourceUrl,
    frequency: patch.frequency ?? existing.schedule.frequency,
    time: patch.time ?? existing.schedule.time,
    severity: patch.severity ?? existing.severity,
    notificationsEnabled: patch.notificationsEnabled ?? existing.notificationsEnabled,
    startActive,
    origin: existing.origin
  };
  const monitor = buildMonitor(input, {
    id: existing.id,
    now,
    timezone: existing.schedule.timezone,
    existing
  });
  const result = await updateMonitorStatement(db, userId, monitor, existing, now).run();
  if ((result.meta.changes ?? 0) !== 1) {
    const stillExists = await db.prepare(
      'SELECT lease_until FROM monitors WHERE user_id = ? AND id = ?'
    ).bind(userId, monitorId).first<{ lease_until: string | null }>();
    if (stillExists) throw new MonitorMutationBusyError();
    return null;
  }
  return monitor;
}

export async function deleteMonitorRecord(
  db: D1Database,
  userId: string,
  monitorId: string,
  now = new Date()
): Promise<boolean> {
  const result = await db.prepare(
    `DELETE FROM monitors
      WHERE user_id = ? AND id = ?
        AND (lease_until IS NULL OR lease_until <= ?)`
  ).bind(userId, monitorId, now.toISOString()).run();
  if ((result.meta.changes ?? 0) > 0) return true;
  const stillExists = await db.prepare(
    'SELECT lease_until FROM monitors WHERE user_id = ? AND id = ?'
  ).bind(userId, monitorId).first<{ lease_until: string | null }>();
  if (stillExists) throw new MonitorMutationBusyError();
  return false;
}

export async function updateNotificationRecord(
  db: D1Database,
  userId: string,
  notificationId: string,
  patch: NotificationPatch,
  now = new Date()
): Promise<boolean> {
  const at = now.toISOString();
  let readAt: string | null = null;
  let snoozedUntil: string | null = null;
  if (patch.status === 'read') readAt = at;
  if (patch.status === 'snoozed') {
    snoozedUntil = patch.snoozedUntil
      ?? new Date(now.getTime() + (patch.minutes ?? 60) * 60_000).toISOString();
  }
  const result = await db.prepare(
    `UPDATE notifications
        SET status = ?, read_at = ?, snoozed_until = ?
      WHERE user_id = ? AND id = ?`
  ).bind(patch.status, readAt, snoozedUntil, userId, notificationId).run();
  return result.meta.changes > 0;
}

export async function markNotificationsRead(
  db: D1Database,
  userId: string,
  notificationIds: string[] | undefined,
  now = new Date()
): Promise<number> {
  if (notificationIds && notificationIds.length === 0) return 0;
  const at = now.toISOString();
  const idClause = notificationIds
    ? ` AND id IN (${notificationIds.map(() => '?').join(', ')})`
    : '';
  const result = await db.prepare(
    `UPDATE notifications
        SET status = 'read', read_at = ?, snoozed_until = NULL
      WHERE user_id = ? AND status = 'unread'${idClause}`
  ).bind(at, userId, ...(notificationIds ?? [])).run();
  return result.meta.changes;
}

function utf8Hex(value: string): string {
  return Array.from(
    new TextEncoder().encode(value),
    (byte) => byte.toString(16).padStart(2, '0').toUpperCase()
  ).join('');
}

function monitorScheduleFingerprint(rows: readonly MonitorRow[]): string {
  return rows
    .map((row) => ({
      key: utf8Hex(row.id),
      value: [
        utf8Hex(row.id),
        row.updated_at,
        row.schedule_frequency,
        row.schedule_time,
        row.schedule_timezone,
        row.status
      ].join(':')
    }))
    .sort((left, right) => left.key.localeCompare(right.key))
    .map(({ value }) => value)
    .join('|');
}

function uniqueIsoMutationMarker(now: Date): string {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return `${now.toISOString().slice(0, -1)}${String(random[0]).padStart(10, '0')}Z`;
}

export async function updatePreferencesRecord(
  db: D1Database,
  userId: string,
  patch: Partial<AppPreferences>,
  now = new Date()
): Promise<AppPreferences> {
  await ensureUser(db, userId, now);
  const current = await getPreferences(db, userId);
  const next: AppPreferences = { ...current, ...patch };
  const at = now.toISOString();
  const timezoneChanged = next.timezone !== current.timezone;
  if (!timezoneChanged) {
    await db.prepare(
      `UPDATE preferences SET
         timezone = ?, quiet_hours_enabled = ?, quiet_from = ?, quiet_to = ?,
         push_enabled = ?, demo_mode = ?, updated_at = ?
       WHERE user_id = ?`
    ).bind(
      next.timezone,
      Number(next.quietHoursEnabled),
      next.quietFrom,
      next.quietTo,
      Number(next.pushEnabled),
      Number(next.demoMode),
      at,
      userId
    ).run();
    return next;
  }

  const monitors = await db.prepare(
    `SELECT * FROM monitors WHERE user_id = ? ORDER BY hex(id)`
  ).bind(userId).all<MonitorRow>();
  const fingerprint = monitorScheduleFingerprint(monitors.results);
  const scheduleUpdates = JSON.stringify(monitors.results.map((row) => {
    const monitor = monitorFromRow(row);
    return [
      row.id,
      monitor.status === 'paused'
        ? null
        : getNextRunAt(now, monitor.schedule.frequency, monitor.schedule.time, next.timezone)
    ];
  }));
  const mutationMarker = uniqueIsoMutationMarker(now);
  const results = await db.batch([
    db.prepare(
      `UPDATE preferences SET
         timezone = ?, quiet_hours_enabled = ?, quiet_from = ?, quiet_to = ?,
         push_enabled = ?, demo_mode = ?, updated_at = ?
       WHERE user_id = ?
         AND COALESCE((
           SELECT group_concat(
             hex(id) || ':' || updated_at || ':' || schedule_frequency || ':' ||
             schedule_time || ':' || schedule_timezone || ':' || status,
             '|'
           )
             FROM (
               SELECT id, updated_at, schedule_frequency, schedule_time,
                      schedule_timezone, status
                 FROM monitors
                WHERE user_id = ?
                ORDER BY hex(id)
             )
         ), '') = ?
         AND NOT EXISTS (
           SELECT 1 FROM monitors
            WHERE user_id = ? AND lease_until IS NOT NULL AND lease_until > ?
         )`
    ).bind(
      next.timezone,
      Number(next.quietHoursEnabled),
      next.quietFrom,
      next.quietTo,
      Number(next.pushEnabled),
      Number(next.demoMode),
      mutationMarker,
      userId,
      userId,
      fingerprint,
      userId,
      at
    ),
    db.prepare(
      `WITH schedule_updates(id, next_run_at) AS (
         SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]')
           FROM json_each(?)
       )
       UPDATE monitors
          SET schedule_timezone = ?,
              next_run_at = (
                SELECT next_run_at FROM schedule_updates
                 WHERE schedule_updates.id = monitors.id
              ),
              updated_at = ?
        WHERE user_id = ?
          AND id IN (SELECT id FROM schedule_updates)
          AND EXISTS (
            SELECT 1 FROM preferences
             WHERE user_id = ? AND timezone = ? AND updated_at = ?
          )`
    ).bind(
      scheduleUpdates,
      next.timezone,
      at,
      userId,
      userId,
      next.timezone,
      mutationMarker
    )
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1) {
    throw new MonitorMutationBusyError();
  }
  return next;
}

function insertMigratedRunStatement(
  db: D1Database,
  userId: string,
  run: MonitorRun
): D1PreparedStatement {
  return db.prepare(
    `INSERT OR IGNORE INTO runs
      (user_id, id, monitor_id, monitor_title, status, summary, evidence_urls,
       started_at, finished_at, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    userId,
    run.id,
    run.monitorId,
    run.monitorTitle,
    run.status,
    run.summary,
    JSON.stringify(run.evidenceUrls),
    run.startedAt,
    run.finishedAt,
    Number(run.isDemo)
  );
}

function insertMigratedNotificationStatement(
  db: D1Database,
  userId: string,
  notification: AlertNotification
): D1PreparedStatement {
  return db.prepare(
    `INSERT OR IGNORE INTO notifications
      (user_id, id, monitor_id, monitor_title, run_id, title, body, severity,
       status, detected_at, read_at, snoozed_until, source_url, dedupe_key, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    userId,
    notification.id,
    notification.monitorId,
    notification.monitorTitle,
    notification.runId ?? null,
    notification.title,
    notification.body,
    notification.severity,
    notification.status,
    notification.detectedAt,
    notification.readAt ?? null,
    notification.snoozedUntil ?? null,
    notification.sourceUrl ?? null,
    notification.dedupeKey,
    Number(notification.isDemo)
  );
}

export async function migrateLocalState(
  db: D1Database,
  userId: string,
  state: AppState,
  now = new Date()
): Promise<MigrationCounts> {
  await ensureUser(db, userId, now);
  const serverTimezone = (await getPreferences(db, userId)).timezone;
  const monitors = state.monitors
    .filter((monitor) => monitor.origin !== 'demo')
    .map((monitor) => ({
      ...monitor,
      schedule: { ...monitor.schedule, timezone: serverTimezone },
      nextRunAt: monitor.status === 'paused'
        ? undefined
        : getNextRunAt(now, monitor.schedule.frequency, monitor.schedule.time, serverTimezone)
    }));
  const runs = state.runs.filter((run) => !run.isDemo);
  const notifications = state.notifications.filter((notification) => !notification.isDemo);
  const monitorStatements = monitors.map((monitor) =>
    db.prepare(
      `INSERT OR IGNORE INTO monitors
        (user_id, id, title, instruction, category, source_url, status,
         schedule_frequency, schedule_time, schedule_timezone, severity,
         notifications_enabled, origin, last_run_at, last_success_at, next_run_at,
         last_outcome, last_summary, consecutive_failures, error_message,
         lease_until, lease_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
    ).bind(
      userId,
      monitor.id,
      monitor.title,
      monitor.instruction,
      monitor.category,
      monitor.sourceUrl ?? null,
      monitor.status,
      monitor.schedule.frequency,
      monitor.schedule.time,
      monitor.schedule.timezone,
      monitor.severity,
      Number(monitor.notificationsEnabled),
      monitor.origin,
      monitor.lastRunAt ?? null,
      monitor.lastSuccessAt ?? null,
      monitor.nextRunAt ?? null,
      monitor.lastOutcome,
      monitor.lastSummary,
      monitor.consecutiveFailures,
      monitor.errorMessage ?? null,
      monitor.createdAt,
      monitor.updatedAt
    )
  );
  const runStatements = runs.map((run) => insertMigratedRunStatement(db, userId, run));
  const notificationStatements = notifications.map((notification) =>
    insertMigratedNotificationStatement(db, userId, notification)
  );

  const statements = [
    ...monitorStatements,
    ...runStatements,
    ...notificationStatements
  ];
  const results = statements.length > 0 ? await db.batch(statements) : [];
  const monitorEnd = monitorStatements.length;
  const runEnd = monitorEnd + runStatements.length;
  const notificationEnd = runEnd + notificationStatements.length;
  const changes = (start: number, end: number) =>
    results.slice(start, end).reduce((total, result) => total + result.meta.changes, 0);

  return {
    monitors: changes(0, monitorEnd),
    runs: changes(monitorEnd, runEnd),
    notifications: changes(runEnd, notificationEnd)
  };
}
