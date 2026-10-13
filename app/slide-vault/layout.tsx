import { Suspense } from 'react';
import { StandaloneWorkspace } from './StandaloneWorkspace';
import styles from './shell.module.css';

/**
 * The workspace lives in the layout, not the page: layouts stay mounted while the URL changes
 * underneath them, so moving between /slide-vault/pages and /slide-vault/slide/:id keeps one
 * workspace instance (focus, selection and results survive; no duplicate landmarks).
 */
export default function SlideVaultLayout({ children }: LayoutProps<'/slide-vault'>) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.brand}>SlideVault</span>
        <span className={styles.tag}>Prototype</span>
      </header>
      <Suspense fallback={<p className={styles.loading}>Loading…</p>}>
        <StandaloneWorkspace />
      </Suspense>
      {children}
    </div>
  );
}
