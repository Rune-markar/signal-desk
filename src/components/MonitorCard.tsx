import {
  ChevronDown,
  Clock3,
  ExternalLink,
  FileClock,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  RotateCw,
  Trash2
} from 'lucide-react';
import { useState } from 'react';
import { categoryLabels, formatDateTime, outcomeLabels, relativeTime } from '../domain/format';
import type { Monitor, MonitorRun } from '../domain/model';
import { scheduleLabel } from '../domain/schedule';
import { MonitorStatusBadge, SeverityBadge } from './StatusBadge';

interface MonitorCardProps {
  monitor: Monitor;
  runs: MonitorRun[];
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onRun: () => void;
  liveMode?: boolean;
  busy?: boolean;
}

export function MonitorCard({ monitor, runs, onEdit, onDelete, onToggle, onRun, liveMode = false, busy = false }: MonitorCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <article className={`monitor-card monitor-${monitor.status}`}>
      <header className="monitor-card-header">
        <div className="monitor-badges">
          <MonitorStatusBadge status={monitor.status} />
          <SeverityBadge severity={monitor.severity} />
          {monitor.origin === 'demo' ? <span className="demo-chip">サンプル</span> : null}
          {monitor.origin === 'chatgpt-manual' ? <span className="origin-chip">ChatGPTから移行</span> : null}
        </div>
        <div className="card-menu-wrap">
          <button
            className="icon-button subtle"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={`${monitor.title}のその他の操作`}
            aria-expanded={menuOpen}
            disabled={busy}
          >
            <MoreHorizontal size={20} aria-hidden="true" />
          </button>
          {menuOpen ? (
            <div className="card-menu">
              <button onClick={() => { setMenuOpen(false); onEdit(); }} disabled={busy}>
                <Pencil size={16} aria-hidden="true" />編集
              </button>
              <button className="danger-text" onClick={() => { setMenuOpen(false); onDelete(); }} disabled={busy}>
                <Trash2 size={16} aria-hidden="true" />削除
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="monitor-title-row">
        <div>
          <p className="monitor-category">{categoryLabels[monitor.category]}</p>
          <h2>{monitor.title}</h2>
        </div>
      </div>
      <p className="monitor-instruction">{monitor.instruction}</p>
      {monitor.sourceUrl ? (
        <a className="source-link" href={monitor.sourceUrl} target="_blank" rel="noreferrer">
          <ExternalLink size={15} aria-hidden="true" />
          <span>{monitor.sourceUrl}</span>
        </a>
      ) : null}

      <dl className="monitor-meta-grid">
        <div>
          <dt><Clock3 size={15} aria-hidden="true" />確認頻度</dt>
          <dd>{scheduleLabel(monitor.schedule.frequency, monitor.schedule.time)}</dd>
        </div>
        <div>
          <dt><FileClock size={15} aria-hidden="true" />最終結果</dt>
          <dd>
            <span className={`outcome outcome-${monitor.lastOutcome}`}>{outcomeLabels[monitor.lastOutcome]}</span>
            <small>{formatDateTime(monitor.lastRunAt, monitor.schedule.timezone)}</small>
          </dd>
        </div>
        <div>
          <dt><RotateCw size={15} aria-hidden="true" />次回確認</dt>
          <dd>
            {monitor.status === 'paused' ? '停止中' : formatDateTime(monitor.nextRunAt, monitor.schedule.timezone)}
            {monitor.status !== 'paused' && monitor.nextRunAt ? <small>{relativeTime(monitor.nextRunAt)}</small> : null}
          </dd>
        </div>
      </dl>

      <div className="last-summary">
        <span>直近の内容</span>
        <p>{monitor.lastSummary}</p>
      </div>

      <div className="monitor-actions">
        <button className="button primary compact" onClick={onRun} disabled={busy}>
          <RotateCw size={17} aria-hidden="true" />{busy ? '処理中…' : liveMode ? '今すぐ確認' : 'デモ結果を追加'}
        </button>
        <button className="button secondary compact" onClick={onToggle} disabled={busy}>
          {monitor.status === 'paused' ? <Play size={17} aria-hidden="true" /> : <Pause size={17} aria-hidden="true" />}
          {monitor.status === 'paused' ? '再開' : '一時停止'}
        </button>
        <button className="button ghost compact edit-button" onClick={onEdit} disabled={busy}>
          <Pencil size={17} aria-hidden="true" />編集
        </button>
      </div>

      <details className="history-disclosure">
        <summary>
          <ChevronDown size={17} aria-hidden="true" />
          最近の実行履歴 {runs.length > 0 ? `（${runs.length}件）` : ''}
        </summary>
        {runs.length === 0 ? (
          <p className="inline-empty">まだ実行履歴はありません。</p>
        ) : (
          <ul className="compact-run-list">
            {runs.slice(0, 3).map((run) => (
              <li key={run.id}>
                <span className={`run-dot run-${run.status}`} />
                <div><strong>{run.summary}</strong><small>{formatDateTime(run.finishedAt, monitor.schedule.timezone)}</small></div>
              </li>
            ))}
          </ul>
        )}
      </details>
    </article>
  );
}
