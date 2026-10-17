'use client';

import { Icon } from './icons';
import { SlideCard } from './parts';
import { profileInitials, useWorkspace } from './state';

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
  const { profile, savedIds, activity, library, signOut } = useWorkspace();
  const saved = library.status === 'ready' ? library.slides.filter((s) => savedIds.has(s.id)) : [];

  return (
    <div className="sv-wrap profile-wrap">
      <div className="page-head">
        <div className="profile-id">
          <span className="profile-avatar" aria-hidden="true">
            {profileInitials(profile ?? '')}
          </span>
          <div>
            <h1 className="h1" tabIndex={-1}>
              {profile}
            </h1>
            <p className="lede">Saved slides and recent activity for this profile.</p>
          </div>
        </div>
        <button type="button" className="btn btn-sm" onClick={signOut}>
          Switch profile
        </button>
      </div>

      <section className="row">
        <div className="row-head">
          <h2 className="h2">Saved</h2>
        </div>
        {saved.length === 0 ? (
          <p className="meta">Nothing saved yet. Tap the heart on any slide to keep it here.</p>
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

      <section className="row">
        <div className="row-head">
          <h2 className="h2">Recent activity</h2>
        </div>
        {activity.length === 0 ? (
          <p className="meta">Nothing recorded yet. Open or download a slide to see it here.</p>
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
