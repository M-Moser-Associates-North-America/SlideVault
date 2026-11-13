'use client';

import type { ReactNode } from 'react';
import { Icon } from './icons';

/** A card that opens and closes: the title and one short line show while it is closed (used on the phone slide page). */
export function FoldPanel({ className = '', title, hint, open, children }: { className?: string; title: string; hint?: string; /** start opened (an upright tablet has room for it) */ open?: boolean; children: ReactNode }) {
  return (
    <details className={`panel fold ${className}`} open={open}>
      <summary>
        <span className="fold-text">
          <span className="fold-title">{title}</span>
          {hint && <span className="fold-hint">{hint}</span>}
        </span>
        <Icon name="down" className="fold-chev" />
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}
