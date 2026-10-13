'use client';

import type { SlideVaultWorkspaceProps } from '../contracts/runtime';
import { PagesView } from './PagesView';
import { UploadView } from './UploadView';
import styles from './workspace.module.css';

/**
 * The SlideVault workspace: renders inside whatever space its host gives it and talks to the
 * outside world only through `runtime` (docs/INTEGRATION_CONTRACT.md).
 *
 * Screens are added one build step at a time (docs/foundry/CONVENTIONS.md). Views not built yet
 * say so plainly instead of showing a fake screen.
 */
export function SlideVaultWorkspace({ runtime }: SlideVaultWorkspaceProps) {
  const { view, id } = runtime.location;

  if (view === 'pages' || view === 'slide') {
    // The slide view opens as a preview over the results, so deep links and Back both work.
    return <PagesView key={runtime.sessionScopeKey} runtime={runtime} previewSlideId={view === 'slide' ? id : undefined} />;
  }

  if (view === 'upload') {
    return <UploadView key={runtime.sessionScopeKey} runtime={runtime} />;
  }

  return (
    <div className={styles.workspace}>
      <main className={styles.main}>
        <h1 className={styles.heading}>Not built yet</h1>
        <p className={styles.lead}>The “{view}” screen is planned for a later build step.</p>
        <button type="button" className={styles.secondary} onClick={() => runtime.navigate({ view: 'pages' })}>
          Go to slides
        </button>
      </main>
    </div>
  );
}
