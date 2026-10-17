'use client';

import { useProfile } from '@/features/slide-vault';
import { ThemeToggle, useTheme } from './theme';
import styles from './shell.module.css';

/**
 * The top of the app: logo and name on the left, theme and Sign out on the right. Sign out stands in
 * for the real login (M Moser's system); who you are, and so what you can see, comes from signing in,
 * not from a switch. Hidden on the sign-in screens, which show their own logo.
 */
export function ShellHeader() {
  const { theme } = useTheme();
  const { profile, signOut } = useProfile();
  if (!profile) return null;
  return (
    <div className="slidevault" data-theme={theme}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <span className={styles.logo} aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
          </span>
          <span className={styles.brand}>SlideVault</span>
          <span className={styles.tag}>Prototype</span>
          <div className={styles.tools}>
            <ThemeToggle className={styles.themeButton} />
            <button type="button" className={styles.signOut} onClick={signOut}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <path d="m16 17 5-5-5-5" />
                <path d="M21 12H9" />
              </svg>
              Sign out
            </button>
          </div>
        </div>
      </header>
    </div>
  );
}
