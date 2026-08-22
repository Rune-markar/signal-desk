import type { AlertNotification, AppState, Monitor, MonitorRun } from './model';

export function unreadNotifications(state: AppState): AlertNotification[] {
  return state.notifications.filter((notification) => notification.status === 'unread');
}

export function activeMonitors(state: AppState): Monitor[] {
  return state.monitors.filter((monitor) => monitor.status === 'active');
}

export function issueMonitors(state: AppState): Monitor[] {
  return state.monitors.filter((monitor) => monitor.status === 'error');
}

export function upcomingMonitors(state: AppState): Monitor[] {
  return state.monitors
    .filter((monitor) => monitor.status === 'active' && monitor.nextRunAt)
    .sort(
      (a, b) =>
        new Date(a.nextRunAt ?? 0).getTime() - new Date(b.nextRunAt ?? 0).getTime()
    );
}

export function runsForMonitor(state: AppState, monitorId: string): MonitorRun[] {
  return state.runs
    .filter((run) => run.monitorId === monitorId)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}
