'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './icons';
import { Button } from './ui/Button';

/** A "⋯" button that opens a short list of labelled actions. `up` opens the list above the button (for a button at the bottom of a card). */
export function MoreMenu({ label, items, up, className }: { label: string; items: { label: string; icon: IconName; onClick: () => void }[]; up?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        wrap.current?.querySelector<HTMLElement>('button')?.focus();
      }
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className={`more-menu${className ? ` ${className}` : ''}`} ref={wrap}>
      <Button size="sm" iconOnly aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)}>
        <Icon name="more" />
      </Button>
      {open && (
        <div className={`more-menu-list${up ? ' is-up' : ''}`} role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className="more-menu-item"
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
            >
              <Icon name={it.icon} />
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
