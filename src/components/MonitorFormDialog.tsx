import { Bell, Clock3, Globe2, Save, Target } from 'lucide-react';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import type { Monitor, MonitorCategory, MonitorFrequency, MonitorInput, MonitorSeverity } from '../domain/model';
import { isClockTime, normalizeScheduleTime } from '../domain/schedule';
import { Modal } from './Modal';

interface MonitorFormDialogProps {
  monitor?: Monitor;
  onClose: () => void;
  onSave: (input: MonitorInput) => void;
}

interface FormErrors {
  title?: string;
  instruction?: string;
  sourceUrl?: string;
  time?: string;
}

function monitorToInput(monitor?: Monitor): MonitorInput {
  return {
    title: monitor?.title ?? '',
    instruction: monitor?.instruction ?? '',
    category: monitor?.category ?? 'news',
    sourceUrl: monitor?.sourceUrl ?? '',
    frequency: monitor?.schedule.frequency ?? 'daily',
    time: monitor?.schedule.time ?? '09:00',
    severity: monitor?.severity ?? 'warning',
    notificationsEnabled: monitor?.notificationsEnabled ?? true,
    startActive: monitor ? monitor.status !== 'paused' : true,
    origin: monitor?.origin
  };
}

export function MonitorFormDialog({ monitor, onClose, onSave }: MonitorFormDialogProps) {
  const initial = useMemo(() => monitorToInput(monitor), [monitor]);
  const [title, setTitle] = useState(initial.title);
  const [instruction, setInstruction] = useState(initial.instruction);
  const [category, setCategory] = useState<MonitorCategory>(initial.category);
  const [sourceUrl, setSourceUrl] = useState(initial.sourceUrl ?? '');
  const [frequency, setFrequency] = useState<MonitorFrequency>(initial.frequency);
  const [time, setTime] = useState(initial.time);
  const [severity, setSeverity] = useState<MonitorSeverity>(initial.severity);
  const [notificationsEnabled, setNotificationsEnabled] = useState(initial.notificationsEnabled);
  const [startActive, setStartActive] = useState(initial.startActive);
  const [errors, setErrors] = useState<FormErrors>({});
  const formRef = useRef<HTMLFormElement>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: FormErrors = {};
    if (!title.trim()) nextErrors.title = '監視名を入力してください';
    if (title.trim().length > 80) nextErrors.title = '監視名は80文字以内で入力してください';
    if (!instruction.trim()) nextErrors.instruction = '何を確認するか入力してください';
    if (instruction.trim().length > 500) nextErrors.instruction = '確認内容は500文字以内で入力してください';
    if (frequency !== 'hourly' && !isClockTime(time)) {
      nextErrors.time = '確認時刻を入力してください';
    }
    if (sourceUrl.trim()) {
      try {
        const url = new URL(sourceUrl.trim());
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid protocol');
      } catch {
        nextErrors.sourceUrl = 'http:// または https:// で始まるURLを入力してください';
      }
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      window.requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }

    onSave({
      title,
      instruction,
      category,
      sourceUrl,
      frequency,
      time: normalizeScheduleTime(time),
      severity,
      notificationsEnabled,
      startActive,
      origin: initial.origin
    });
  };

  return (
    <Modal
      title={monitor ? '監視項目を編集' : '新しい監視項目'}
      description="対象・条件・確認頻度・通知方法を設定します。"
      onClose={onClose}
      size="wide"
    >
      <form ref={formRef} onSubmit={submit} noValidate>
        {Object.keys(errors).length > 0 ? (
          <div className="form-alert" role="alert">入力内容を確認してください。最初のエラー項目へ移動しました。</div>
        ) : null}
        <div className="form-section">
          <div className="form-section-heading">
            <Target size={19} aria-hidden="true" />
            <div>
              <h3>対象と確認内容</h3>
              <p>分かりやすい名前と、判定してほしい条件を書きます。</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field field-full">
              <span>監視名 <em>必須</em></span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例：保有銘柄の重要ニュース"
                maxLength={80}
                aria-invalid={Boolean(errors.title)}
                aria-describedby={errors.title ? 'title-error' : undefined}
                autoFocus
              />
              {errors.title ? <small id="title-error" className="field-error">{errors.title}</small> : null}
            </label>

            <label className="field">
              <span>種類</span>
              <select value={category} onChange={(event) => setCategory(event.target.value as MonitorCategory)}>
                <option value="news">ニュース</option>
                <option value="market">価格・数値</option>
                <option value="website">ページ更新</option>
                <option value="report">定期レポート</option>
              </select>
            </label>

            <label className="field">
              <span>参照先URL</span>
              <input
                type="url"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="https://example.com"
                aria-invalid={Boolean(errors.sourceUrl)}
                aria-describedby={errors.sourceUrl ? 'source-error' : 'source-help'}
              />
              {errors.sourceUrl ? (
                <small id="source-error" className="field-error">{errors.sourceUrl}</small>
              ) : (
                <small id="source-help">後からデータAPIやサイトへ接続できます。</small>
              )}
            </label>

            <label className="field field-full">
              <span>何を確認するか <em>必須</em></span>
              <textarea
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                rows={4}
                maxLength={500}
                placeholder="例：決算、適時開示、業績修正が発表された場合に知らせる"
                aria-invalid={Boolean(errors.instruction)}
                aria-describedby={errors.instruction ? 'instruction-error' : 'instruction-help'}
              />
              {errors.instruction ? (
                <small id="instruction-error" className="field-error">{errors.instruction}</small>
              ) : (
                <small id="instruction-help">判定基準や除外条件まで書くと、誤通知を減らせます。</small>
              )}
            </label>
          </div>
        </div>

        <div className="form-section">
          <div className="form-section-heading">
            <Clock3 size={19} aria-hidden="true" />
            <div>
              <h3>確認頻度</h3>
              <p>すべての日時は設定画面のタイムゾーンで扱います。</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>頻度</span>
              <select value={frequency} onChange={(event) => setFrequency(event.target.value as MonitorFrequency)}>
                <option value="hourly">1時間ごと</option>
                <option value="daily">毎日</option>
                <option value="weekdays">平日</option>
                <option value="weekly">毎週月曜日</option>
              </select>
            </label>
            <label className="field">
              <span>確認時刻</span>
              <input
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                disabled={frequency === 'hourly'}
                aria-invalid={Boolean(errors.time)}
                aria-describedby={errors.time ? 'time-error' : undefined}
              />
              {errors.time ? <small id="time-error" className="field-error">{errors.time}</small> : null}
            </label>
          </div>
        </div>

        <div className="form-section">
          <div className="form-section-heading">
            <Bell size={19} aria-hidden="true" />
            <div>
              <h3>通知</h3>
              <p>通知の優先度と、保存後すぐ稼働させるかを選びます。</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>重要度</span>
              <select value={severity} onChange={(event) => setSeverity(event.target.value as MonitorSeverity)}>
                <option value="info">お知らせ</option>
                <option value="warning">要確認</option>
                <option value="critical">重要</option>
              </select>
            </label>
            <div className="switch-stack">
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={notificationsEnabled}
                  onChange={(event) => setNotificationsEnabled(event.target.checked)}
                />
                <span className="switch-control" aria-hidden="true" />
                <span>
                  <strong>条件一致時に通知</strong>
                  <small>アプリ内の通知受信箱へ追加します</small>
                </span>
              </label>
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={startActive}
                  onChange={(event) => setStartActive(event.target.checked)}
                />
                <span className="switch-control" aria-hidden="true" />
                <span>
                  <strong>保存後に稼働</strong>
                  <small>接続前はデモ実行のみです</small>
                </span>
              </label>
            </div>
          </div>
        </div>

        <div className="form-disclaimer">
          <Globe2 size={18} aria-hidden="true" />
          <p>現在はローカル試作版です。保存しても外部データ取得は開始されません。</p>
        </div>

        <footer className="modal-actions sticky-actions">
          <button type="button" className="button secondary" onClick={onClose}>キャンセル</button>
          <button type="submit" className="button primary">
            <Save size={18} aria-hidden="true" />
            {monitor ? '変更を保存' : '監視項目を保存'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
