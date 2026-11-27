import { Suspense } from 'react';
import { StandaloneWorkspace } from './StandaloneWorkspace';
import { AccessProvider } from './access';
import { ShellHeader } from './ShellHeader';
import { ThemeProvider } from './theme';
import styles from './shell.module.css';

/**
 * The workspace lives in the layout, not the page: layouts stay mounted while the URL changes
 * underneath them, so moving between /slide-vault/pages and /slide-vault/slide/:id keeps one
 * workspace instance (focus, selection and results survive; no duplicate landmarks).
 * Home, Create and Upload navigation lives inside the workspace. The shell gives the workspace a
 * box of a fixed height (the window) and hands it the header to show at the top of its own
 * scrolling area, the way a host platform would give it an `h-full min-h-0` container.
 */
export default function SlideVaultLayout({ children }: LayoutProps<'/slide-vault'>) {
  return (
    <ThemeProvider>
      <AccessProvider>
        <div className={styles.shell}>
          <a href="#sv-main" className={styles.skip}>
            Skip to content
          </a>
          <Suspense fallback={<p className={styles.loading}>Loading…</p>}>
            <StandaloneWorkspace header={<ShellHeader />} />
          </Suspense>
          {children}
        </div>
      </AccessProvider>
    </ThemeProvider>
  );
}
