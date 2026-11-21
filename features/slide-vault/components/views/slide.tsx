'use client';

import { Button, buttonClass } from '../ui/Button';
import { SlideTitle } from '../RenameSlide';
import { SlideEngagement, useShareSlide } from '../SlideActions';
import { SlideLabelsPanel, PreviewTags } from '../TagBits';
import { useEffect, useRef, useState } from 'react';
import { getSlide } from '../../client/api';
import type { SlideDetail, SlideSummary } from '../../contracts/dto';
import { Icon } from '../icons';
import { clientOf, dateLabel, hiddenGap, plural, UNKNOWN_CLIENT } from '../library';
import { PackPanel } from '../Packs';
import { Link, SlideCard, StateBlock, Thumb, useCartToggle, useSavedToggle } from '../parts';
import { FoldPanel } from '../fold-panel';
import { NumberJump } from '../Dialogs';
import { useWorkspaceCompact, useWorkspacePhoneLike } from '../size';
import { useAccount, useDraft, useLibrary, useOverlays, useRuntime } from '../state';
import { Row, useReadyLibrary, FILE_CREATED_TIP } from './shared';

function Unknown() {
  return <span className="unknown">Unknown</span>;
}

function FromFolder() {
  return (
    <span className="src" title="This came from the folder name, so it is reliable.">
      <Icon name="folder" />
      From folder
    </span>
  );
}

export function SlideView({ id }: { id: string }) {
  const { runtime } = useRuntime();
  const { library, packs, setIncludeHidden } = useLibrary();
  const { selection, addPackToDraft } = useDraft();
  const { openPreview, openDownload, openArchiveDialog, openAlso } = useOverlays();
  const { logActivity } = useAccount();
  const compact = useWorkspacePhoneLike();
  const onPhoneNow = useWorkspaceCompact();
  const upright = compact && !onPhoneNow; /* an upright tablet: the cards start opened */
  const shareSlide = useShareSlide(id);
  const { isSaved, toggle: toggleSave } = useSavedToggle();
  const touch = useRef<{ x: number; y: number } | null>(null);
  const { isSelected, setOne } = useCartToggle();
  const lib = useReadyLibrary();
  const slide = library.status === 'ready' ? library.slides.find((s) => s.id === id) : undefined;
  const deck = library.status === 'ready' && slide ? library.decks.find((d) => d.id === slide.provenance.sourceId) : undefined;

  /* Remember the slide we came from so it can slide out while the new one slides in. */
  const [step, setStep] = useState<{ id: string; from: SlideSummary | null; dir: 'next' | 'prev' | null }>({ id, from: null, dir: null });
  if (step.id !== id) {
    const sibsNow = library.status === 'ready' ? library.decks.find((d) => d.slides.some((s) => s.id === id))?.slides : undefined;
    const fromSlide = sibsNow?.find((s) => s.id === step.id) ?? null;
    const dir = fromSlide && sibsNow ? (sibsNow.indexOf(fromSlide) < sibsNow.findIndex((s) => s.id === id) ? 'next' : 'prev') : null;
    setStep({ id, from: fromSlide, dir });
  }
  const [detail, setDetail] = useState<{ id: string; slide: SlideDetail } | { id: string; error: string } | null>(null);
  const { request, onSessionExpired } = runtime;
  useEffect(() => {
    const controller = new AbortController();
    getSlide({ request, onSessionExpired }, id, controller.signal)
      .then((s) => setDetail({ id, slide: s }))
      .catch((e: Error) => e.name !== 'AbortError' && setDetail({ id, error: e.message }));
    return () => controller.abort();
  }, [request, onSessionExpired, id]);
  /* Record a visit to this slide in the signed-in person's activity (kept only after they opt in,
     FD-18). TopTenRow counts these per slide, so two people in the same area still get their own
     ranking. */
  useEffect(() => {
    if (slide) logActivity('viewed', slide.title, slide.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if ('blocker' in lib) return <div className="sv-wrap">{lib.blocker}</div>;
  if (!slide || !deck) {
    return (
      <div className="sv-wrap">
        <StateBlock icon="search" title="Slide not found" text="It may have been removed.">
          <Link className={buttonClass()} to={{ view: 'pages' }}>
            Back to Home
          </Link>
        </StateBlock>
      </div>
    );
  }

  const sibs = deck.slides;
  const i = sibs.findIndex((s) => s.id === id);
  const sel = isSelected(id);
  const slidePack = packs.of(id);
  const p = slide.provenance;
  const text = detail && detail.id === id ? ('slide' in detail ? detail.slide.text : null) : undefined;
  const textError = detail && detail.id === id && 'error' in detail ? detail.error : null;
  const more = (library.status === 'ready' ? library.slides : [])
    .filter((s) => s.id !== id && s.provenance.sourceId !== p.sourceId && clientOf(s) === clientOf(slide) && clientOf(s) !== UNKNOWN_CLIENT)
    .slice(0, 10);

  const textBody = (
    <>
      {text === undefined && !textError && <div className="skel" style={{ height: 64 }} aria-hidden="true" />}
      {textError && (
        <p className="err" role="alert">
          {textError}
        </p>
      )}
      {text !== undefined && text !== null && <p className="slide-text">{text || 'This slide has no text.'}</p>}
      <p className="meta" style={{ marginTop: 8 }}>
        Search reads this.
      </p>
    </>
  );
  /* "Also in N other decks": in the row with the actions on a portrait phone; at the left end of the tag row on a phone on its side. */
  return (
    <div className="sv-wrap">
      <div className="slide-detail">
        <div>
          <SlideTitle slide={slide} loaded={detail && detail.id === id && 'slide' in detail ? detail.slide : null} />
          {/* The picture and what goes with it; a phone on its side starts the right-hand cards level with the top of this. */}
          <div className="slide-main">
          <div
            className={compact ? 'hero-wrap' : undefined}
            onTouchStart={(e) => {
              if (compact) touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }}
            onTouchEnd={(e) => {
              const t = touch.current;
              touch.current = null;
              if (!compact || !t) return;
              const dx = e.changedTouches[0].clientX - t.x;
              const dy = e.changedTouches[0].clientY - t.y;
              if (Math.abs(dx) > 50 && Math.abs(dy) < 40) {
                const to = sibs[i + (dx < 0 ? 1 : -1)];
                if (to) runtime.navigate({ view: 'slide', id: to.id });
              }
            }}
          >
          <button
            type="button"
            className="big-preview"
            style={{
              display: 'block',
              width: '100%',
              padding: 0,
              cursor: 'pointer',
              background: 'none',
            }}
            aria-label="Open a larger preview"
            onClick={() => openPreview(sibs, i)}
          >
            <div className="slide-stage" style={{ aspectRatio: '16 / 9' }}>
              {step.from && step.dir && (
                <div key={`out-${step.from.id}`} className={`slide-layer slide-out-${step.dir}`} aria-hidden="true">
                  <Thumb slide={step.from} />
                </div>
              )}
              <div key={slide.id} className={`slide-layer${step.dir ? ` slide-in-${step.dir}` : ''}`}>
                <Thumb slide={slide} />
              </div>
            </div>
          </button>
          {compact && (
            <>
              <button type="button" className="hero-btn hero-add" aria-pressed={sel} aria-label={sel ? 'Remove from draft deck' : 'Add to draft deck'} onClick={() => setOne(slide, !sel)}>
                <Icon name="check" />
              </button>
              <span className="hero-corner">
                <button type="button" className={`hero-btn${isSaved(id) ? ' is-saved' : ''}`} aria-pressed={isSaved(id)} aria-label={isSaved(id) ? 'Remove from saved' : 'Save'} onClick={() => toggleSave(slide)}>
                  <Icon name="heart" />
                </button>
              </span>
              <span className="hero-zoom" aria-hidden="true">
                <Icon name="expand" />
              </span>
            </>
          )}
          </div>
          <div className="row-flex slide-stepper" style={{ marginTop: 12 }}>
            {i > 0 ? (
              <Link className={buttonClass({ size: 'sm', iconOnly: true })} to={{ view: 'slide', id: sibs[i - 1].id }} aria-label="Previous slide in this deck" title="Previous slide">
                <Icon name="left" />
              </Link>
            ) : (
              <span className="btn btn-sm btn-icon is-off" aria-hidden="true">
                <Icon name="left" />
              </span>
            )}
            <span className="meta slide-stepper-text">
              <NumberJump value={i + 1} max={sibs.length} label="Go to a slide in this deck" onGo={(k) => runtime.navigate({ view: 'slide', id: sibs[k].id })} />
              /{sibs.length} in deck
              {hiddenGap(sibs) > 0 && (
                <>
                  {' · '}
                  {hiddenGap(sibs)} hidden{' '}
                  <button type="button" className="btn-link" aria-label={`Show ${plural(hiddenGap(sibs), 'hidden slide')}`} onClick={() => setIncludeHidden(true)}>
                    Show
                  </button>
                </>
              )}
            </span>
            {i < sibs.length - 1 ? (
              <Link className={buttonClass({ size: 'sm', iconOnly: true })} to={{ view: 'slide', id: sibs[i + 1].id }} aria-label="Next slide in this deck" title="Next slide">
                <Icon name="right" />
              </Link>
            ) : (
              <span className="btn btn-sm btn-icon is-off" aria-hidden="true">
                <Icon name="right" />
              </span>
            )}
          </div>
          {/* The tags are rows of pills under the pager on every screen (the Add tag pill and the suggestions in a second row): scrolling on a phone and a tablet, wrapping on a desktop. */}
          <PreviewTags slide={slide} onNavigate={() => undefined} />
          <SlideEngagement key={slide.id} slide={slide} loaded={detail && detail.id === id && 'slide' in detail ? detail.slide : null} />
          {!compact && (
            <section className="panel slide-text-panel" style={{ marginTop: 16 }}>
              <h2>Text found on the slide</h2>
              {textBody}
            </section>
          )}
          </div>
        </div>
        <div className="stack-panels">
          <section className="panel panel-use">
            <h2>Use this slide</h2>
            <div className="row-flex">
              <Button size="sm" aria-pressed={sel} onClick={() => setOne(slide, !sel)}>
                <Icon name="check" />
                <span>{sel ? 'In draft deck' : 'Add to draft deck'}</span>
              </Button>
              <Button size="sm" onClick={() => void shareSlide()} data-tip="Copy link">
                <Icon name="share" />
                <span>Share</span>
              </Button>
              {slidePack && (
                <Button size="sm" disabled={slidePack.slideIds.every((pid) => selection.some((x) => x.id === pid))} onClick={() => addPackToDraft(slidePack)}>
                  <Icon name="plus" />
                  <span>Add whole pack ({slidePack.slideIds.length})</span>
                </Button>
              )}
              <Button size="sm" variant="primary" onClick={() => openDownload([slide])}>
                <Icon name="download" />
                <span>Download slide</span>
              </Button>
              <Link className={buttonClass({ size: 'sm' })} to={{ view: 'deck', id: deck.id }}>
                <Icon name="deck" />
                <span>Open deck</span>
              </Link>
            </div>
            {slide.alsoIn && (
              <Button variant="link" className="also-link" onClick={() => openAlso(slide)}>
                <Icon name="folders" className="ic-sm" />
                <span>Also in {plural(slide.alsoIn.otherDeckCount, 'other deck')}</span>
              </Button>
            )}
          </section>
          {slidePack && <PackPanel slide={slide} pack={slidePack} />}
          <SlideLabelsPanel fold={compact} open={upright} story={(detail && detail.id === id && 'slide' in detail ? detail.slide.story : undefined) ?? slide.story} />
          {compact ? (
            <FoldPanel className="panel-details" open={upright} title="Details" hint={p.sourceTitle}>
              <dl className="trust">

              <dt>Deck</dt>
              <dd className="break-name">
                {p.sourceTitle}
                <button type="button" className="btn-link arch-link" onClick={() => openArchiveDialog({ deck: { id: deck.id, title: deck.title, slideCount: deck.slides.length }, restore: !!deck.archived, fromSlide: slide.title })}>
                  <Icon name="archive" className="ic-sm" />
                  <span className="arch-text">
                    <span className="arch-l">{deck.archived ? 'Restore this deck' : 'Archive this deck'}</span>
                  </span>
                </button>
              </dd>
              <dt>File</dt>
              <dd className="break-name">{p.sourceFileName}</dd>
              </dl>
              <details className="more-det">
                <summary>More</summary>
                <dl className="trust">
              {p.createdBy && (
                <>
                  <dt title={FILE_CREATED_TIP}>File created by</dt>
                  <dd>
                    {p.createdBy}
                    {dateLabel(p.createdAt) ? `, ${dateLabel(p.createdAt)}` : ''}
                  </dd>
                </>
              )}
              {p.uploadedBy && (
                <>
                  <dt>Uploaded by</dt>
                  <dd>
                    {p.uploadedBy}
                    {dateLabel(p.uploadedAt) ? `, ${dateLabel(p.uploadedAt)}` : ''}
                  </dd>
                </>
              )}
              <dt>Client</dt>
              <dd>
                {p.clientName ?? <Unknown />}
                {p.clientName && <FromFolder />}
              </dd>
              <dt>Year</dt>
              <dd>
                {p.deckYear ?? <Unknown />}
                {p.deckYear && <FromFolder />}
              </dd>
              <dt>Category</dt>
              <dd>
                {p.category ?? <Unknown />}
                {p.category && <FromFolder />}
              </dd>
              <dt>Position</dt>
              <dd>
                Slide {p.slideNumber}
                {slide.hiddenInSource ? ', hidden in the source deck' : ''}
              </dd>
                            </dl>
              </details>
            </FoldPanel>
          ) : (
          <section className="panel panel-details">
            <h2>Details</h2>
            <dl className="trust">
              <dt>Deck</dt>
              <dd className="break-name">
                {p.sourceTitle}
                <button type="button" className="btn-link arch-link" onClick={() => openArchiveDialog({ deck: { id: deck.id, title: deck.title, slideCount: deck.slides.length }, restore: !!deck.archived, fromSlide: slide.title })}>
                  <Icon name="archive" className="ic-sm" />
                  <span className="arch-text">
                    <span className="arch-l">{deck.archived ? 'Restore this deck' : 'Archive this deck'}</span>
                  </span>
                </button>
              </dd>
              <dt>File</dt>
              <dd className="break-name">{p.sourceFileName}</dd>
              {p.createdBy && (
                <>
                  <dt title={FILE_CREATED_TIP}>File created by</dt>
                  <dd>
                    {p.createdBy}
                    {dateLabel(p.createdAt) ? `, ${dateLabel(p.createdAt)}` : ''}
                  </dd>
                </>
              )}
              {p.uploadedBy && (
                <>
                  <dt>Uploaded by</dt>
                  <dd>
                    {p.uploadedBy}
                    {dateLabel(p.uploadedAt) ? `, ${dateLabel(p.uploadedAt)}` : ''}
                  </dd>
                </>
              )}
              <dt>Client</dt>
              <dd>
                {p.clientName ?? <Unknown />}
                {p.clientName && <FromFolder />}
              </dd>
              <dt>Year</dt>
              <dd>
                {p.deckYear ?? <Unknown />}
                {p.deckYear && <FromFolder />}
              </dd>
              <dt>Category</dt>
              <dd>
                {p.category ?? <Unknown />}
                {p.category && <FromFolder />}
              </dd>
              <dt>Position</dt>
              <dd>
                Slide {p.slideNumber}
                {slide.hiddenInSource ? ', hidden in the source deck' : ''}
              </dd>
            </dl>
          </section>
          )}
          {compact && (
            <FoldPanel className="slide-text-panel" open={upright} title="Slide text" hint={text ? text.slice(0, 70) : text === null ? undefined : text === '' ? 'No text' : undefined}>
              {textBody}
            </FoldPanel>
          )}
        </div>
      </div>
      {more.length > 0 && (
        <Row id="more" title={`More from ${clientOf(slide)}`}>
          {more.map((s) => (
            <li key={s.id}>
              <SlideCard slide={s} list={more} />
            </li>
          ))}
        </Row>
      )}
    </div>
  );
}

/* ------------------------------------------------------- Create, Upload */
