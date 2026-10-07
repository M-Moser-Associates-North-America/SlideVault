'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getSlide } from '../client/api';
import type { SlideDetail, SlideSummary } from '../contracts/dto';
import type { SlideVaultRuntime } from '../contracts/runtime';
import styles from './workspace.module.css';

type Props = {
  runtime: SlideVaultRuntime;
  /** Open when set; closed when undefined */
  slideId: string | undefined;
  isSelected: boolean;
  onToggle: (slide: SlideSummary) => void;
  onClose: () => void;
};

type Loaded = { status: 'loading' } | { status: 'ready'; slide: SlideDetail } | { status: 'error'; message: string };

const APPROVAL_LABEL = { approved: 'Approved', in_review: 'In review', draft: 'Draft' } as const;

/**
 * Large preview with provenance and trust fields (PR-03). Uses the native <dialog>:
 * Escape closes it, focus stays inside while open and returns afterwards.
 */
export function PreviewDialog({ runtime, slideId, isSelected, onToggle, onClose }: Props) {
  const { request, onSessionExpired } = runtime;
  const transport = useMemo(() => ({ request, onSessionExpired }), [request, onSessionExpired]);
  const ref = useRef<HTMLDialogElement>(null);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (slideId && !dialog.open) dialog.showModal();
    if (!slideId && dialog.open) dialog.close();
  }, [slideId]);

  useEffect(() => {
    if (!slideId) return;
    const controller = new AbortController();
    getSlide(transport, slideId, controller.signal)
      .then((slide) => setLoaded({ status: 'ready', slide }))
      .catch((e: Error) => e.name !== 'AbortError' && setLoaded({ status: 'error', message: e.message }));
    return () => {
      controller.abort();
      setLoaded({ status: 'loading' });
    };
  }, [transport, slideId]);

  const slide = loaded.status === 'ready' ? loaded.slide : null;
  const unknown = <span className={styles.unknown}>Unknown</span>;

  return (
    // Portals must keep the feature's token scope (docs/DESIGN_SYSTEM.md), hence the root class on the dialog.
    <dialog
      ref={ref}
      className={`slidevault ${styles.dialog}`}
      data-theme={runtime.theme}
      aria-labelledby="sv-preview-title"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {loaded.status === 'loading' && slideId && <p className={styles.dialogStatus}>Loading slide…</p>}
      {loaded.status === 'error' && (
        <div className={styles.dialogStatus} role="alert">
          <p>{loaded.message}</p>
          <button type="button" className={styles.secondary} onClick={onClose}>
            Close
          </button>
        </div>
      )}
      {slide && (
        <div className={styles.dialogInner}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={runtime.assetUrl(slide.previewPath)} alt={slide.title} className={styles.dialogImage} />
          <div className={styles.dialogSide}>
            <div className={styles.dialogTop}>
              <p className={styles.meta}>
                {slide.provenance.sourceTitle} · slide {slide.provenance.slideNumber}
                {slide.hiddenInSource ? ' · hidden in source' : ''}
              </p>
              <button type="button" className={styles.icon} onClick={onClose} aria-label="Close preview">
                ×
              </button>
            </div>
            <h2 id="sv-preview-title" className={styles.dialogTitle}>
              {slide.title}
            </h2>
            <dl className={styles.trust}>
              <dt>Source</dt>
              <dd>
                {slide.provenance.sourceFileName}, slide {slide.provenance.slideNumber}
              </dd>
              <dt>Version</dt>
              <dd>{slide.provenance.sourceVersionId}</dd>
              <dt>Owner</dt>
              <dd>{slide.provenance.owner ?? unknown}</dd>
              <dt>Approval</dt>
              <dd>{slide.provenance.approvalStatus ? APPROVAL_LABEL[slide.provenance.approvalStatus] : <span className={styles.unknown}>Not reviewed</span>}</dd>
              <dt>Last reviewed</dt>
              <dd>{slide.provenance.reviewedAt ?? unknown}</dd>
            </dl>
            <h3 className={styles.label}>Slide text</h3>
            <div className={styles.slideText}>{slide.text || 'This slide has no text.'}</div>
            <button type="button" className={isSelected ? styles.secondary : styles.primary} onClick={() => onToggle(slide)}>
              {isSelected ? 'Remove from selection' : 'Add to selection'}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
