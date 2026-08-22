import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode
} from 'react';
import { createInitialState } from '../domain/seed';
import { buildDemoRun, buildMonitor, appReducer } from '../domain/store';
import { loadState, saveState } from '../domain/storage';
import type { AppPreferences, AppState, MonitorInput } from '../domain/model';

interface AppStateContextValue {
  state: AppState;
  storageStatus: 'saved' | 'error';
  createMonitor: (input: MonitorInput) => string;
  updateMonitor: (monitorId: string, input: MonitorInput) => boolean;
  deleteMonitor: (monitorId: string) => void;
  toggleMonitor: (monitorId: string) => void;
  runMonitorNow: (monitorId: string) => boolean;
  markNotificationRead: (notificationId: string) => void;
  markAllNotificationsRead: () => void;
  snoozeNotification: (notificationId: string, minutes?: number) => void;
  updatePreferences: (preferences: Partial<AppPreferences>) => void;
  clearDemoData: () => void;
  resetDemoData: () => void;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

function createId(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${id}`;
}

interface AppStateProviderProps {
  children: ReactNode;
  initialState?: AppState;
  storage?: Storage;
}

export function AppStateProvider({ children, initialState, storage }: AppStateProviderProps) {
  const targetStorage = useMemo(() => {
    if (storage) return storage;
    try {
      return typeof window !== 'undefined' ? window.localStorage : undefined;
    } catch {
      return undefined;
    }
  }, [storage]);
  const [state, dispatch] = useReducer(
    appReducer,
    initialState,
    (provided) => provided ?? (targetStorage ? loadState(targetStorage) : null) ?? createInitialState()
  );
  const [storageStatus, setStorageStatus] = useState<'saved' | 'error'>(
    targetStorage ? 'saved' : 'error'
  );

  useEffect(() => {
    setStorageStatus(targetStorage && saveState(targetStorage, state) ? 'saved' : 'error');
  }, [state, targetStorage]);

  useEffect(() => {
    const restore = () => dispatch({ type: 'notification/restore-due', at: new Date().toISOString() });
    restore();
    const timer = window.setInterval(restore, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const createMonitor = useCallback(
    (input: MonitorInput) => {
      const id = createId('monitor');
      dispatch({
        type: 'monitor/create',
        monitor: buildMonitor(input, {
          id,
          now: new Date(),
          timezone: state.preferences.timezone
        })
      });
      return id;
    },
    [state.preferences.timezone]
  );

  const updateMonitor = useCallback(
    (monitorId: string, input: MonitorInput) => {
      const existing = state.monitors.find((monitor) => monitor.id === monitorId);
      if (!existing) return false;
      dispatch({
        type: 'monitor/update',
        monitor: buildMonitor(input, {
          id: monitorId,
          now: new Date(),
          timezone: state.preferences.timezone,
          existing
        })
      });
      return true;
    },
    [state.monitors, state.preferences.timezone]
  );

  const deleteMonitor = useCallback((monitorId: string) => {
    dispatch({ type: 'monitor/delete', monitorId });
  }, []);

  const toggleMonitor = useCallback((monitorId: string) => {
    dispatch({ type: 'monitor/toggle', monitorId, at: new Date().toISOString() });
  }, []);

  const runMonitorNow = useCallback(
    (monitorId: string) => {
      const monitor = state.monitors.find((item) => item.id === monitorId);
      if (!monitor) return false;
      const result = buildDemoRun(monitor, {
        now: new Date(),
        runId: createId('run'),
        notificationId: createId('notification')
      });
      dispatch({ type: 'monitor/run-completed', monitorId, ...result });
      return true;
    },
    [state.monitors]
  );

  const markNotificationRead = useCallback((notificationId: string) => {
    dispatch({ type: 'notification/read', notificationId, at: new Date().toISOString() });
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    dispatch({ type: 'notification/read-all', at: new Date().toISOString() });
  }, []);

  const snoozeNotification = useCallback((notificationId: string, minutes = 60) => {
    dispatch({
      type: 'notification/snooze',
      notificationId,
      until: new Date(Date.now() + minutes * 60_000).toISOString()
    });
  }, []);

  const updatePreferences = useCallback((preferences: Partial<AppPreferences>) => {
    dispatch({ type: 'preferences/update', preferences, at: new Date().toISOString() });
  }, []);

  const clearDemoData = useCallback(() => dispatch({ type: 'demo/clear' }), []);
  const resetDemoData = useCallback(
    () => dispatch({ type: 'demo/reset', demoState: createInitialState() }),
    []
  );

  const value = useMemo<AppStateContextValue>(
    () => ({
      state,
      storageStatus,
      createMonitor,
      updateMonitor,
      deleteMonitor,
      toggleMonitor,
      runMonitorNow,
      markNotificationRead,
      markAllNotificationsRead,
      snoozeNotification,
      updatePreferences,
      clearDemoData,
      resetDemoData
    }),
    [
      state,
      storageStatus,
      createMonitor,
      updateMonitor,
      deleteMonitor,
      toggleMonitor,
      runMonitorNow,
      markNotificationRead,
      markAllNotificationsRead,
      snoozeNotification,
      updatePreferences,
      clearDemoData,
      resetDemoData
    ]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateContextValue {
  const value = useContext(AppStateContext);
  if (!value) throw new Error('useAppState must be used inside AppStateProvider');
  return value;
}
