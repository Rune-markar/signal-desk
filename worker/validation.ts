import { z } from 'zod';
import type {
  AppPreferences,
  AppState,
  MonitorInput,
  MonitorStatus,
  NotificationStatus
} from '../src/domain/model';
import { isSafePublicHttpsUrl } from '../src/domain/publicUrl';

const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const nonEmptyId = z.string().trim().min(1).max(200);
const isoDateTime = z.string().refine((value) => {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && value.includes('T');
}, 'ISO 8601形式の日時を指定してください');

const timezone = z.string().trim().min(1).max(100).refine((value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}, '有効なタイムゾーンを指定してください');

const sourceUrl = z.string().trim().max(2_048).refine((value) => {
  if (value.length === 0) return true;
  return isSafePublicHttpsUrl(value);
}, '公開ネットワーク上のHTTPS URLを指定してください');

const legacyImportUrl = z.string().trim().max(2_048).refine((value) => {
  if (value.length === 0) return true;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}, 'HTTPまたはHTTPSのURLを指定してください');

const category = z.enum(['market', 'news', 'website', 'report']);
const frequency = z.enum(['hourly', 'daily', 'weekdays', 'weekly']);
const severity = z.enum(['info', 'warning', 'critical']);
const origin = z.enum(['native', 'chatgpt-manual']);
export const MAX_MIGRATION_RECORDS_PER_REQUEST = 25;

export const loginInputSchema = z.object({
  secret: z.string().min(1).max(4_096)
}).strict();

export const logoutInputSchema = z.object({
  pushEndpoint: z.string().url().max(4_096).optional()
}).strict();

export const monitorInputSchema = z.object({
  title: z.string().trim().min(1).max(80),
  instruction: z.string().trim().min(1).max(500),
  category,
  sourceUrl: sourceUrl.optional(),
  frequency,
  time: clockTime,
  severity,
  notificationsEnabled: z.boolean(),
  startActive: z.boolean(),
  origin: origin.optional()
}).strict();

export const monitorPatchSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  instruction: z.string().trim().min(1).max(500).optional(),
  category: category.optional(),
  sourceUrl: sourceUrl.nullable().optional(),
  frequency: frequency.optional(),
  time: clockTime.optional(),
  severity: severity.optional(),
  notificationsEnabled: z.boolean().optional(),
  startActive: z.boolean().optional(),
  origin: origin.optional(),
  status: z.enum(['active', 'paused']).optional()
}).strict().refine((value) => Object.keys(value).length > 0, '変更項目を指定してください');

export type MonitorPatch = Omit<Partial<MonitorInput>, 'sourceUrl'> & {
  sourceUrl?: string | null;
  status?: Extract<MonitorStatus, 'active' | 'paused'>;
};

export const notificationPatchSchema = z.object({
  status: z.enum(['unread', 'read', 'snoozed']),
  snoozedUntil: isoDateTime.optional(),
  minutes: z.number().int().min(1).max(10_080).optional()
}).strict().superRefine((value, context) => {
  if (value.status === 'snoozed' && value.snoozedUntil === undefined && value.minutes === undefined) {
    context.addIssue({
      code: 'custom',
      message: 'スヌーズの終了時刻または分数を指定してください'
    });
  }
});

export type NotificationPatch = {
  status: NotificationStatus;
  snoozedUntil?: string;
  minutes?: number;
};

export const notificationBatchPatchSchema = z.object({
  status: z.literal('read'),
  notificationIds: z.array(nonEmptyId).max(98).optional()
}).strict();

export const preferencesPatchSchema = z.object({
  timezone: timezone.optional(),
  quietHoursEnabled: z.boolean().optional(),
  quietFrom: clockTime.optional(),
  quietTo: clockTime.optional(),
  pushEnabled: z.boolean().optional(),
  demoMode: z.boolean().optional()
}).strict().refine((value) => Object.keys(value).length > 0, '変更項目を指定してください');

const migrationMonitorSchema = z.object({
  id: nonEmptyId,
  title: z.string().trim().min(1).max(80),
  instruction: z.string().trim().min(1).max(500),
  category,
  sourceUrl: sourceUrl.optional(),
  status: z.enum(['active', 'paused', 'error']),
  schedule: z.object({
    frequency,
    time: clockTime,
    timezone
  }).strict(),
  severity,
  notificationsEnabled: z.boolean(),
  origin: z.enum(['native', 'chatgpt-manual', 'demo']),
  lastRunAt: isoDateTime.optional(),
  lastSuccessAt: isoDateTime.optional(),
  nextRunAt: isoDateTime.optional(),
  lastOutcome: z.enum(['matched', 'clear', 'failed', 'never']),
  lastSummary: z.string().max(4_000),
  consecutiveFailures: z.number().int().min(0).max(1_000_000),
  errorMessage: z.string().max(4_000).optional(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime
}).strict();

const migrationRunSchema = z.object({
  id: nonEmptyId,
  monitorId: nonEmptyId,
  monitorTitle: z.string().max(80),
  status: z.enum(['matched', 'clear', 'failed', 'simulated']),
  summary: z.string().max(8_000),
  evidenceUrls: z.array(sourceUrl).max(50),
  startedAt: isoDateTime,
  finishedAt: isoDateTime,
  isDemo: z.boolean()
}).strict();

const migrationNotificationSchema = z.object({
  id: nonEmptyId,
  monitorId: nonEmptyId,
  monitorTitle: z.string().max(80),
  runId: nonEmptyId.optional(),
  title: z.string().max(200),
  body: z.string().max(8_000),
  severity,
  status: z.enum(['unread', 'read', 'snoozed']),
  detectedAt: isoDateTime,
  readAt: isoDateTime.optional(),
  snoozedUntil: isoDateTime.optional(),
  sourceUrl: sourceUrl.optional(),
  dedupeKey: z.string().min(1).max(500),
  isDemo: z.boolean()
}).strict();

const preferencesSchema = z.object({
  timezone,
  quietHoursEnabled: z.boolean(),
  quietFrom: clockTime,
  quietTo: clockTime,
  pushEnabled: z.boolean(),
  demoMode: z.boolean()
}).strict();

export const localMigrationStateSchema = z.object({
  schemaVersion: z.literal(1),
  monitors: z.array(migrationMonitorSchema.extend({
    sourceUrl: legacyImportUrl.optional()
  })).max(5_000),
  runs: z.array(migrationRunSchema.extend({
    evidenceUrls: z.array(legacyImportUrl).max(50)
  })).max(5_000),
  notifications: z.array(migrationNotificationSchema.extend({
    sourceUrl: legacyImportUrl.optional()
  })).max(5_000),
  preferences: preferencesSchema
}).strict();

export const migrationStateSchema = z.object({
  schemaVersion: z.literal(1),
  monitors: z.array(migrationMonitorSchema).max(100),
  runs: z.array(migrationRunSchema).max(250),
  notifications: z.array(migrationNotificationSchema).max(250),
  preferences: preferencesSchema
}).strict();

export const migrationInputSchema = z.object({
  state: migrationStateSchema
}).strict().superRefine((value, context) => {
  const total = value.state.monitors.length
    + value.state.runs.length
    + value.state.notifications.length;
  if (total > MAX_MIGRATION_RECORDS_PER_REQUEST) {
    context.addIssue({
      code: 'custom',
      path: ['state'],
      message: `移行データは1回につき${MAX_MIGRATION_RECORDS_PER_REQUEST}件以下に分割してください`
    });
  }
});

export type MigrationInput = { state: AppState };

export function parseMonitorInput(value: unknown): MonitorInput {
  return monitorInputSchema.parse(value) as MonitorInput;
}

export function parseMonitorPatch(value: unknown): MonitorPatch {
  return monitorPatchSchema.parse(value) as MonitorPatch;
}

export function parseNotificationPatch(value: unknown): NotificationPatch {
  return notificationPatchSchema.parse(value) as NotificationPatch;
}

export function parsePreferencesPatch(value: unknown): Partial<AppPreferences> {
  return preferencesPatchSchema.parse(value) as Partial<AppPreferences>;
}

export function parseMigrationInput(value: unknown): MigrationInput {
  return migrationInputSchema.parse(value) as MigrationInput;
}
