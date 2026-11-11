'use client';

import { useRef, type ReactNode } from 'react';
import { useEdgeFade } from './edge-fade';

/** A row that scrolls sideways, with a soft fade on the side where more is hidden (see edge-fade.ts and the CSS). */
export function ScrollRow({ className, children, ...rest }: { className?: string; children: ReactNode; role?: string; 'aria-label'?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEdgeFade(ref);
  return (
    <div className={className} ref={ref} {...rest}>
      {children}
    </div>
  );
}
