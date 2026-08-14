import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  // Wider variant for forms with multi-column rows (e.g. FM parameters).
  wide?: boolean;
}

// Centred dialog with backdrop. Closes on Escape or backdrop click; locks body
// scroll while open and restores focus to whatever opened it.
export function Modal({ title, onClose, children, wide }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current();
    }
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the first form field (not the header close button) so the form is
    // immediately usable from the keyboard. Run once on mount — re-running on
    // every parent render would steal focus back from the field being typed in.
    const firstField = panelRef.current?.querySelector<HTMLElement>(
      '.modal-body input, .modal-body select, .modal-body textarea',
    );
    firstField?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={`modal-panel${wide ? ' modal-panel-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
        // Stop clicks inside the panel from reaching the backdrop's close handler.
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
