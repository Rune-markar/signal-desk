import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  size?: 'normal' | 'wide';
}

const focusableSelector =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ title, description, children, onClose, size = 'normal' }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const appShell = document.querySelector<HTMLElement>('.app-shell');
    const previousInert = appShell?.inert ?? false;
    const previousAriaHidden = appShell?.getAttribute('aria-hidden') ?? null;
    const first = panel?.querySelector<HTMLElement>(focusableSelector);
    if (appShell) {
      appShell.inert = true;
      appShell.setAttribute('aria-hidden', 'true');
    }
    first?.focus();
    document.body.classList.add('modal-open');

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) return;
      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement?.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.classList.remove('modal-open');
      if (appShell) {
        appShell.inert = previousInert;
        if (previousAriaHidden === null) appShell.removeAttribute('aria-hidden');
        else appShell.setAttribute('aria-hidden', previousAriaHidden);
      }
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div
        ref={panelRef}
        className={`modal-panel modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        aria-describedby={description ? 'modal-description' : undefined}
      >
        <header className="modal-header">
          <div>
            <h2 id="modal-title">{title}</h2>
            {description ? <p id="modal-description">{description}</p> : null}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="閉じる">
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
