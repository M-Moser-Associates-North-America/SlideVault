import type { HTMLAttributes } from 'react';

/** A small label pill (a category, a year, "Archived"). `tone` picks a coloured variant from styles/primitives.css. */
export function Badge({ tone, className, ...rest }: { tone?: 'archived' } & HTMLAttributes<HTMLSpanElement>) {
  return <span className={['badge', tone && `badge-${tone}`, className].filter(Boolean).join(' ')} {...rest} />;
}
