import {
  AlertCircle,
  ArrowRight,
  Bell,
  CheckCircle2,
  Clock3,
  ListChecks,
  Plus,
  RotateCw
} from 'lucide-react';
import { formatDateTime, relativeTime, runStatusLabels } from '../domain/format';
import { activeMonitors, issueMonitors, upcomingMonitors, unreadNotifications } from '../domain/selectors';
import type { AppState } from '../domain/model';
import type { AppRoute } from '../components/AppShell';
import { PageHeader } from '../components/PageHeader';
import { MonitorStatusBadge, SeverityBadge } from '../components/StatusBadge';

interface OverviewPageProps {
  state: AppState;
  onNavigate: (route: AppRoute) => void;
  onAdd: () => void;
  onRun: (monitorId: string) => void;
}

export function OverviewPage({ state, onNavigate, onAdd, onRun }: OverviewPageProps) {
  const active = activeMonitors(state);
  const issues = issueMonitors(state);
  const unread = unreadNotifications(state);
  const upcoming = upcomingMonitors(state);
  const attention = unread.filter((notification) => notification.severity !== 'info');
  const next = upcoming[0];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="OVERVIEW"
        title="今日の監視状況"
        description="要対応の通知と、外部接続後の予定として保存した確認をまとめています。"
        actions={
          <button className="button primary" onClick={onAdd}>
            <Plus size={18} aria-hidden="true" />監視項目を追加
          </button>
        }
      />

      <section className="metric-grid" aria-label="監視状況の概要">
        <button className="metric-card" onClick={() => onNavigate('monitors')}>
          <span className="metric-icon icon-green"><ListChecks size={20} aria-hidden="true" /></span>
          <span><small>有効な設定</small><strong>{active.length}</strong><em>件（未接続）</em></span>
        </button>
        <button className="metric-card" onClick={() => onNavigate('inbox')}>
          <span className="metric-icon icon-amber"><Bell size={20} aria-hidden="true" /></span>
          <span><small>未読通知</small><strong>{unread.length}</strong><em>件を確認</em></span>
        </button>
        <button className="metric-card" onClick={() => onNavigate('monitors')}>
          <span className="metric-icon icon-red"><AlertCircle size={20} aria-hidden="true" /></span>
          <span><small>要対応</small><strong>{issues.length}</strong><em>件のエラー</em></span>
        </button>
        <button className="metric-card next-card" onClick={() => onNavigate('monitors')}>
          <span className="metric-icon icon-blue"><Clock3 size={20} aria-hidden="true" /></span>
          <span><small>設定上の次回</small><strong className="metric-time">{next ? relativeTime(next.nextRunAt) : '予定なし'}</strong><em>{next?.title ?? '有効な設定なし'}</em></span>
        </button>
      </section>

      <div className="overview-grid">
        <section className="panel attention-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">NEEDS ATTENTION</p>
              <h2>確認が必要なこと</h2>
            </div>
            {attention.length > 0 ? <span className="attention-count">{attention.length}</span> : null}
          </div>
          {attention.length === 0 ? (
            <div className="healthy-state">
              <CheckCircle2 size={26} aria-hidden="true" />
              <div><strong>いま確認が必要な通知はありません</strong><p>外部接続後に、ここへ実際の通知が表示されます。</p></div>
            </div>
          ) : (
            <div className="attention-list">
              {attention.slice(0, 3).map((notification) => (
                <button key={notification.id} onClick={() => onNavigate('inbox')}>
                  <SeverityBadge severity={notification.severity} />
                  <span><strong>{notification.title}</strong><small>{notification.monitorTitle}・{relativeTime(notification.detectedAt)}</small></span>
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
          <button className="panel-link" onClick={() => onNavigate('inbox')}>
            通知をすべて見る<ArrowRight size={17} aria-hidden="true" />
          </button>
        </section>

        <section className="panel upcoming-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">UP NEXT</p><h2>次回予定（接続後）</h2></div>
          </div>
          {upcoming.length === 0 ? (
            <div className="small-empty"><Clock3 size={24} /><p>有効な監視設定がありません。</p></div>
          ) : (
            <ul className="upcoming-list">
              {upcoming.slice(0, 4).map((monitor) => (
                <li key={monitor.id}>
                  <div className="upcoming-time">
                    <strong>{formatDateTime(monitor.nextRunAt, monitor.schedule.timezone)}</strong>
                    <small>{relativeTime(monitor.nextRunAt)}</small>
                  </div>
                  <div className="upcoming-main">
                    <strong>{monitor.title}</strong>
                    <MonitorStatusBadge status={monitor.status} />
                  </div>
                  <button className="icon-button subtle" onClick={() => onRun(monitor.id)} aria-label={`${monitor.title}のデモ結果を追加`}>
                    <RotateCw size={18} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button className="panel-link" onClick={() => onNavigate('monitors')}>
            監視項目を管理<ArrowRight size={17} aria-hidden="true" />
          </button>
        </section>
      </div>

      <section className="panel recent-panel">
        <div className="panel-heading inline-heading">
          <div><p className="eyebrow">RECENT ACTIVITY</p><h2>最近の動き</h2></div>
          <button className="text-button" onClick={() => onNavigate('history')}>履歴を開く<ArrowRight size={16} /></button>
        </div>
        {state.runs.length === 0 ? (
          <div className="small-empty"><p>実行履歴はまだありません。</p></div>
        ) : (
          <div className="activity-table-wrap">
            <table className="activity-table">
              <thead><tr><th>監視項目</th><th>結果</th><th>内容</th><th>実行時刻</th></tr></thead>
              <tbody>
                {state.runs.slice(0, 5).map((run) => (
                  <tr key={run.id}>
                    <td><strong>{run.monitorTitle}</strong>{run.isDemo ? <span className="demo-chip">サンプル</span> : null}</td>
                    <td><span className={`outcome outcome-${run.status}`}>{runStatusLabels[run.status]}</span></td>
                    <td>{run.summary}</td>
                    <td>{formatDateTime(run.finishedAt, state.preferences.timezone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
