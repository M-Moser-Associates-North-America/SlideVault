'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useProfile } from '@/features/slide-vault';
import { ThemeToggle, useTheme } from './theme';
import styles from './shell.module.css';

/**
 * The top of the app: logo and name on the left; theme and the account menu on the right. The menu
 * stands in for the real login (M Moser's system): who you are, and so what you can see, comes from
 * signing in. Hidden on the sign-in screens, which show their own logo.
 */
export function ShellHeader() {
  const { theme } = useTheme();
  const { profile, signOut } = useProfile();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        wrap.current?.querySelector<HTMLElement>('button')?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!profile) return null;

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <div className="slidevault" data-theme={theme}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <span className={styles.logo} aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
              <g transform="matrix(0.025 0 0 -0.025 0 24)">
                <path d="M479 185Q431 221 375.5 240.5Q320 260 260 260Q223 260 188.0 252.0Q153 244 120 228Q99 218 79.5 231.0Q60 244 60 267V701Q60 714 67.0 724.5Q74 735 86 740Q126 760 170.5 770.0Q215 780 260 780Q318 780 373.5 763.5Q429 747 480 717V258Q531 290 587.0 305.0Q643 320 700 320Q734 320 765.0 315.0Q796 310 828 300Q833 299 836.5 300.0Q840 301 840 306V755Q850 752 860.0 748.5Q870 745 880 739Q890 734 895.0 724.5Q900 715 900 704V268Q900 244 880.0 231.5Q860 219 838 229Q805 244 770.5 252.0Q736 260 700 260Q640 260 583.5 241.0Q527 222 479 185ZM560 360V720L760 920V540ZM420 287V681Q382 699 342.0 709.5Q302 720 260 720Q223 720 189.5 713.0Q156 706 127 694Q124 693 122.0 691.0Q120 689 120 686V305Q120 299 123.5 298.0Q127 297 132 299Q161 310 192.5 315.0Q224 320 260 320Q305 320 346.0 310.5Q387 301 420 287ZM420 287Q420 287 420.0 287.0Q420 287 420 287Q420 287 420.0 287.0Q420 287 420 287Q420 287 420.0 287.0Q420 287 420 287V681Q420 681 420.0 681.0Q420 681 420 681Q420 681 420.0 681.0Q420 681 420 681Q420 681 420.0 681.0Q420 681 420 681Z" />
              </g>
            </svg>
          </span>
          <span className={styles.brand}>SlideVault</span>
          <span className={styles.tag}>Prototype</span>
          <div className={styles.tools}>
            <ThemeToggle className={styles.themeButton} />
            <div className={styles.menuWrap} ref={wrap}>
              <button type="button" className={styles.avatarBtn} aria-haspopup="menu" aria-expanded={open} aria-label={`Account menu, signed in as ${profile}`} onClick={() => setOpen((o) => !o)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
                </svg>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>
              {open && (
                <div className={styles.menu} role="menu" aria-label="Account" onKeyDown={onMenuKey}>
                  <p className={styles.menuHead}>
                    Signed in as <strong>{profile}</strong>
                  </p>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    onClick={() => {
                      setOpen(false);
                      router.push('/slide-vault/profile#saved');
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
                    </svg>
                    Saved
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    onClick={() => {
                      setOpen(false);
                      signOut();
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <path d="m16 17 5-5-5-5" />
                      <path d="M21 12H9" />
                    </svg>
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
    </div>
  );
}
