import { APP_SCHEMA_VERSION, type AlertNotification, type AppPreferences, type AppState, type Monitor, type MonitorInput, type MonitorRun } from './model';
import { getNextRunAt, isClockTime, normalizeScheduleTime } from './schedule';

export type AppAction =
  | { type: 'monitor/create'; monitor: Monitor }
  | { type: 'monitor/update'; monitor: Monitor }
  | { type: 'monitor/delete'; monitorId: string }
  | { type: 'monitor/toggle'; monitorId: string; at: string }
  | {
      type: 'monitor/run-completed';
      monitorId: string;
      at: string;
      nextRunAt: string;
      run: MonitorRun;
      notification?: AlertNotification;
    }
  | { type: 'notification/read'; notificationId: string; at: string }
  | { type: 'notification/read-all'; at: string }
  | { type: 'notification/snooze'; notificationId: string; until: string }
  | { type: 'notification/restore-due'; at: string }
  | { type: 'preferences/update'; preferences: Partial<AppPreferences>; at: string }
  | { type: 'demo/clear' }
  | { type: 'demo/reset'; demoState: AppState }
  | { type: 'state/replace'; state: AppState };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'monitor/create':
      return { ...state, monitors: [action.monitor, ...state.monitors] };
    case 'monitor/update':
      return {
        ...state,
        monitors: state.monitors.map((monitor) =>
          monitor.id === action.monitor.id ? action.monitor : monitor
        )
      };
    case 'monitor/delete':
      return {
        ...state,
        monitors: state.monitors.filter((monitor) => monitor.id !== action.monitorId)
      };
    case 'monitor/toggle':
      return {
        ...state,
        monitors: state.monitors.map((monitor) => {
          if (monitor.id !== action.monitorId) return monitor;
          const status = monitor.status === 'paused' ? 'active' : 'paused';
          return {
            ...monitor,
            status,
            nextRunAt:
              status === 'active'
                ? getNextRunAt(
                    new Date(action.at),
                    monitor.schedule.frequency,
                    monitor.schedule.time,
                    monitor.schedule.timezone
                  )
                : undefined,
            updatedAt: action.at
          };
        })
      };
    case 'monitor/run-completed':
      return {
        ...state,
        monitors: state.monitors.map((monitor) =>
          monitor.id === action.monitorId
            ? (() => {
                if (action.run.status === 'simulated') return monitor;
                const failed = action.run.status === 'failed';
                const paused = monitor.status === 'paused';
                return {
                  ...monitor,
                  status: paused ? 'paused' : failed ? 'error' : 'active',
                  lastRunAt: action.at,
                  lastSuccessAt: failed ? monitor.lastSuccessAt : action.at,
                  nextRunAt: paused ? undefined : action.nextRunAt,
                  lastOutcome: action.run.status,
                  lastSummary: action.run.summary,
                  consecutiveFailures: failed ? monitor.consecutiveFailures + 1 : 0,
                  errorMessage: failed ? action.run.summary : undefined,
                  updatedAt: action.at
                };
              })()
            : monitor
        ),
        runs: [action.run, ...state.runs],
        notifications:
          action.notification &&
          !state.notifications.some(
            (notification) => notification.dedupeKey === action.notification?.dedupeKey
          )
            ? [action.notification, ...state.notifications]
            : state.notifications
      };
    case 'notification/read':
      return {
        ...state,
        notifications: state.notifications.map((notification) =>
          notification.id === action.notificationId
            ? { ...notification, status: 'read', readAt: action.at, snoozedUntil: undefined }
            : notification
        )
      };
    case 'notification/read-all':
      return {
        ...state,
        notifications: state.notifications.map((notification) =>
          notification.status === 'unread'
            ? { ...notification, status: 'read', readAt: action.at }
            : notification
        )
      };
    case 'notification/snooze':
      return {
        ...state,
        notifications: state.notifications.map((notification) =>
          notification.id === action.notificationId
            ? {
                ...notification,
                status: 'snoozed',
                snoozedUntil: action.until,
                readAt: undefined
              }
            : notification
        )
      };
    case 'notification/restore-due': {
      const now = new Date(action.at).getTime();
      return {
        ...state,
        notifications: state.notifications.map((notification) =>
          notification.status === 'snoozed' &&
          notification.snoozedUntil &&
          new Date(notification.snoozedUntil).getTime() <= now
            ? { ...notification, status: 'unread', snoozedUntil: undefined }
            : notification
        )
      };
    }
    case 'preferences/update': {
      const preferences = { ...action.preferences };
      if (preferences.quietFrom !== undefined && !isClockTime(preferences.quietFrom)) {
        delete preferences.quietFrom;
      }
      if (preferences.quietTo !== undefined && !isClockTime(preferences.quietTo)) {
        delete preferences.quietTo;
      }
      return preferences.timezone && preferences.timezone !== state.preferences.timezone
        ? {
            ...state,
            monitors: state.monitors.map((monitor) => ({
              ...monitor,
              schedule: { ...monitor.schedule, timezone: preferences.timezone! },
              nextRunAt:
                monitor.status === 'paused'
                  ? undefined
                  : getNextRunAt(
                      new Date(action.at),
                      monitor.schedule.frequency,
                      monitor.schedule.time,
                      preferences.timezone
                    ),
              updatedAt: action.at
            })),
            preferences: { ...state.preferences, ...preferences }
          }
        : {
            ...state,
            preferences: { ...state.preferences, ...preferences }
          };
    }
    case 'demo/clear':
      return {
        ...state,
        monitors: state.monitors.filter((monitor) => monitor.origin !== 'demo'),
        runs: state.runs.filter((run) => !run.isDemo),
        notifications: state.notifications.filter((notification) => !notification.isDemo),
        preferences: { ...state.preferences, demoMode: false }
      };
    case 'demo/reset':
      return {
        ...state,
        monitors: [
          ...action.demoState.monitors,
          ...state.monitors.filter((monitor) => monitor.origin !== 'demo')
        ],
        runs: [
          ...action.demoState.runs,
          ...state.runs.filter((run) => !run.isDemo)
        ],
        notifications: [
          ...action.demoState.notifications,
          ...state.notifications.filter((notification) => !notification.isDemo)
        ],
        preferences: { ...state.preferences, demoMode: true }
      };
    case 'state/replace':
      return action.state;
  }
}

export function buildMonitor(
  input: MonitorInput,
  options: { id: string; now: Date; timezone: string; existing?: Monitor }
): Monitor {
  const at = options.now.toISOString();
  const status = input.startActive ? 'active' : 'paused';
  const sourceUrl = input.sourceUrl?.trim() || undefined;
  const scheduleTime = normalizeScheduleTime(input.time);
  return {
    id: options.existing?.id ?? options.id,
    title: input.title.trim(),
    instruction: input.instruction.trim(),
    category: input.category,
    sourceUrl,
    status,
    schedule: {
      frequency: input.frequency,
      time: scheduleTime,
      timezone: options.timezone
    },
    severity: input.severity,
    notificationsEnabled: input.notificationsEnabled,
    origin: input.origin ?? options.existing?.origin ?? 'native',
    lastRunAt: options.existing?.lastRunAt,
    lastSuccessAt: options.existing?.lastSuccessAt,
    nextRunAt:
      status === 'active'
        ? getNextRunAt(options.now, input.frequency, scheduleTime, options.timezone)
        : undefined,
    lastOutcome: options.existing?.lastOutcome ?? 'never',
    lastSummary: options.existing?.lastSummary ?? '初回確認を待っています',
    consecutiveFailures: options.existing?.consecutiveFailures ?? 0,
    errorMessage: undefined,
    createdAt: options.existing?.createdAt ?? at,
    updatedAt: at
  };
}

export function buildDemoRun(
  monitor: Monitor,
  options: { now: Date; runId: string; notificationId: string }
): Pick<Extract<AppAction, { type: 'monitor/run-completed' }>, 'run' | 'notification' | 'nextRunAt' | 'at'> {
  const at = options.now.toISOString();
  const summary = '手動確認を完了しました。外部接続前のため、これはデモ結果です。';
  const run: MonitorRun = {
    id: options.runId,
    monitorId: monitor.id,
    monitorTitle: monitor.title,
    status: 'simulated',
    summary,
    evidenceUrls: [],
    startedAt: at,
    finishedAt: at,
    isDemo: true
  };
  const notification: AlertNotification | undefined = monitor.notificationsEnabled
    ? {
        id: options.notificationId,
        monitorId: monitor.id,
        monitorTitle: monitor.title,
        runId: run.id,
        title: 'デモ結果を追加しました',
        body: summary,
        severity: 'info',
        status: 'unread',
        detectedAt: at,
        dedupeKey: `${monitor.id}:${options.runId}`,
        isDemo: true
      }
    : undefined;

  return {
    at,
    run,
    notification,
    nextRunAt: getNextRunAt(
      options.now,
      monitor.schedule.frequency,
      monitor.schedule.time,
      monitor.schedule.timezone
    )
  };
}

export function emptyState(): AppState {
  return {
    schemaVersion: APP_SCHEMA_VERSION,
    monitors: [],
    runs: [],
    notifications: [],
    preferences: {
      timezone: 'Asia/Tokyo',
      quietHoursEnabled: true,
      quietFrom: '22:00',
      quietTo: '07:00',
      pushEnabled: false,
      demoMode: false
    }
  };
}
