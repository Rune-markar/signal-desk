import { describe, expect, it } from 'vitest';
import { createInitialState } from './seed';
import { appReducer, buildDemoRun, buildMonitor, emptyState } from './store';

describe('appReducer', () => {
  it('creates a paused monitor and resumes it with a next run', () => {
    const now = new Date('2026-08-22T00:00:00.000Z');
    const monitor = buildMonitor(
      {
        title: '新しい監視',
        instruction: '更新があれば知らせる',
        category: 'website',
        frequency: 'daily',
        time: '09:00',
        severity: 'warning',
        notificationsEnabled: true,
        startActive: false
      },
      { id: 'monitor-1', now, timezone: 'Asia/Tokyo' }
    );
    const created = appReducer(emptyState(), { type: 'monitor/create', monitor });
    expect(created.monitors[0]?.status).toBe('paused');
    expect(created.monitors[0]?.lastSummary).toBe('初回確認を待っています');

    const resumed = appReducer(created, {
      type: 'monitor/toggle',
      monitorId: 'monitor-1',
      at: now.toISOString()
    });
    expect(resumed.monitors[0]?.status).toBe('active');
    expect(resumed.monitors[0]?.nextRunAt).toBeTruthy();
    expect(resumed.monitors[0]?.lastSummary).toBe('初回確認を待っています');
  });

  it('keeps the latest result when a running monitor is paused', () => {
    const state = createInitialState(new Date('2026-08-22T00:00:00.000Z'));
    const monitor = state.monitors.find((item) => item.id === 'demo-price')!;
    const paused = appReducer(state, {
      type: 'monitor/toggle',
      monitorId: monitor.id,
      at: '2026-08-22T01:00:00.000Z'
    });

    expect(paused.monitors.find((item) => item.id === monitor.id)?.lastSummary).toBe(monitor.lastSummary);
  });

  it('records a manual run and deduplicates notifications by key', () => {
    const state = createInitialState(new Date('2026-08-22T00:00:00.000Z'));
    const monitor = state.monitors[0]!;
    const runResult = buildDemoRun(monitor, {
      now: new Date('2026-08-22T01:00:00.000Z'),
      runId: 'run-new',
      notificationId: 'notification-new'
    });
    const action = { type: 'monitor/run-completed' as const, monitorId: monitor.id, ...runResult };
    const first = appReducer(state, action);
    const second = appReducer(first, action);

    expect(first.runs[0]?.id).toBe('run-new');
    expect(first.notifications.filter((item) => item.dedupeKey === runResult.notification?.dedupeKey)).toHaveLength(1);
    expect(second.notifications.filter((item) => item.dedupeKey === runResult.notification?.dedupeKey)).toHaveLength(1);
  });

  it('records a manual run without resuming a paused monitor', () => {
    const state = createInitialState(new Date('2026-08-22T00:00:00.000Z'));
    const monitor = state.monitors.find((item) => item.id === 'demo-site')!;
    const runResult = buildDemoRun(monitor, {
      now: new Date('2026-08-22T01:00:00.000Z'),
      runId: 'paused-run',
      notificationId: 'paused-notification'
    });

    const next = appReducer(state, {
      type: 'monitor/run-completed',
      monitorId: monitor.id,
      ...runResult
    });
    const updated = next.monitors.find((item) => item.id === monitor.id);

    expect(updated?.status).toBe('paused');
    expect(updated?.nextRunAt).toBeUndefined();
    expect(updated?.lastRunAt).toBe(monitor.lastRunAt);
    expect(next.runs[0]?.status).toBe('simulated');
  });

  it('marks a failed run as an error without overwriting the last success', () => {
    const state = createInitialState(new Date('2026-08-22T00:00:00.000Z'));
    const monitor = state.monitors.find((item) => item.id === 'demo-price')!;
    const failedAt = '2026-08-22T02:00:00.000Z';
    const previousSuccess = monitor.lastSuccessAt;

    const failed = appReducer(state, {
      type: 'monitor/run-completed',
      monitorId: monitor.id,
      at: failedAt,
      nextRunAt: '2026-08-22T03:00:00.000Z',
      run: {
        id: 'failed-run',
        monitorId: monitor.id,
        monitorTitle: monitor.title,
        status: 'failed',
        summary: '取得先が応答しませんでした',
        evidenceUrls: [],
        startedAt: failedAt,
        finishedAt: failedAt,
        isDemo: false
      }
    });
    const updated = failed.monitors.find((item) => item.id === monitor.id);

    expect(updated?.status).toBe('error');
    expect(updated?.lastSuccessAt).toBe(previousSuccess);
    expect(updated?.consecutiveFailures).toBe(monitor.consecutiveFailures + 1);
    expect(updated?.errorMessage).toBe('取得先が応答しませんでした');
  });

  it('keeps audit notifications after a monitor is deleted', () => {
    const state = createInitialState(new Date('2026-08-22T00:00:00.000Z'));
    const next = appReducer(state, { type: 'monitor/delete', monitorId: 'demo-price' });
    expect(next.monitors.some((monitor) => monitor.id === 'demo-price')).toBe(false);
    expect(next.notifications.some((notification) => notification.monitorId === 'demo-price')).toBe(true);
  });

  it('restores a due snoozed notification to unread', () => {
    const state = createInitialState(new Date('2026-08-22T00:00:00.000Z'));
    const snoozed = appReducer(state, {
      type: 'notification/snooze',
      notificationId: 'demo-notification-price',
      until: '2026-08-22T01:00:00.000Z'
    });
    const restored = appReducer(snoozed, {
      type: 'notification/restore-due',
      at: '2026-08-22T01:00:01.000Z'
    });
    expect(restored.notifications.find((item) => item.id === 'demo-notification-price')?.status).toBe('unread');
  });

  it('marks only unread notifications and preserves an existing read timestamp', () => {
    const state = createInitialState(new Date('2026-08-22T00:00:00.000Z'));
    const existingReadAt = state.notifications.find(
      (notification) => notification.id === 'demo-notification-welcome'
    )?.readAt;
    const next = appReducer(state, {
      type: 'notification/read-all',
      at: '2026-08-22T02:00:00.000Z'
    });

    expect(next.notifications.find((item) => item.id === 'demo-notification-price')?.readAt).toBe(
      '2026-08-22T02:00:00.000Z'
    );
    expect(next.notifications.find((item) => item.id === 'demo-notification-welcome')?.readAt).toBe(
      existingReadAt
    );
  });

  it('restores demo records without replacing user data or preferences', () => {
    const now = new Date('2026-08-22T00:00:00.000Z');
    const userMonitor = buildMonitor(
      {
        title: 'ユーザー監視',
        instruction: 'ユーザーが作成した監視を残す',
        category: 'news',
        frequency: 'daily',
        time: '09:00',
        severity: 'warning',
        notificationsEnabled: true,
        startActive: true
      },
      { id: 'user-monitor', now, timezone: 'UTC' }
    );
    const withoutDemo = appReducer(
      appReducer(createInitialState(now), { type: 'monitor/create', monitor: userMonitor }),
      { type: 'demo/clear' }
    );
    const customized = appReducer(withoutDemo, {
      type: 'preferences/update',
      preferences: { timezone: 'UTC', quietHoursEnabled: false },
      at: now.toISOString()
    });

    const restored = appReducer(customized, {
      type: 'demo/reset',
      demoState: createInitialState(now)
    });

    expect(restored.monitors.some((monitor) => monitor.id === 'user-monitor')).toBe(true);
    expect(restored.monitors.some((monitor) => monitor.origin === 'demo')).toBe(true);
    expect(restored.preferences.timezone).toBe('UTC');
    expect(restored.preferences.quietHoursEnabled).toBe(false);
    expect(restored.preferences.demoMode).toBe(true);
  });

  it('recalculates active schedules when the timezone changes', () => {
    const now = new Date('2026-08-21T23:30:00.000Z');
    const monitor = buildMonitor(
      {
        title: '時刻確認',
        instruction: '毎朝確認する',
        category: 'report',
        frequency: 'daily',
        time: '09:00',
        severity: 'info',
        notificationsEnabled: true,
        startActive: true
      },
      { id: 'timezone-monitor', now, timezone: 'UTC' }
    );
    const state = appReducer(
      { ...emptyState(), preferences: { ...emptyState().preferences, timezone: 'UTC' } },
      { type: 'monitor/create', monitor }
    );

    const updated = appReducer(state, {
      type: 'preferences/update',
      preferences: { timezone: 'Asia/Tokyo' },
      at: now.toISOString()
    });
    const changed = updated.monitors[0];

    expect(changed?.schedule.timezone).toBe('Asia/Tokyo');
    expect(changed?.nextRunAt).toBe('2026-08-22T00:00:00.000Z');
  });

  it('normalizes an empty hourly time before a monitor can be persisted', () => {
    const monitor = buildMonitor(
      {
        title: '毎時確認',
        instruction: '1時間ごとに確認する',
        category: 'website',
        frequency: 'hourly',
        time: '',
        severity: 'info',
        notificationsEnabled: false,
        startActive: true
      },
      { id: 'hourly-monitor', now: new Date('2026-08-22T00:00:00.000Z'), timezone: 'Asia/Tokyo' }
    );

    expect(monitor.schedule.time).toBe('09:00');
  });

  it('rejects invalid quiet-hour updates and keeps the last valid values', () => {
    const state = emptyState();
    const updated = appReducer(state, {
      type: 'preferences/update',
      preferences: { quietFrom: '', quietTo: '99:99' },
      at: '2026-08-22T00:00:00.000Z'
    });

    expect(updated.preferences.quietFrom).toBe('22:00');
    expect(updated.preferences.quietTo).toBe('07:00');
  });
});
