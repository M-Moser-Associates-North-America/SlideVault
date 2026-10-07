import { Suspense } from 'react';
import { StandaloneWorkspace } from '../StandaloneWorkspace';
import styles from '../shell.module.css';

// /slide-vault, /slide-vault/pages, /slide-vault/slide/<id>, … → one workspace, location from the path.
export default function SlideVaultPage(props: PageProps<'/slide-vault/[[...segments]]'>) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <span className={styles.brand}>SlideVault</span>
        <span className={styles.tag}>Prototype</span>
      </header>
      <Suspense fallback={<p className={styles.loading}>Loading…</p>}>
        <StandaloneWorkspace params={props.params} />
      </Suspense>
    </div>
  );
}
