import { Suspense } from 'react';
import { StandaloneWorkspace } from './StandaloneWorkspace';
import { AccessProvider, AccessSwitch } from './access';
import { ThemeProvider, ThemeToggle } from './theme';
import styles from './shell.module.css';

/**
 * The workspace lives in the layout, not the page: layouts stay mounted while the URL changes
 * underneath them, so moving between /slide-vault/pages and /slide-vault/slide/:id keeps one
 * workspace instance (focus, selection and results survive; no duplicate landmarks).
 * Home, Create and Upload navigation lives inside the workspace.
 */
export default function SlideVaultLayout({ children }: LayoutProps<'/slide-vault'>) {
  return (
    <ThemeProvider>
      <AccessProvider>
        <div className={styles.shell}>
          <a href="#sv-main" className={styles.skip}>
            Skip to content
          </a>
          <header className={styles.header}>
            <span className={styles.brand}>SlideVault</span>
            <span className={styles.tag}>Prototype</span>
            <div className={styles.tools}>
              <AccessSwitch />
              <ThemeToggle className={styles.themeButton} />
            </div>
          </header>
          <Suspense fallback={<p className={styles.loading}>Loading…</p>}>
            <StandaloneWorkspace />
          </Suspense>
          {children}
        </div>
      </AccessProvider>
    </ThemeProvider>
  );
}
