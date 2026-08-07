import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

// Small "?" icon that reveals where in SAP BTP a given value can be found.
// Click-to-toggle (not hover-only) so the text stays readable while the user
// copies values out of another tab, and so it works on touch devices.
export function FieldHint({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocumentClick(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocumentClick);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onDocumentClick);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  return (
    <span className="field-hint" ref={wrapperRef}>
      <button
        type="button"
        className="field-hint-icon"
        aria-expanded={open}
        aria-label="Where do I find this?"
        onClick={() => setOpen((prev) => !prev)}
      >
        ?
      </button>
      {open && <span className="field-hint-bubble">{children}</span>}
    </span>
  );
}
