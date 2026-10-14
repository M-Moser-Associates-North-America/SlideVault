'use client';

import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';
import { exportPptx } from '../client/api';
import type { SlideSummary } from '../contracts/dto';
import { Icon } from './icons';
import { downloadPlan, plural, planSummary } from './library';
import { Link, useCartToggle } from './parts';
import { useWorkspace } from './state';

/** Open and close a native <dialog> from React state. Escape closes it (via the dialog's own close event). */
function useDialogOpen(ref: RefObject<HTMLDialogElement | null>, open: boolean) {
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [ref, open]);
}

/** A click on the backdrop (the dialog element itself) closes it. */
const backdropClose = (onClose: () => void) => (e: MouseEvent<HTMLDialogElement>) => {
  if (e.target === e.currentTarget) onClose();
};

/** Large preview of a slide, stepping through the list it was opened from. */
export function Lightbox() {
  const { runtime, preview, closePreview, movePreview, openDownload } = useWorkspace();
  const { isSelected, set } = useCartToggle();
  const ref = useRef<HTMLDialogElement>(null);
  useDialogOpen(ref, !!preview);
  const slide = preview ? preview.list[preview.index] : null;
  const many = !!preview && preview.list.length > 1;

  return (
    <dialog
      ref={ref}
      className="slidevault sv-dialog wide"
      data-theme={runtime.theme}
      aria-labelledby="sv-lb-title"
      onClose={closePreview}
      onClick={backdropClose(closePreview)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') movePreview(-1);
        if (e.key === 'ArrowRight') movePreview(1);
      }}
    >
      {slide && preview && (
        <>
          <div className="dlg-head">
            <div>
              <h2 id="sv-lb-title">{slide.title}</h2>
              <p className="meta">
                {slide.provenance.sourceTitle} · slide {slide.provenance.slideNumber}
                {slide.hiddenInSource ? ' · hidden in source' : ''}
              </p>
            </div>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Close preview" onClick={closePreview}>
              <Icon name="x" />
            </button>
          </div>
          <div className="dlg-body">
            <div className="lb-stage">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={runtime.assetUrl(slide.previewPath)} alt={slide.title} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
              {many && (
                <>
                  <button type="button" className="btn btn-icon lb-nav lb-prev" aria-label="Previous slide" onClick={() => movePreview(-1)}>
                    <Icon name="left" />
                  </button>
                  <button type="button" className="btn btn-icon lb-nav lb-next" aria-label="Next slide" onClick={() => movePreview(1)}>
                    <Icon name="right" />
                  </button>
                </>
              )}
            </div>
            <div className="lb-caption">
              <span className="counter" aria-live="polite">
                {preview.index + 1} of {preview.list.length}
              </span>
              <span className="row-flex">
                <button type="button" className="btn btn-sm" aria-pressed={isSelected(slide.id)} onClick={() => set(slide, !isSelected(slide.id))}>
                  <Icon name="check" />
                  <span>{isSelected(slide.id) ? 'In cart' : 'Add to cart'}</span>
                </button>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => { closePreview(); openDownload([slide]); }}>
                  <Icon name="download" />
                  <span>Download only this slide</span>
                </button>
                <Link className="btn btn-sm" to={{ view: 'slide', id: slide.id }} onNavigate={closePreview}>
                  Open slide page
                </Link>
              </span>
            </div>
          </div>
        </>
      )}
    </dialog>
  );
}

type Run = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; fileName: string } | { kind: 'error'; message: string };

/** What you are about to download, then the real export. */
export function DownloadDialog() {
  const { runtime, downloadSlides, closeDownload, toast } = useWorkspace();
  // The result belongs to the slides it was started for, so opening the dialog again starts fresh.
  const [result, setResult] = useState<{ for: SlideSummary[] | null; run: Run }>({ for: null, run: { kind: 'idle' } });
  const run: Run = result.for === downloadSlides ? result.run : { kind: 'idle' };
  const setRun = (r: Run) => setResult({ for: downloadSlides, run: r });
  const ref = useRef<HTMLDialogElement>(null);
  useDialogOpen(ref, !!downloadSlides);

  const slides = downloadSlides ?? [];
  const plan = downloadPlan(slides);
  const canExport = runtime.capabilities.has('export.create');

  async function go() {
    setRun({ kind: 'busy' });
    try {
      const { blob, fileName } = await exportPptx(runtime, slides);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      setRun({ kind: 'done', fileName });
      toast(`Downloaded ${fileName}`);
    } catch (e) {
      const offline = e instanceof TypeError; // fetch rejects with TypeError when the network fails
      setRun({ kind: 'error', message: offline ? 'Could not reach the server. Check your connection and try again.' : (e as Error).message });
    }
  }

  return (
    <dialog ref={ref} className="slidevault sv-dialog" data-theme={runtime.theme} aria-labelledby="sv-dl-title" onClose={closeDownload} onClick={backdropClose(closeDownload)}>
      <div className="dlg-head">
        <div>
          <h2 id="sv-dl-title">Download {plural(slides.length, 'slide')}</h2>
          <p className="meta">You get {planSummary(plan)}. Slides stay editable.{plan.zip ? ' One combined file is planned for a later phase.' : ''}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Close" onClick={closeDownload}>
          <Icon name="x" />
        </button>
      </div>
      <div className="dlg-body">
        <ul className="dl-files">
          {plan.files.map((f) => (
            <li key={f.deckId}>
              <Icon name="file" />
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{f.deckTitle}</span>
              <span className="meta">{plural(f.count, 'slide')}</span>
            </li>
          ))}
        </ul>
        <p className="meta" style={{ marginTop: 10 }}>
          The file holds only the slides you picked, in this order. Speaker notes and review comments are left out, and source decks are never changed.
        </p>
        {run.kind === 'error' && (
          <div className="notice danger" role="alert">
            <Icon name="alert" />
            <span>{run.message} Your cart is unchanged.</span>
          </div>
        )}
        {run.kind === 'done' && (
          <div className="notice info" role="status">
            <Icon name="check" />
            <span>Downloaded {run.fileName}.</span>
          </div>
        )}
        {!canExport && (
          <div className="notice info">
            <Icon name="lock" />
            <span>Your access does not include downloads.</span>
          </div>
        )}
      </div>
      <div className="dlg-foot">
        <button type="button" className="btn" onClick={closeDownload}>
          {run.kind === 'done' ? 'Done' : 'Cancel'}
        </button>
        {run.kind !== 'done' && (
          <button type="button" className="btn btn-primary" disabled={!canExport || !slides.length || run.kind === 'busy'} aria-busy={run.kind === 'busy'} onClick={go}>
            <Icon name={run.kind === 'busy' ? 'spinner' : 'download'} className={run.kind === 'busy' ? 'spin' : ''} />
            <span>{run.kind === 'busy' ? 'Building PowerPoint…' : run.kind === 'error' ? 'Try again' : 'Download'}</span>
          </button>
        )}
      </div>
    </dialog>
  );
}


