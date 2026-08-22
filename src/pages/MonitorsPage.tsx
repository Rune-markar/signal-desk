import { Inbox, Plus, Search, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AppState, Monitor, MonitorStatus } from '../domain/model';
import { runsForMonitor } from '../domain/selectors';
import { MonitorCard } from '../components/MonitorCard';
import { PageHeader } from '../components/PageHeader';

type MonitorFilter = 'all' | MonitorStatus;

interface MonitorsPageProps {
  state: AppState;
  onAdd: () => void;
  onImport: () => void;
  onEdit: (monitor: Monitor) => void;
  onDelete: (monitor: Monitor) => void;
  onToggle: (monitorId: string) => void;
  onRun: (monitorId: string) => void;
}

export function MonitorsPage({ state, onAdd, onImport, onEdit, onDelete, onToggle, onRun }: MonitorsPageProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MonitorFilter>('all');

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ja');
    return state.monitors.filter((monitor) => {
      const matchesFilter = filter === 'all' || monitor.status === filter;
      const matchesQuery = !normalized || `${monitor.title} ${monitor.instruction}`.toLocaleLowerCase('ja').includes(normalized);
      return matchesFilter && matchesQuery;
    });
  }, [filter, query, state.monitors]);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="MONITORS"
        title="監視項目"
        description="何を、いつ、どの条件で確認するかを管理します。"
        actions={
          <div className="header-button-group">
            <button className="button secondary" onClick={onImport}><Sparkles size={18} />ChatGPTから移行</button>
            <button className="button primary" onClick={onAdd}><Plus size={18} />新しく追加</button>
          </div>
        }
      />

      <section className="toolbar" aria-label="監視項目の検索と絞り込み">
        <label className="search-field">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">監視項目を検索</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="監視名や内容で検索" />
        </label>
        <div className="filter-group" role="group" aria-label="状態で絞り込む">
          <SlidersHorizontal size={17} aria-hidden="true" />
          {([
            ['all', 'すべて'],
            ['active', '有効'],
            ['paused', '停止中'],
            ['error', '要対応']
          ] as const).map(([value, label]) => (
            <button key={value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)} aria-pressed={filter === value}>
              {label}
            </button>
          ))}
        </div>
        <span className="result-count">{filtered.length}件</span>
      </section>

      {filtered.length === 0 ? (
        <section className="empty-state">
          <span className="empty-icon"><Inbox size={28} aria-hidden="true" /></span>
          <h2>{state.monitors.length === 0 ? 'まだ監視項目がありません' : '条件に一致する項目がありません'}</h2>
          <p>{state.monitors.length === 0 ? '最初の監視項目を追加するか、ChatGPTのScheduled taskを移行してください。' : '検索語または状態フィルターを変更してください。'}</p>
          {state.monitors.length === 0 ? (
            <div className="empty-actions">
              <button className="button primary" onClick={onAdd}><Plus size={18} />最初の監視を追加</button>
              <button className="button secondary" onClick={onImport}><Sparkles size={18} />ChatGPTから移行</button>
            </div>
          ) : (
            <button className="button secondary" onClick={() => { setQuery(''); setFilter('all'); }}>絞り込みを解除</button>
          )}
        </section>
      ) : (
        <section className="monitor-list" aria-label="監視項目一覧">
          {filtered.map((monitor) => (
            <MonitorCard
              key={monitor.id}
              monitor={monitor}
              runs={runsForMonitor(state, monitor.id)}
              onEdit={() => onEdit(monitor)}
              onDelete={() => onDelete(monitor)}
              onToggle={() => onToggle(monitor.id)}
              onRun={() => onRun(monitor.id)}
            />
          ))}
        </section>
      )}
    </div>
  );
}
