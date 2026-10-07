'use client';

import { useState } from 'react';
import { exportPptx } from '../client/api';
import type { SlideSummary } from '../contracts/dto';
import type { SlideVaultRuntime } from '../contracts/runtime';
import styles from './workspace.module.css';

type ExportState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'error'; message: string } | { kind: 'done'; count: number };

type Props = {
  runtime: SlideVaultRuntime;
  selection: SlideSummary[];
  updateSelection: (fn: (current: SlideSummary[]) => SlideSummary[]) => void;
};

/** The ordered selection ("Proposal builder" tray) and the export action. */
export function SelectionPanel({ runtime, selection, updateSelection }: Props) {
  const [state, setState] = useState<ExportState>({ kind: 'idle' });
  const canExport = runtime.capabilities.has('export.create');

  const move = (index: number, delta: -1 | 1) =>
    updateSelection((cur) => {
      const next = [...cur];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item);
      return next;
    });
  const remove = (id: string) => updateSelection((cur) => cur.filter((s) => s.id !== id));

  async function runExport() {
    setState({ kind: 'busy' });
    try {
      const blob = await exportPptx(runtime, selection);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'SlideVault-export.pptx';
      link.click();
      URL.revokeObjectURL(url);
      setState({ kind: 'done', count: selection.length });
    } catch (e) {
      const offline = e instanceof TypeError; // fetch rejects with TypeError when the network fails
      setState({ kind: 'error', message: offline ? 'Could not reach the server. Check your connection and try again.' : (e as Error).message });
    }
  }

  return (
    <aside className={styles.panel} aria-labelledby="sv-selection-heading">
      <div className={styles.panelHead}>
        <h2 id="sv-selection-heading" className={styles.panelTitle}>
          Selection <span className={styles.pill}>{selection.length}</span>
        </h2>
        {selection.length > 0 && (
          <button type="button" className={styles.link} onClick={() => updateSelection(() => [])}>
            Clear
          </button>
        )}
      </div>

      {selection.length === 0 ? (
        <p className={styles.panelEmpty}>Select slides from the results. Their order here becomes the order of the exported PowerPoint.</p>
      ) : (
        <ol className={styles.selectionList}>
          {selection.map((s, i) => (
            <li key={s.id} className={styles.selectionItem}>
              <span className={styles.position}>{i + 1}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={runtime.assetUrl(s.previewPath)} alt="" className={styles.miniThumb} />
              <span className={styles.selectionText}>
                <span className={styles.selectionTitle}>{s.title}</span>
                <span className={styles.meta}>
                  {s.provenance.sourceTitle} · slide {s.provenance.slideNumber}
                </span>
              </span>
              <span className={styles.reorder}>
                <button type="button" className={styles.icon} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move “${s.title}” up`}>
                  ↑
                </button>
                <button type="button" className={styles.icon} disabled={i === selection.length - 1} onClick={() => move(i, 1)} aria-label={`Move “${s.title}” down`}>
                  ↓
                </button>
                <button type="button" className={styles.icon} onClick={() => remove(s.id)} aria-label={`Remove “${s.title}” from selection`}>
                  ×
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      {canExport && (
        <button
          type="button"
          className={`${styles.primary} ${styles.exportButton}`}
          disabled={selection.length === 0 || state.kind === 'busy'}
          aria-busy={state.kind === 'busy'}
          onClick={runExport}
        >
          {state.kind === 'busy' ? 'Building PowerPoint…' : 'Export editable PowerPoint'}
        </button>
      )}
      <div aria-live="polite">
        {state.kind === 'done' && (
          <p className={styles.success}>
            Downloaded SlideVault-export.pptx with {state.count} {state.count === 1 ? 'slide' : 'slides'}.
          </p>
        )}
      </div>
      {state.kind === 'error' && (
        <p className={styles.error} role="alert">
          {state.message} Your selection is unchanged.
        </p>
      )}
      <p className={styles.note}>
        The file contains only the slides listed here, in this order, as editable PowerPoint. Source decks are never changed.
        Speaker notes and review comments are left out.
      </p>
    </aside>
  );
}
