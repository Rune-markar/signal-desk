import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardPaste, ShieldCheck } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import type { MonitorFrequency, MonitorInput } from '../domain/model';
import { isClockTime, normalizeScheduleTime, scheduleLabel } from '../domain/schedule';
import { Modal } from './Modal';

interface MigrationDialogProps {
  onClose: () => void;
  onImport: (input: MonitorInput) => void;
}

export function MigrationDialog({ onClose, onImport }: MigrationDialogProps) {
  const [step, setStep] = useState<'input' | 'preview'>('input');
  const [title, setTitle] = useState('');
  const [instruction, setInstruction] = useState('');
  const [frequency, setFrequency] = useState<MonitorFrequency>('daily');
  const [time, setTime] = useState('09:00');
  const [error, setError] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);

  const preview = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !instruction.trim()) {
      setError('タスク名と指示文を入力してください');
      window.requestAnimationFrame(() => {
        (!title.trim() ? titleRef.current : instructionRef.current)?.focus();
      });
      return;
    }
    if (frequency !== 'hourly' && !isClockTime(time)) {
      setError('確認時刻を入力してください');
      window.requestAnimationFrame(() => timeRef.current?.focus());
      return;
    }
    setError('');
    setStep('preview');
  };

  const importTask = () => {
    onImport({
      title,
      instruction,
      category: 'report',
      sourceUrl: '',
      frequency,
      time: normalizeScheduleTime(time),
      severity: 'warning',
      notificationsEnabled: true,
      startActive: false,
      origin: 'chatgpt-manual'
    });
  };

  return (
    <Modal
      title="ChatGPTの監視を移行"
      description="既存タスクの設定内容を手入力で控えます。ChatGPTとは接続・同期されません。"
      onClose={onClose}
      size="wide"
    >
      <ol className="stepper" aria-label="移行手順">
        <li className={step === 'input' ? 'is-current' : 'is-complete'}>
          <span>{step === 'preview' ? <CheckCircle2 size={16} /> : '1'}</span>
          内容を入力
        </li>
        <li className={step === 'preview' ? 'is-current' : ''}>
          <span>2</span>
          確認して保存
        </li>
      </ol>

      {step === 'input' ? (
        <form onSubmit={preview} noValidate>
          <div className="migration-note">
            <ClipboardPaste size={20} aria-hidden="true" />
            <div>
              <strong>ChatGPTのScheduledを開いて内容を貼り付けてください</strong>
              <p>この試作版はChatGPTに接続していないため、内容を確認しながら手動で転記します。</p>
            </div>
          </div>
          {error ? <div id="migration-error" className="form-alert" role="alert">{error}</div> : null}
          <div className="form-grid migration-fields">
            <label className="field field-full">
              <span>タスク名 <em>必須</em></span>
              <input ref={titleRef} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例：毎朝の市場ニュース確認" maxLength={80} aria-invalid={Boolean(error && !title.trim())} aria-describedby={error ? 'migration-error' : undefined} autoFocus />
            </label>
            <label className="field field-full">
              <span>ChatGPTに設定した指示文 <em>必須</em></span>
              <textarea ref={instructionRef} value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={7} maxLength={500} placeholder="Scheduled taskのプロンプトを貼り付ける" aria-invalid={Boolean(error && !instruction.trim())} aria-describedby={error ? 'migration-error' : undefined} />
            </label>
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
              <span>時刻</span>
              <input ref={timeRef} type="time" value={time} onChange={(event) => setTime(event.target.value)} disabled={frequency === 'hourly'} aria-invalid={Boolean(error && frequency !== 'hourly' && !isClockTime(time))} aria-describedby={error ? 'migration-error' : undefined} />
            </label>
          </div>
          <footer className="modal-actions sticky-actions">
            <button type="button" className="button secondary" onClick={onClose}>キャンセル</button>
            <button type="submit" className="button primary">
              変換内容を確認
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </footer>
        </form>
      ) : (
        <div>
          <section className="migration-preview">
            <div className="preview-label">移行プレビュー</div>
            <h3>{title}</h3>
            <p>{instruction}</p>
            <dl>
              <div><dt>確認頻度</dt><dd>{scheduleLabel(frequency, time)}</dd></div>
              <div><dt>保存状態</dt><dd>停止中（テスト後に再開）</dd></div>
              <div><dt>通知</dt><dd>アプリ内通知を有効</dd></div>
            </dl>
          </section>
          <div className="safety-note">
            <ShieldCheck size={21} aria-hidden="true" />
            <div>
              <strong>二重通知を防ぐ手順</strong>
              <p>まず停止中で保存します。この保存だけでは監視されません。外部接続とテストが成功してから、ChatGPT側の元タスクを停止してください。</p>
            </div>
          </div>
          <footer className="modal-actions sticky-actions">
            <button type="button" className="button secondary" onClick={() => setStep('input')}>
              <ArrowLeft size={18} aria-hidden="true" />
              戻って修正
            </button>
            <button type="button" className="button primary" onClick={importTask}>
              <CheckCircle2 size={18} aria-hidden="true" />
              停止中で保存
            </button>
          </footer>
        </div>
      )}
    </Modal>
  );
}
