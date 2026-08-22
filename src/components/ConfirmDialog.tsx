import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => boolean | Promise<boolean>;
  liveMode?: boolean;
}

export function ConfirmDialog({ title, description, confirmLabel, onCancel, onConfirm, liveMode = false }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      const succeeded = await onConfirm();
      if (!succeeded) setError('削除できませんでした。接続状態を確認して、もう一度お試しください。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={title} description={description} onClose={onCancel}>
      <div className="confirm-panel">
        <div className="confirm-icon" aria-hidden="true"><Trash2 size={24} /></div>
        <p>{liveMode
          ? '過去の通知と実行履歴は、監査用としてサーバー上に残ります。'
          : '過去の通知と実行履歴は、このブラウザ内に残ります。'}</p>
      </div>
      {error ? <div className="form-alert" role="alert">{error}</div> : null}
      <footer className="modal-actions">
        <button className="button secondary" onClick={onCancel} disabled={busy}>キャンセル</button>
        <button className="button danger" onClick={confirm} disabled={busy}>{busy ? '削除中…' : confirmLabel}</button>
      </footer>
    </Modal>
  );
}
