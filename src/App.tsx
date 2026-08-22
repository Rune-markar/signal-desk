import { CheckCircle2 } from 'lucide-react';
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
  return routes.includes(candidate) ? candidate : 'overview';
}

export function App() {
  const {
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
  } = useAppState();
  const [route, setRoute] = useState<AppRoute>(routeFromHash);
  const [editingMonitor, setEditingMonitor] = useState<Monitor | 'new' | null>(null);
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Monitor | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const unreadCount = unreadNotifications(state).length;

  useEffect(() => {
    const onHashChange = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHashChange);
    if (!window.location.hash) window.history.replaceState(null, '', '#/overview');
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

  const saveMonitor = (input: MonitorInput) => {
    if (editingMonitor && editingMonitor !== 'new') {
      updateMonitor(editingMonitor.id, input);
      announce('監視項目を更新しました');
    } else {
      createMonitor(input);
      announce('監視項目を追加しました');
    }
    setEditingMonitor(null);
    navigate('monitors');
  };

  const importMonitor = (input: MonitorInput) => {
    createMonitor(input);
    setMigrationOpen(false);
    announce('停止中の監視項目として移行しました');
    navigate('monitors');
  };

  const runNow = (monitorId: string) => {
    if (runMonitorNow(monitorId)) {
      announce('デモ結果を追加しました。外部データは取得していません');
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
            onToggle={(monitorId) => {
              const monitor = state.monitors.find((item) => item.id === monitorId);
              toggleMonitor(monitorId);
              announce(monitor?.status === 'paused' ? '監視を再開しました' : '監視を一時停止しました');
            }}
            onRun={runNow}
          />
        );
      case 'inbox':
        return (
          <InboxPage
            state={state}
            onRead={(notificationId) => {
              markNotificationRead(notificationId);
              announce('通知を既読にしました');
            }}
            onReadAll={() => {
              markAllNotificationsRead();
              announce('すべての通知を既読にしました');
            }}
            onSnooze={(notificationId) => {
              snoozeNotification(notificationId);
              announce('1時間スヌーズしました');
            }}
          />
        );
      case 'history':
        return <HistoryPage state={state} />;
      case 'settings':
        return (
          <SettingsPage
            preferences={state.preferences}
            monitorCount={state.monitors.length}
            notificationCount={state.notifications.length}
            onUpdate={updatePreferences}
            onClearDemo={() => {
              clearDemoData();
              announce('サンプルデータを削除しました');
            }}
            onResetDemo={() => {
              resetDemoData();
              announce('サンプルデータを復元しました');
            }}
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
    announce
  ]);

  return (
    <>
      <a className="skip-link" href="#main-content">本文へ移動</a>
      <AppShell route={route} unreadCount={unreadCount} storageStatus={storageStatus} onNavigate={navigate}>
        {storageStatus === 'error' ? (
          <section className="storage-error-banner" role="alert">
            このブラウザに変更を保存できません。再読み込み前に入力内容を控え、ブラウザの保存設定や空き容量を確認してください。
          </section>
        ) : null}
        <DemoBanner
          hasSamples={state.preferences.demoMode}
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
        />
      ) : null}
      {migrationOpen ? <MigrationDialog onClose={() => setMigrationOpen(false)} onImport={importMonitor} /> : null}
      {deleteTarget ? (
        <ConfirmDialog
          title="監視項目を削除しますか？"
          description={`「${deleteTarget.title}」を監視一覧から削除します。`}
          confirmLabel="削除する"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            deleteMonitor(deleteTarget.id);
            setDeleteTarget(null);
            announce('監視項目を削除しました');
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
