import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode
} from 'react';
import * as api from '../api/client';
import { createInitialState } from '../domain/seed';
import { buildDemoRun, buildMonitor, appReducer } from '../domain/store';
import { isSafePublicHttpsUrl } from '../domain/publicUrl';
import {
  isMigrationFileState,
  loadState,
  saveState,
  SERVER_CACHE_KEY,
  STORAGE_KEY
} from '../domain/storage';
import type { AppPreferences, AppState, MonitorInput } from '../domain/model';

const MIGRATION_KEY = 'signal-desk.server-migration.v1';
const PUSH_ENDPOINT_KEY = 'signal-desk.push-endpoint.v1';
const MIGRATION_CHUNK_SIZE = 25;
const MAX_MIGRATION_FILE_BYTES = 1_048_576;

export type ConnectionStatus = 'checking' | 'local' | 'signed-out' | 'connected' | 'offline';
export type PushAvailability = 'unknown' | 'unsupported' | 'unconfigured' | 'available';

export interface ConnectionState {
  status: ConnectionStatus;
  error?: string;
  lastSyncedAt?: string;
}

export interface PushState {
  availability: PushAvailability;
  subscribed: boolean;
  error?: string;
}

export interface MigrationBlocker {
  monitorId: string;
  title: string;
  sourceUrl: string;
}

export interface MigrationSummary {
  monitors: number;
  runs: number;
  notifications: number;
  completed: boolean;
  blockers: MigrationBlocker[];
}

interface AppStateContextValue {
  state: AppState;
  storageStatus: 'saved' | 'error';
  connection: ConnectionState;
  operationError?: string;
  busy: boolean;
  push: PushState;
  migration: MigrationSummary;
  createMonitor: (input: MonitorInput) => Promise<boolean>;
  updateMonitor: (monitorId: string, input: MonitorInput) => Promise<boolean>;
  deleteMonitor: (monitorId: string) => Promise<boolean>;
  toggleMonitor: (monitorId: string) => Promise<boolean>;
  runMonitorNow: (monitorId: string) => Promise<boolean>;
  markNotificationRead: (notificationId: string) => Promise<boolean>;
  markAllNotificationsRead: () => Promise<boolean>;
  snoozeNotification: (notificationId: string, minutes?: number) => Promise<boolean>;
  updatePreferences: (preferences: Partial<AppPreferences>) => Promise<boolean>;
  clearDemoData: () => void;
  resetDemoData: () => void;
  login: (secret: string) => Promise<boolean>;
  logout: () => Promise<boolean>;
  refreshState: () => Promise<boolean>;
  migrateLocalData: () => Promise<boolean>;
  exportLocalData: () => string | null;
  importLocalData: (file: File) => Promise<boolean>;
  refreshPushState: () => Promise<void>;
  subscribePush: () => Promise<boolean>;
  unsubscribePush: () => Promise<boolean>;
  clearOperationError: () => void;
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

function createId(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-local`;
  return `${prefix}-${id}`;
}

function migrationState(source: AppState): AppState {
  return {
    ...source,
    monitors: source.monitors.filter((monitor) => monitor.origin !== 'demo'),
    runs: source.runs
      .filter((run) => !run.isDemo)
      .map((run) => ({
        ...run,
        evidenceUrls: run.evidenceUrls.filter(isSafePublicHttpsUrl)
      })),
    notifications: source.notifications
      .filter((notification) => !notification.isDemo)
      .map((notification) => ({
        ...notification,
        sourceUrl: notification.sourceUrl && isSafePublicHttpsUrl(notification.sourceUrl)
          ? notification.sourceUrl
          : undefined
      })),
    preferences: { ...source.preferences, demoMode: false }
  };
}

function migrationBlockers(source: AppState): MigrationBlocker[] {
  return source.monitors.flatMap((monitor) => {
    const sourceUrl = monitor.sourceUrl?.trim();
    if (!sourceUrl) return [];
    if (isSafePublicHttpsUrl(sourceUrl)) return [];
    return [{ monitorId: monitor.id, title: monitor.title, sourceUrl }];
  });
}

function migrationChunks(source: AppState): AppState[] {
  const chunks: AppState[] = [];
  let monitorIndex = 0;
  let runIndex = 0;
  let notificationIndex = 0;

  while (
    monitorIndex < source.monitors.length ||
    runIndex < source.runs.length ||
    notificationIndex < source.notifications.length
  ) {
    let remaining = MIGRATION_CHUNK_SIZE;
    const monitors = source.monitors.slice(monitorIndex, monitorIndex + remaining);
    monitorIndex += monitors.length;
    remaining -= monitors.length;
    const runs = source.runs.slice(runIndex, runIndex + remaining);
    runIndex += runs.length;
    remaining -= runs.length;
    const notifications = source.notifications.slice(
      notificationIndex,
      notificationIndex + remaining
    );
    notificationIndex += notifications.length;
    chunks.push({ ...source, monitors, runs, notifications });
  }

  return chunks;
}

function mergeById<T extends { id: string }>(current: T[], imported: T[]): T[] {
  const merged = new Map(current.map((item) => [item.id, item]));
  for (const item of imported) merged.set(item.id, item);
  return [...merged.values()];
}

function mergeMigrationState(current: AppState, imported: AppState): AppState {
  const currentReal = migrationState(current);
  const importedReal = migrationState(imported);
  return {
    ...importedReal,
    monitors: mergeById(currentReal.monitors, importedReal.monitors),
    runs: mergeById(currentReal.runs, importedReal.runs),
    notifications: mergeById(currentReal.notifications, importedReal.notifications),
    preferences: { ...importedReal.preferences, demoMode: false }
  };
}

function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  );
}

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padded = `${value}${'='.repeat((4 - (value.length % 4)) % 4)}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const decoded = window.atob(padded);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

interface AppStateProviderProps {
  children: ReactNode;
  initialState?: AppState;
  storage?: Storage;
  connectToBackend?: boolean;
}

function shouldProbeBackend(): boolean {
  if (typeof window === 'undefined') return false;
  if (import.meta.env.DEV) return false;
  return !window.location.hostname.toLowerCase().endsWith('.github.io');
}

export function AppStateProvider({ children, initialState, storage, connectToBackend }: AppStateProviderProps) {
  const targetStorage = useMemo(() => {
    if (storage) return storage;
    try {
      return typeof window !== 'undefined' ? window.localStorage : undefined;
    } catch {
      return undefined;
    }
  }, [storage]);
  const shouldConnect = connectToBackend ?? (initialState === undefined && shouldProbeBackend());
  const initialStates = useMemo(() => {
    const local = initialState ?? (targetStorage ? loadState(targetStorage, STORAGE_KEY) : null) ?? createInitialState();
    return { display: local, local };
  }, [initialState, targetStorage]);
  const [state, dispatch] = useReducer(
    appReducer,
    initialStates.display
  );
  const localSnapshotRef = useRef(initialStates.local);
  const serverStateLoadedRef = useRef(false);
  const [storageStatus, setStorageStatus] = useState<'saved' | 'error'>(
    targetStorage ? 'saved' : 'error'
  );
  const [connection, setConnection] = useState<ConnectionState>({
    status: shouldConnect ? 'checking' : 'local'
  });
  const [operationError, setOperationError] = useState<string>();
  const [busyCount, setBusyCount] = useState(0);
  const [push, setPush] = useState<PushState>({
    availability: isPushSupported() ? 'unknown' : 'unsupported',
    subscribed: false
  });
  const [migrationCompleted, setMigrationCompleted] = useState(() => {
    try {
      return targetStorage?.getItem(MIGRATION_KEY) === 'complete';
    } catch {
      return false;
    }
  });

  const [localMigrationState, setLocalMigrationState] = useState(() => migrationState(initialStates.local));
  const migration = useMemo<MigrationSummary>(
    () => ({
      monitors: localMigrationState.monitors.length,
      runs: localMigrationState.runs.length,
      notifications: localMigrationState.notifications.length,
      completed: migrationCompleted,
      blockers: migrationBlockers(localMigrationState)
    }),
    [localMigrationState, migrationCompleted]
  );

  useEffect(() => {
    if (!targetStorage) {
      setStorageStatus('error');
      return;
    }
    if (
      connection.status === 'connected' ||
      (connection.status === 'offline' && serverStateLoadedRef.current)
    ) {
      setStorageStatus(saveState(targetStorage, state, SERVER_CACHE_KEY) ? 'saved' : 'error');
      return;
    }
    if (connection.status === 'local' || connection.status === 'signed-out') {
      const saved = saveState(targetStorage, state, STORAGE_KEY);
      setStorageStatus(saved ? 'saved' : 'error');
      localSnapshotRef.current = state;
      setLocalMigrationState(migrationState(state));
    }
  }, [connection.status, state, targetStorage]);

  const acceptServerPayload = useCallback((payload: unknown): boolean => {
    const nextState = api.stateFromPayload(payload);
    if (!nextState) return false;
    serverStateLoadedRef.current = true;
    dispatch({ type: 'state/replace', state: nextState });
    setConnection((current) => ({
      ...current,
      status: 'connected',
      error: undefined,
      lastSyncedAt: new Date().toISOString()
    }));
    return true;
  }, []);

  const loadServerState = useCallback(async (): Promise<boolean> => {
    const payload = await api.getState();
    if (!acceptServerPayload(payload)) {
      throw new api.ApiError('サーバーの保存データを確認できませんでした', 502, 'invalid_state');
    }
    return true;
  }, [acceptServerPayload]);

  const clearServerCache = useCallback(() => {
    serverStateLoadedRef.current = false;
    try {
      targetStorage?.removeItem(SERVER_CACHE_KEY);
    } catch {
      setStorageStatus('error');
    }
  }, [targetStorage]);

  const handleRequestError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : 'サーバーとの通信に失敗しました';
    setOperationError(message);
    if (error instanceof api.ApiError && error.status === 401) {
      clearServerCache();
      dispatch({ type: 'state/replace', state: localSnapshotRef.current });
      setConnection({ status: 'signed-out', error: 'セッションの有効期限が切れました' });
    } else if (!(error instanceof api.ApiError)) {
      setConnection((current) =>
        current.status === 'connected' ? { ...current, status: 'offline', error: message } : current
      );
    }
  }, [clearServerCache]);

  const withBusy = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    setBusyCount((count) => count + 1);
    try {
      return await operation();
    } finally {
      setBusyCount((count) => Math.max(0, count - 1));
    }
  }, []);

  const probeBackend = useCallback(async (): Promise<void> => {
    if (!shouldConnect) return;
    setConnection((current) => ({ ...current, status: 'checking', error: undefined }));
    try {
      const status = await api.getAuthStatus();
      if (!status.available) {
        clearServerCache();
        dispatch({ type: 'state/replace', state: localSnapshotRef.current });
        setConnection({ status: 'local' });
        return;
      }
      if (!status.authenticated) {
        clearServerCache();
        dispatch({ type: 'state/replace', state: localSnapshotRef.current });
        setConnection({ status: 'signed-out' });
        return;
      }
      await loadServerState();
    } catch (error) {
      if (error instanceof api.ApiError && [404, 405].includes(error.status)) {
        clearServerCache();
        dispatch({ type: 'state/replace', state: localSnapshotRef.current });
        setConnection({ status: 'local' });
        return;
      }
      const message = error instanceof Error ? error.message : '監視サービスへ接続できませんでした';
      setConnection({ status: 'offline', error: message });
    }
  }, [clearServerCache, loadServerState, shouldConnect]);

  useEffect(() => {
    void probeBackend();
  }, [probeBackend]);

  useEffect(() => {
    if (!shouldConnect) return;
    const reconnect = () => void probeBackend();
    window.addEventListener('online', reconnect);
    return () => window.removeEventListener('online', reconnect);
  }, [probeBackend, shouldConnect]);

  useEffect(() => {
    if (connection.status !== 'local' && connection.status !== 'signed-out') return;
    const restore = () => dispatch({ type: 'notification/restore-due', at: new Date().toISOString() });
    restore();
    const timer = window.setInterval(restore, 60_000);
    return () => window.clearInterval(timer);
  }, [connection.status]);

  const reconcileMutation = useCallback(
    async (request: () => Promise<unknown>): Promise<boolean> => {
      setOperationError(undefined);
      try {
        const payload = await withBusy(request);
        if (!acceptServerPayload(payload)) await loadServerState();
        return true;
      } catch (error) {
        handleRequestError(error);
        return false;
      }
    },
    [acceptServerPayload, handleRequestError, loadServerState, withBusy]
  );

  const createMonitor = useCallback(
    async (input: MonitorInput) => {
      if (connection.status === 'connected') return reconcileMutation(() => api.createMonitor(input));
      if (connection.status === 'checking' || connection.status === 'offline') {
        setOperationError('接続確認が終わるまで変更できません');
        return false;
      }
      const id = createId('monitor');
      dispatch({
        type: 'monitor/create',
        monitor: buildMonitor(input, { id, now: new Date(), timezone: state.preferences.timezone })
      });
      return true;
    },
    [connection.status, reconcileMutation, state.preferences.timezone]
  );

  const updateMonitor = useCallback(
    async (monitorId: string, input: MonitorInput) => {
      const existing = state.monitors.find((monitor) => monitor.id === monitorId);
      if (!existing) return false;
      if (connection.status === 'connected') {
        return reconcileMutation(() => api.updateMonitor(monitorId, input));
      }
      if (connection.status === 'checking' || connection.status === 'offline') {
        setOperationError('オフライン表示中は監視項目を変更できません');
        return false;
      }
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
    [connection.status, reconcileMutation, state.monitors, state.preferences.timezone]
  );

  const deleteMonitor = useCallback(
    async (monitorId: string) => {
      if (connection.status === 'connected') return reconcileMutation(() => api.deleteMonitor(monitorId));
      if (connection.status === 'checking' || connection.status === 'offline') {
        setOperationError('オフライン表示中は監視項目を削除できません');
        return false;
      }
      dispatch({ type: 'monitor/delete', monitorId });
      return true;
    },
    [connection.status, reconcileMutation]
  );

  const toggleMonitor = useCallback(
    async (monitorId: string) => {
      const monitor = state.monitors.find((item) => item.id === monitorId);
      if (!monitor) return false;
      if (connection.status === 'connected') {
        const status = monitor.status === 'paused' ? 'active' : 'paused';
        return reconcileMutation(() => api.updateMonitorStatus(monitorId, status));
      }
      if (connection.status === 'checking' || connection.status === 'offline') {
        setOperationError('オフライン表示中は監視状態を変更できません');
        return false;
      }
      dispatch({ type: 'monitor/toggle', monitorId, at: new Date().toISOString() });
      return true;
    },
    [connection.status, reconcileMutation, state.monitors]
  );

  const runMonitorNow = useCallback(
    async (monitorId: string) => {
      const monitor = state.monitors.find((item) => item.id === monitorId);
      if (!monitor) return false;
      if (connection.status === 'connected') return reconcileMutation(() => api.runMonitor(monitorId));
      if (connection.status === 'checking' || connection.status === 'offline') {
        setOperationError('オフライン表示中は監視を実行できません');
        return false;
      }
      const result = buildDemoRun(monitor, {
        now: new Date(),
        runId: createId('run'),
        notificationId: createId('notification')
      });
      dispatch({ type: 'monitor/run-completed', monitorId, ...result });
      return true;
    },
    [connection.status, reconcileMutation, state.monitors]
  );

  const markNotificationRead = useCallback(
    async (notificationId: string) => {
      if (connection.status === 'connected') {
        return reconcileMutation(() => api.updateNotification(notificationId, { status: 'read' }));
      }
      if (connection.status === 'checking' || connection.status === 'offline') {
        setOperationError('オフライン表示中は通知を変更できません');
        return false;
      }
      dispatch({ type: 'notification/read', notificationId, at: new Date().toISOString() });
      return true;
    },
    [connection.status, reconcileMutation]
  );

  const markAllNotificationsRead = useCallback(async () => {
    if (connection.status === 'connected') return reconcileMutation(api.markNotificationsRead);
    if (connection.status === 'checking' || connection.status === 'offline') {
      setOperationError('オフライン表示中は通知を変更できません');
      return false;
    }
    dispatch({ type: 'notification/read-all', at: new Date().toISOString() });
    return true;
  }, [connection.status, reconcileMutation]);

  const snoozeNotification = useCallback(
    async (notificationId: string, minutes = 60) => {
      const snoozedUntil = new Date(Date.now() + minutes * 60_000).toISOString();
      if (connection.status === 'connected') {
        return reconcileMutation(() =>
          api.updateNotification(notificationId, { status: 'snoozed', snoozedUntil })
        );
      }
      if (connection.status === 'checking' || connection.status === 'offline') {
        setOperationError('オフライン表示中は通知を変更できません');
        return false;
      }
      dispatch({ type: 'notification/snooze', notificationId, until: snoozedUntil });
      return true;
    },
    [connection.status, reconcileMutation]
  );

  const updatePreferences = useCallback(
    async (preferences: Partial<AppPreferences>) => {
      if (connection.status === 'connected') {
        return reconcileMutation(() => api.updatePreferences(preferences));
      }
      if (connection.status === 'checking' || connection.status === 'offline') {
        setOperationError('オフライン表示中は設定を変更できません');
        return false;
      }
      dispatch({ type: 'preferences/update', preferences, at: new Date().toISOString() });
      return true;
    },
    [connection.status, reconcileMutation]
  );

  const login = useCallback(
    async (secret: string) => {
      if (!secret) {
        setOperationError('ログイン用パスフレーズを入力してください');
        return false;
      }
      localSnapshotRef.current = state;
      setLocalMigrationState(migrationState(state));
      if (targetStorage) {
        setStorageStatus(saveState(targetStorage, state, STORAGE_KEY) ? 'saved' : 'error');
      }
      setOperationError(undefined);
      try {
        const payload = await withBusy(() => api.login(secret));
        if (!acceptServerPayload(payload)) await loadServerState();
        return true;
      } catch (error) {
        handleRequestError(error);
        setConnection((current) => ({ ...current, status: 'signed-out' }));
        return false;
      }
    },
    [acceptServerPayload, handleRequestError, loadServerState, state, targetStorage, withBusy]
  );

  const logout = useCallback(async () => {
    setOperationError(undefined);
    let subscription: PushSubscription | null = null;
    let pushEndpoint: string | undefined;
    try {
      pushEndpoint = targetStorage?.getItem(PUSH_ENDPOINT_KEY) ?? undefined;
    } catch {
      // Logout must continue even when browser storage is unavailable.
    }
    if (isPushSupported()) {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        subscription = await registration?.pushManager.getSubscription() ?? null;
        pushEndpoint = subscription?.endpoint ?? pushEndpoint;
      } catch {
        // The server session still has to be destroyed; use the cached endpoint when available.
      }
    }
    try {
      await withBusy(() => api.logout(pushEndpoint));
      clearServerCache();
      try {
        targetStorage?.removeItem(PUSH_ENDPOINT_KEY);
      } catch {
        setStorageStatus('error');
      }
      dispatch({ type: 'state/replace', state: localSnapshotRef.current });
      setConnection({ status: 'signed-out' });
      setPush((current) => ({ ...current, subscribed: false }));
      return true;
    } catch (error) {
      handleRequestError(error);
      return false;
    } finally {
      if (subscription) {
        await subscription.unsubscribe().catch(() => false);
        setPush((current) => ({ ...current, subscribed: false }));
      }
    }
  }, [clearServerCache, handleRequestError, targetStorage, withBusy]);

  const refreshState = useCallback(async () => {
    if (connection.status !== 'connected' && connection.status !== 'offline') {
      await probeBackend();
      return false;
    }
    setOperationError(undefined);
    try {
      return await withBusy(loadServerState);
    } catch (error) {
      handleRequestError(error);
      return false;
    }
  }, [connection.status, handleRequestError, loadServerState, probeBackend, withBusy]);

  const migrateLocalData = useCallback(async () => {
    if (connection.status !== 'connected') {
      setOperationError('先に監視サービスへログインしてください');
      return false;
    }
    if (migrationCompleted) return true;
    const blockers = migrationBlockers(localMigrationState);
    if (blockers.length > 0) {
      setOperationError(
        `公開HTTPSではない参照先URLを修正または削除してください: ${blockers.map((blocker) => blocker.title).join('、')}`
      );
      return false;
    }
    setOperationError(undefined);
    try {
      const chunks = migrationChunks(localMigrationState);
      let latestPayload: unknown;
      await withBusy(async () => {
        for (const chunk of chunks) latestPayload = await api.migrateState(chunk);
      });
      if (latestPayload !== undefined && !acceptServerPayload(latestPayload)) {
        await loadServerState();
      }
    } catch (error) {
      handleRequestError(error);
      return false;
    }
    try {
      targetStorage?.setItem(MIGRATION_KEY, 'complete');
    } catch {
      // The server migration succeeded even if this browser cannot retain the one-time marker.
    }
    setMigrationCompleted(true);
    return true;
  }, [
    acceptServerPayload,
    connection.status,
    handleRequestError,
    loadServerState,
    localMigrationState,
    migrationCompleted,
    targetStorage,
    withBusy
  ]);

  const exportLocalData = useCallback((): string | null => {
    if (connection.status !== 'local' && connection.status !== 'signed-out') {
      setOperationError('ローカルモードでJSONファイルを書き出してください');
      return null;
    }
    const snapshot = migrationState(localSnapshotRef.current);
    if (snapshot.monitors.length + snapshot.runs.length + snapshot.notifications.length === 0) {
      setOperationError('書き出せるローカル実データがありません');
      return null;
    }
    const json = JSON.stringify(snapshot, null, 2);
    if (new TextEncoder().encode(json).byteLength > MAX_MIGRATION_FILE_BYTES) {
      setOperationError('移行用JSONが1MBを超えています。不要なローカル項目を削除してください');
      return null;
    }
    setOperationError(undefined);
    return json;
  }, [connection.status]);

  const importLocalData = useCallback(async (file: File): Promise<boolean> => {
    if (connection.status !== 'connected') {
      setOperationError('先に監視サービスへログインしてください');
      return false;
    }
    if (file.size > MAX_MIGRATION_FILE_BYTES) {
      setOperationError('移行ファイルは1MB以下にしてください');
      return false;
    }
    setOperationError(undefined);
    try {
      return await withBusy(async () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(await file.text()) as unknown;
        } catch {
          setOperationError('移行ファイルのJSONを読み取れませんでした');
          return false;
        }
        if (!isMigrationFileState(parsed)) {
          setOperationError('Signal Deskの有効な移行ファイルを選んでください');
          return false;
        }
        const imported = migrationState(parsed);
        if (imported.monitors.length + imported.runs.length + imported.notifications.length === 0) {
          setOperationError('移行ファイルにローカル実データがありません');
          return false;
        }
        const merged = mergeMigrationState(localSnapshotRef.current, imported);
        if (!targetStorage || !saveState(targetStorage, merged, STORAGE_KEY)) {
          setStorageStatus('error');
          setOperationError('移行ファイルをこの端末へ保存できませんでした');
          return false;
        }
        try {
          targetStorage.removeItem(MIGRATION_KEY);
        } catch {
          setStorageStatus('error');
          setOperationError('一回移行の状態を更新できませんでした');
          return false;
        }
        localSnapshotRef.current = merged;
        setLocalMigrationState(merged);
        setMigrationCompleted(false);
        setStorageStatus('saved');
        return true;
      });
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : '移行ファイルを読み込めませんでした');
      return false;
    }
  }, [connection.status, targetStorage, withBusy]);

  const refreshPushState = useCallback(async () => {
    if (!isPushSupported()) {
      setPush({ availability: 'unsupported', subscribed: false });
      return;
    }
    if (connection.status !== 'connected') {
      setPush({ availability: 'unknown', subscribed: false });
      return;
    }
    try {
      const key = await api.getPushKey();
      if (!key.available || !key.publicKey) {
        setPush({ availability: 'unconfigured', subscribed: false });
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      setPush({ availability: 'available', subscribed: Boolean(subscription) });
    } catch (error) {
      setPush({
        availability: 'unknown',
        subscribed: false,
        error: error instanceof Error ? error.message : 'Push設定を確認できませんでした'
      });
    }
  }, [connection.status]);

  const subscribePush = useCallback(async () => {
    if (connection.status !== 'connected') {
      setOperationError('先に監視サービスへログインしてください');
      return false;
    }
    if (!isPushSupported()) {
      setPush({ availability: 'unsupported', subscribed: false });
      return false;
    }
    setOperationError(undefined);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setOperationError('端末通知が許可されませんでした');
        return false;
      }
      const key = await api.getPushKey();
      if (!key.available || !key.publicKey) {
        setPush({ availability: 'unconfigured', subscribed: false });
        setOperationError('サーバーにPush通知鍵が設定されていません');
        return false;
      }
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(key.publicKey)
        }));
      const payload = await withBusy(() => api.savePushSubscription(subscription.toJSON()));
      acceptServerPayload(payload);
      try {
        targetStorage?.setItem(PUSH_ENDPOINT_KEY, subscription.endpoint);
      } catch {
        setStorageStatus('error');
      }
      setPush({ availability: 'available', subscribed: true });
      return true;
    } catch (error) {
      handleRequestError(error);
      return false;
    }
  }, [acceptServerPayload, connection.status, handleRequestError, targetStorage, withBusy]);

  const unsubscribePush = useCallback(async () => {
    if (!isPushSupported()) return false;
    setOperationError(undefined);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        if (connection.status === 'connected') {
          const payload = await withBusy(() => api.removePushSubscription(subscription.endpoint));
          acceptServerPayload(payload);
        }
        await subscription.unsubscribe();
      }
      try {
        targetStorage?.removeItem(PUSH_ENDPOINT_KEY);
      } catch {
        setStorageStatus('error');
      }
      setPush((current) => ({ ...current, subscribed: false }));
      return true;
    } catch (error) {
      handleRequestError(error);
      return false;
    }
  }, [acceptServerPayload, connection.status, handleRequestError, targetStorage, withBusy]);

  const clearDemoData = useCallback(() => {
    if (connection.status === 'local' || connection.status === 'signed-out') dispatch({ type: 'demo/clear' });
  }, [connection.status]);
  const resetDemoData = useCallback(() => {
    if (connection.status === 'local' || connection.status === 'signed-out') {
      dispatch({ type: 'demo/reset', demoState: createInitialState() });
    }
  }, [connection.status]);
  const clearOperationError = useCallback(() => setOperationError(undefined), []);

  const value = useMemo<AppStateContextValue>(
    () => ({
      state,
      storageStatus,
      connection,
      operationError,
      busy: busyCount > 0,
      push,
      migration,
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
      resetDemoData,
      login,
      logout,
      refreshState,
      migrateLocalData,
      exportLocalData,
      importLocalData,
      refreshPushState,
      subscribePush,
      unsubscribePush,
      clearOperationError
    }),
    [
      state, storageStatus, connection, operationError, busyCount, push, migration,
      createMonitor, updateMonitor, deleteMonitor, toggleMonitor, runMonitorNow,
      markNotificationRead, markAllNotificationsRead, snoozeNotification, updatePreferences,
      clearDemoData, resetDemoData, login, logout, refreshState, migrateLocalData,
      exportLocalData, importLocalData,
      refreshPushState, subscribePush, unsubscribePush, clearOperationError
    ]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateContextValue {
  const value = useContext(AppStateContext);
  if (!value) throw new Error('useAppState must be used inside AppStateProvider');
  return value;
}
