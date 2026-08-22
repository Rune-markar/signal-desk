import { BellOff, CheckCheck, Clock3, ExternalLink, MoonStar } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AlertNotification, AppState, NotificationStatus } from '../domain/model';
import { formatDateTime, relativeTime } from '../domain/format';
import { PageHeader } from '../components/PageHeader';
import { SeverityBadge } from '../components/StatusBadge';

type InboxFilter = 'all' | NotificationStatus;

interface InboxPageProps {
  state: AppState;
  onRead: (notificationId: string) => void;
  onReadAll: () => void;
  onSnooze: (notificationId: string) => void;
  liveMode?: boolean;
  busy?: boolean;
}

function notificationStatusLabel(notification: AlertNotification): string {
  if (notification.status === 'unread') return '未読';
  if (notification.status === 'snoozed') return 'スヌーズ中';
  return '既読';
}

export function InboxPage({ state, onRead, onReadAll, onSnooze, liveMode = false, busy = false }: InboxPageProps) {
  const [filter, setFilter] = useState<InboxFilter>('all');
  const unreadCount = state.notifications.filter((notification) => notification.status === 'unread').length;
  const filtered = useMemo(
    () => state.notifications.filter((notification) => filter === 'all' || notification.status === filter),
    [filter, state.notifications]
  );

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="INBOX"
        title="通知"
        description="条件に一致した通知を確認できます。取得失敗を含むすべての結果は「実行履歴」に残ります。"
        actions={
          <button className="button secondary" onClick={onReadAll} disabled={unreadCount === 0 || busy}>
            <CheckCheck size={18} aria-hidden="true" />すべて既読
          </button>
        }
      />

      <section className="inbox-toolbar">
        <div className="segmented-control" role="group" aria-label="通知を絞り込む">
          {([
            ['all', 'すべて'],
            ['unread', `未読 ${unreadCount}`],
            ['read', '既読'],
            ['snoozed', 'スヌーズ']
          ] as const).map(([value, label]) => (
            <button key={value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)} aria-pressed={filter === value}>
              {label}
            </button>
          ))}
        </div>
        <span>{filtered.length}件を表示</span>
      </section>

      {filtered.length === 0 ? (
        <section className="empty-state">
          <span className="empty-icon"><BellOff size={28} aria-hidden="true" /></span>
          <h2>{filter === 'unread' ? '未読通知はありません' : '該当する通知はありません'}</h2>
          <p>{filter === 'unread' ? liveMode ? '新しい監視通知が届くと、ここに表示されます。' : '外部接続後に新しい通知が届くと、ここに表示されます。' : '別の表示条件を選んでください。'}</p>
        </section>
      ) : (
        <section className="notification-list" aria-label="通知一覧">
          {filtered.map((notification) => (
            <article key={notification.id} className={`notification-card notification-${notification.status}`}>
              <div className={`notification-accent severity-${notification.severity}`} />
              <div className="notification-content">
                <header>
                  <div className="notification-badges">
                    <SeverityBadge severity={notification.severity} />
                    <span className={`read-state state-${notification.status}`}>{notificationStatusLabel(notification)}</span>
                    {notification.isDemo ? <span className="demo-chip">サンプル</span> : null}
                  </div>
                  <time dateTime={notification.detectedAt} title={formatDateTime(notification.detectedAt, state.preferences.timezone)}>
                    {relativeTime(notification.detectedAt)}
                  </time>
                </header>
                <h2>{notification.title}</h2>
                <p className="notification-monitor">{notification.monitorTitle}</p>
                <p className="notification-body">{notification.body}</p>
                {notification.status === 'snoozed' && notification.snoozedUntil ? (
                  <div className="snooze-until"><MoonStar size={16} />{formatDateTime(notification.snoozedUntil, state.preferences.timezone)}に未読へ戻します</div>
                ) : null}
                <div className="notification-actions">
                  {notification.status !== 'read' ? (
                    <button className="button secondary compact" onClick={() => onRead(notification.id)} disabled={busy}>
                      <CheckCheck size={17} />既読にする
                    </button>
                  ) : null}
                  {notification.status !== 'snoozed' ? (
                    <button className="button ghost compact" onClick={() => onSnooze(notification.id)} disabled={busy}>
                      <Clock3 size={17} />1時間スヌーズ
                    </button>
                  ) : null}
                  {notification.sourceUrl ? (
                    <a className="button ghost compact" href={notification.sourceUrl} target="_blank" rel="noreferrer">
                      <ExternalLink size={17} />参照元を開く
                    </a>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
