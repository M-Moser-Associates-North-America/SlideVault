'use client';

import type { ReactNode } from 'react';
import { Icon } from './icons';

/** A card that opens and closes: the title and one short line show while it is closed (used on the phone slide page). */
export function FoldPanel({ className = '', title, hint, children }: { className?: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <details className={`panel fold ${className}`}>
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
