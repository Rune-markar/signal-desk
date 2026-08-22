import { CheckCircle2, CircleAlert, FileClock, FlaskConical, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatDateTime, runStatusLabels } from '../domain/format';
import type { AppState, RunStatus } from '../domain/model';
import { PageHeader } from '../components/PageHeader';

type HistoryFilter = 'all' | RunStatus;

export function HistoryPage({ state, liveMode = false }: { state: AppState; liveMode?: boolean }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ja');
    return state.runs.filter((run) => {
      const matchesStatus = filter === 'all' || run.status === filter;
      const matchesQuery = !normalized || `${run.monitorTitle} ${run.summary}`.toLocaleLowerCase('ja').includes(normalized);
      return matchesStatus && matchesQuery;
    });
  }, [filter, query, state.runs]);

  return (
    <div className="page-stack">
      <PageHeader eyebrow="HISTORY" title="実行履歴" description="いつ何を確認し、どの結果になったかを追跡します。" />

      <section className="toolbar history-toolbar">
        <label className="search-field">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">履歴を検索</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="監視名や結果で検索" />
        </label>
        <div className="segmented-control compact-segments" role="group" aria-label="結果で絞り込む">
          {([
            ['all', 'すべて'],
            ['matched', '条件一致'],
            ['clear', '変化なし'],
            ['failed', '失敗'],
            ['simulated', 'デモ']
          ] as const).map(([value, label]) => (
            <button key={value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)} aria-pressed={filter === value}>{label}</button>
          ))}
        </div>
      </section>

      {filtered.length === 0 ? (
        <section className="empty-state">
          <span className="empty-icon"><FileClock size={28} /></span>
          <h2>該当する実行履歴はありません</h2>
          <p>{liveMode ? '自動確認または「今すぐ確認」を実行すると、ここに結果が追加されます。' : '監視項目で「デモ結果を追加」を実行すると、ここに未確認のデモ結果が追加されます。'}</p>
        </section>
      ) : (
        <section className="timeline" aria-label="実行履歴一覧">
          {filtered.map((run) => (
            <article key={run.id} className={`timeline-item timeline-${run.status}`}>
              <div className="timeline-rail">
                <span>{run.status === 'failed' ? <CircleAlert size={18} /> : run.status === 'simulated' ? <FlaskConical size={18} /> : <CheckCircle2 size={18} />}</span>
              </div>
              <div className="timeline-card">
                <header>
                  <div><h2>{run.monitorTitle}</h2>{run.isDemo ? <span className="demo-chip">サンプル</span> : null}</div>
                  <time dateTime={run.finishedAt}>{formatDateTime(run.finishedAt, state.preferences.timezone)}</time>
                </header>
                <span className={`outcome outcome-${run.status}`}>{runStatusLabels[run.status]}</span>
                <p>{run.summary}</p>
                {run.evidenceUrls.length > 0 ? (
                  <div className="evidence-list">
                    <strong>参照元</strong>
                    {run.evidenceUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer">{url}</a>)}
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
