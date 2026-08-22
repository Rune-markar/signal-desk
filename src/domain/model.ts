export const APP_SCHEMA_VERSION = 1;

export type MonitorStatus = 'active' | 'paused' | 'error';
export type MonitorCategory = 'market' | 'news' | 'website' | 'report';
export type MonitorSeverity = 'info' | 'warning' | 'critical';
export type MonitorFrequency = 'hourly' | 'daily' | 'weekdays' | 'weekly';
export type MonitorOutcome = 'matched' | 'clear' | 'failed' | 'never';
export type MonitorOrigin = 'native' | 'chatgpt-manual' | 'demo';

export interface MonitorSchedule {
  frequency: MonitorFrequency;
  time: string;
  timezone: string;
}

export interface Monitor {
  id: string;
  title: string;
  instruction: string;
  category: MonitorCategory;
  sourceUrl?: string;
  status: MonitorStatus;
  schedule: MonitorSchedule;
  severity: MonitorSeverity;
  notificationsEnabled: boolean;
  origin: MonitorOrigin;
  lastRunAt?: string;
  lastSuccessAt?: string;
  nextRunAt?: string;
  lastOutcome: MonitorOutcome;
  lastSummary: string;
  consecutiveFailures: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export type RunStatus = 'matched' | 'clear' | 'failed' | 'simulated';

export interface MonitorRun {
  id: string;
  monitorId: string;
  monitorTitle: string;
  status: RunStatus;
  summary: string;
  evidenceUrls: string[];
  startedAt: string;
  finishedAt: string;
  isDemo: boolean;
}

export type NotificationStatus = 'unread' | 'read' | 'snoozed';

export interface AlertNotification {
  id: string;
  monitorId: string;
  monitorTitle: string;
  runId?: string;
  title: string;
  body: string;
  severity: MonitorSeverity;
  status: NotificationStatus;
  detectedAt: string;
  readAt?: string;
  snoozedUntil?: string;
  sourceUrl?: string;
  dedupeKey: string;
  isDemo: boolean;
}

export interface AppPreferences {
  timezone: string;
  quietHoursEnabled: boolean;
  quietFrom: string;
  quietTo: string;
  pushEnabled: boolean;
  demoMode: boolean;
}

export interface AppState {
  schemaVersion: typeof APP_SCHEMA_VERSION;
  monitors: Monitor[];
  runs: MonitorRun[];
  notifications: AlertNotification[];
  preferences: AppPreferences;
}

export interface MonitorInput {
  title: string;
  instruction: string;
  category: MonitorCategory;
  sourceUrl?: string;
  frequency: MonitorFrequency;
  time: string;
  severity: MonitorSeverity;
  notificationsEnabled: boolean;
  startActive: boolean;
  origin?: MonitorOrigin;
}
