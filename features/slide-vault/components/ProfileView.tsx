'use client';

import { useEffect, useState } from 'react';
import { ActivityOptInDialog, RETENTION_FALLBACK_DAYS, type OptInMode } from './ActivityOptIn';
import { Icon } from './icons';
import { SlideCard } from './parts';
import { useWorkspace } from './state';

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
function timeAgo(at: number): string {
  const mins = Math.round((at - Date.now()) / 60000);
  if (mins > -1) return 'just now';
  if (mins > -60) return RELATIVE.format(mins, 'minute');
  const hours = Math.round(mins / 60);
  if (hours > -24) return RELATIVE.format(hours, 'hour');
  return RELATIVE.format(Math.round(hours / 24), 'day');
}

/**
 * Local design prototype: a profile dashboard -- saved slides plus a simple activity record,
 * scoped to whichever demo profile is signed in. Kept deliberately small: a proposal library
 * for a few hundred people needs this to be simple, not a second app (not pushed, not real auth).
 */
export function ProfileView() {
  const { profile, savedIds, activity, library, drafts, loadDraft, deleteDraft, selection, toast, activityOptedIn, activityRetentionDays } = useWorkspace();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [optInFor, setOptInFor] = useState<OptInMode | null>(null);
  const days = activityRetentionDays ?? RETENTION_FALLBACK_DAYS;
  /* Arriving from the account menu's "Saved" item: scroll to the Saved section once the page is up. */
  useEffect(() => {
    if (window.location.hash !== '#saved') return;
    const t = setTimeout(() => document.getElementById('saved')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    return () => clearTimeout(t);
  }, []);
  const saved = library.status === 'ready' ? library.slides.filter((s) => savedIds.has(s.id)) : [];

  return (
    <div className="sv-wrap profile-wrap">
      <div className="page-head">
        <div>
          <h1 className="h1" tabIndex={-1}>
            My decks
          </h1>
          <p className="lede">Your saved slides and working drafts. Signed in as {profile}.</p>
        </div>
      </div>

      <section className="row" id="saved">
        <div className="row-head">
          <h2 className="h2">Saved</h2>
        </div>
        {saved.length === 0 ? (
          <p className="meta">Nothing saved yet. Tap the heart on any slide to keep it here for later.</p>
        ) : (
          <ul className="row-scroller">
            {saved.map((s) => (
              <li key={s.id}>
                <SlideCard slide={s} list={saved} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="row" id="drafts">
        <div className="row-head">
          <h2 className="h2">Working drafts</h2>
        </div>
        {drafts.length === 0 ? (
          <p className="meta">No drafts yet. In your draft deck, choose Save as draft to keep a set of slides here.</p>
        ) : (
          <ul className="draft-list">
            {drafts.map((d) => (
              <li key={d.id} className="draft-item">
                <span className="draft-ic" aria-hidden="true">
                  <Icon name="folder" />
                </span>
                <div className="draft-txt">
                  <strong>{d.name}</strong>
                  <span className="meta">
                    {d.slideIds.length === 1 ? '1 slide' : `${d.slideIds.length} slides`} · saved {timeAgo(d.savedAt)}
                  </span>
                </div>
                {confirmDelete === d.id ? (
                  <div className="cart-confirm" role="group" aria-label={`Confirm deleting ${d.name}`}>
                    <span className="cc-q">Are you sure?</span>
                    <button
                      type="button"
                      className="btn btn-sm btn-icon cc-yes"
                      aria-label={`Yes, delete ${d.name}`}
                      onClick={() => {
                        deleteDraft(d.id);
                        setConfirmDelete(null);
                        toast(`Deleted “${d.name}”`);
                      }}
                    >
                      <Icon name="check" />
                    </button>
                    <button type="button" className="btn btn-sm btn-icon" aria-label="No, keep it" onClick={() => setConfirmDelete(null)}>
                      <Icon name="x" />
                    </button>
                  </div>
                ) : (
                  <div className="draft-acts">
                    <button
                      type="button"
                      className="btn btn-sm"
                      title={selection.length ? 'Replaces what is in your draft deck now' : undefined}
                      onClick={() => {
                        const found = loadDraft(d);
                        toast(found === d.slideIds.length ? `Opened “${d.name}” in your draft deck` : `Opened “${d.name}”. ${d.slideIds.length - found} slide(s) are no longer in the library.`);
                      }}
                    >
                      Open in draft deck
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDelete(d.id)}>
                      Delete
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="row" id="personalize">
        <div className="row-head">
          <h2 className="h2">Personalize my Home</h2>
        </div>
        <label className="fb-check">
          <input type="checkbox" checked={activityOptedIn === true} disabled={activityOptedIn === null} onChange={() => setOptInFor(activityOptedIn ? 'off' : 'on')} />
          <span>Use my activity to personalize my Home (kept {days} days)</span>
        </label>
        <p className="meta" style={{ marginTop: 6 }}>
          {activityOptedIn === null
            ? 'Not available right now.'
            : 'Your Top 10 and Suggested for you are ranked from the slides you open, save and download. Only you see this. Turning it off deletes your history.'}
        </p>
        <ActivityOptInDialog mode={optInFor} onClose={() => setOptInFor(null)} />
      </section>

      <section className="row">
        <div className="row-head">
          <h2 className="h2">Recent activity</h2>
        </div>
        {activity.length === 0 ? (
          <p className="meta">{activityOptedIn ? 'Nothing recorded yet. Open or download a slide to see it here.' : 'Turn on “Personalize my Home” above to see your activity here.'}</p>
        ) : (
          <ul className="activity-list">
            {activity.map((a, i) => (
              <li key={i}>
                <Icon name={a.kind === 'downloaded' ? 'download' : 'eye'} className="ic-sm" />
                <span className="activity-label">
                  {a.kind === 'downloaded' ? 'Downloaded' : 'Viewed'} <strong>{a.label}</strong>
                </span>
                <span className="activity-time">{timeAgo(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
