import { Trash2 } from 'lucide-react';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({ title, description, confirmLabel, onCancel, onConfirm }: ConfirmDialogProps) {
  return (
    <Modal title={title} description={description} onClose={onCancel}>
      <div className="confirm-panel">
        <div className="confirm-icon" aria-hidden="true"><Trash2 size={24} /></div>
        <p>過去の通知と実行履歴は、このブラウザ内に残ります。</p>
      </div>
      <footer className="modal-actions">
        <button className="button secondary" onClick={onCancel}>キャンセル</button>
        <button className="button danger" onClick={onConfirm}>{confirmLabel}</button>
      </footer>
    </Modal>
  );
}
