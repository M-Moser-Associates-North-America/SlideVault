import { SlideVaultWorkspace } from '@/features/slide-vault';
import { loadLibrary } from '@/features/slide-vault/server';
import styles from './shell.module.css';

export default async function LibraryPage() {
  const library = await loadLibrary();

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.brand}>SlideVault</span>
        <span className={styles.tag}>Prototype</span>
      </header>
      {/* The shell owns theme and layout; the workspace renders inside its root. */}
      <div className="slidevault" data-theme="light">
        {library ? (
          <SlideVaultWorkspace library={library} exportEndpoint="/api/export" />
        ) : (
          <p className={styles.setup}>
            The library is empty. Run <code>npm run ingest</code> to build it from the reference deck, then reload.
          </p>
        )}
      </div>
    </div>
  );
}
