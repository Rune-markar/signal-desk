import { CheckCircle2, CircleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell, type AppRoute } from './components/AppShell';
import { ConfirmDialog } from './components/ConfirmDialog';
import { DemoBanner } from './components/DemoBanner';
import { MigrationDialog } from './components/MigrationDialog';
import { MonitorFormDialog } from './components/MonitorFormDialog';
import type { Monitor, MonitorInput } from './domain/model';
import { unreadNotifications } from './domain/selectors';
import { HistoryPage } from './pages/HistoryPage';
import { InboxPage } from './pages/InboxPage';
import { MonitorsPage } from './pages/MonitorsPage';
import { OverviewPage } from './pages/OverviewPage';
import { SettingsPage } from './pages/SettingsPage';
import { useAppState } from './state/AppStateContext';

const routes: AppRoute[] = ['overview', 'monitors', 'inbox', 'history', 'settings'];

function routeFromHash(): AppRoute {
  const candidate = window.location.hash.replace(/^#\/?/, '') as AppRoute;
  if (routes.includes(candidate)) return candidate;
  const requestedView = new URL(window.location.href).searchParams.get('view') as AppRoute | null;
  return requestedView && routes.includes(requestedView) ? requestedView : 'overview';
}

export function App() {
  const {
    state,
    storageStatus,
    connection,
    operationError,
    busy,
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
  } = useAppState();
  const [route, setRoute] = useState<AppRoute>(routeFromHash);
  const [editingMonitor, setEditingMonitor] = useState<Monitor | 'new' | null>(null);
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Monitor | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const unreadCount = unreadNotifications(state).length;
  const liveMode = connection.status === 'connected';
  const actionsBlocked = busy || connection.status === 'checking' || connection.status === 'offline';

  useEffect(() => {
    const onHashChange = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHashChange);
    if (!window.location.hash) window.history.replaceState(null, '', `#/${routeFromHash()}`);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (!announcement) return;
    const timer = window.setTimeout(() => setAnnouncement(''), 3200);
    return () => window.clearTimeout(timer);
  }, [announcement]);

  const navigate = useCallback((nextRoute: AppRoute) => {
    window.location.hash = `/${nextRoute}`;
    setRoute(nextRoute);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const announce = useCallback((message: string) => setAnnouncement(message), []);

  const saveMonitor = async (input: MonitorInput): Promise<boolean> => {
    const editing = editingMonitor && editingMonitor !== 'new' ? editingMonitor : null;
    const saved = editing
      ? await updateMonitor(editing.id, input)
      : await createMonitor(input);
    if (!saved) return false;
    if (editing) {
      announce('監視項目を更新しました');
    } else {
      announce('監視項目を追加しました');
    }
    setEditingMonitor(null);
    navigate('monitors');
    return true;
  };

  const importMonitor = async (input: MonitorInput): Promise<boolean> => {
    const saved = await createMonitor(input);
    if (!saved) return false;
    setMigrationOpen(false);
    announce('停止中の監視項目として移行しました');
    navigate('monitors');
    return true;
  };

  const runNow = async (monitorId: string) => {
    if (await runMonitorNow(monitorId)) {
      announce(liveMode ? '監視を実行し、結果を更新しました' : 'デモ結果を追加しました。外部データは取得していません');
    }
  };

  const page = useMemo(() => {
    switch (route) {
      case 'overview':
        return (
          <OverviewPage
            state={state}
            onNavigate={navigate}
            onAdd={() => setEditingMonitor('new')}
            onRun={runNow}
            liveMode={liveMode}
            busy={actionsBlocked}
          />
        );
      case 'monitors':
        return (
          <MonitorsPage
            state={state}
            onAdd={() => setEditingMonitor('new')}
            onImport={() => setMigrationOpen(true)}
            onEdit={setEditingMonitor}
            onDelete={setDeleteTarget}
            onToggle={async (monitorId) => {
              const monitor = state.monitors.find((item) => item.id === monitorId);
              if (await toggleMonitor(monitorId)) {
                announce(monitor?.status === 'paused' ? '監視を再開しました' : '監視を一時停止しました');
              }
            }}
            onRun={runNow}
            liveMode={liveMode}
            busy={actionsBlocked}
          />
        );
      case 'inbox':
        return (
          <InboxPage
            state={state}
            onRead={async (notificationId) => {
              if (await markNotificationRead(notificationId)) announce('通知を既読にしました');
            }}
            onReadAll={async () => {
              if (await markAllNotificationsRead()) announce('すべての通知を既読にしました');
            }}
            onSnooze={async (notificationId) => {
              if (await snoozeNotification(notificationId)) announce('1時間スヌーズしました');
            }}
            liveMode={liveMode}
            busy={actionsBlocked}
          />
        );
      case 'history':
        return <HistoryPage state={state} liveMode={liveMode} />;
      case 'settings':
        return (
          <SettingsPage
            preferences={state.preferences}
            monitorCount={state.monitors.length}
            notificationCount={state.notifications.length}
            connection={connection}
            push={push}
            migration={migration}
            busy={busy}
            onUpdate={updatePreferences}
            onClearDemo={() => {
              clearDemoData();
              announce('サンプルデータを削除しました');
            }}
            onResetDemo={() => {
              resetDemoData();
              announce('サンプルデータを復元しました');
            }}
            onLogin={login}
            onLogout={logout}
            onRefresh={refreshState}
            onMigrateLocal={migrateLocalData}
            onExportLocal={exportLocalData}
            onImportLocal={importLocalData}
            onRefreshPush={refreshPushState}
            onSubscribePush={subscribePush}
            onUnsubscribePush={unsubscribePush}
            onAnnounce={announce}
          />
        );
    }
  }, [
    route,
    state,
    navigate,
    toggleMonitor,
    markNotificationRead,
    markAllNotificationsRead,
    snoozeNotification,
    updatePreferences,
    clearDemoData,
    resetDemoData,
    connection,
    push,
    migration,
    busy,
    actionsBlocked,
    liveMode,
    login,
    logout,
    refreshState,
    migrateLocalData,
    exportLocalData,
    importLocalData,
    refreshPushState,
    subscribePush,
    unsubscribePush,
    announce
  ]);

  return (
    <>
      <a className="skip-link" href="#main-content">本文へ移動</a>
      <AppShell route={route} unreadCount={unreadCount} storageStatus={storageStatus} connection={connection} onNavigate={navigate}>
        {storageStatus === 'error' ? (
          <section className="storage-error-banner" role="alert">
            このブラウザに変更を保存できません。再読み込み前に入力内容を控え、ブラウザの保存設定や空き容量を確認してください。
          </section>
        ) : null}
        {operationError ? (
          <section className="operation-error-banner" role="alert">
            <CircleAlert size={19} aria-hidden="true" />
            <span>{operationError}</span>
            <button className="icon-button subtle" onClick={clearOperationError} aria-label="エラーを閉じる"><X size={18} /></button>
          </section>
        ) : null}
        <DemoBanner
          hasSamples={state.preferences.demoMode}
          connectionStatus={connection.status}
          onClear={() => {
            clearDemoData();
            announce('サンプルデータを削除しました');
          }}
        />
        {page}
      </AppShell>

      {editingMonitor ? (
        <MonitorFormDialog
          monitor={editingMonitor === 'new' ? undefined : editingMonitor}
          onClose={() => setEditingMonitor(null)}
          onSave={saveMonitor}
          liveMode={liveMode}
          blocked={actionsBlocked}
        />
      ) : null}
      {migrationOpen ? <MigrationDialog onClose={() => setMigrationOpen(false)} onImport={importMonitor} liveMode={liveMode} /> : null}
      {deleteTarget ? (
        <ConfirmDialog
          title="監視項目を削除しますか？"
          description={`「${deleteTarget.title}」を監視一覧から削除します。`}
          confirmLabel="削除する"
          liveMode={liveMode}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => {
            const deleted = await deleteMonitor(deleteTarget.id);
            if (!deleted) return false;
            setDeleteTarget(null);
            announce('監視項目を削除しました');
            return true;
          }}
        />
      ) : null}

      <div className={announcement ? 'toast is-visible' : 'toast'} role="status" aria-live="polite">
        <CheckCircle2 size={19} aria-hidden="true" />
        <span>{announcement}</span>
      </div>
    </>
  );
}
