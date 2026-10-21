'use client';

import { useState } from 'react';
import { ActivityOptInDialog, RETENTION_FALLBACK_DAYS, type OptInMode } from './ActivityOptIn';
import { Icon } from './icons';
import { timeAgo } from './library';
import { useWorkspace } from './state';

/** Settings from the account menu: personalization and the activity it records. */
export function SettingsView() {
  const { profile, activity, activityOptedIn, activityRetentionDays } = useWorkspace();
  const [optInFor, setOptInFor] = useState<OptInMode | null>(null);
  const days = activityRetentionDays ?? RETENTION_FALLBACK_DAYS;

  return (
    <div className="sv-wrap profile-wrap">
      <div className="page-head">
        <div>
          <h1 className="h1" tabIndex={-1}>
            Settings
          </h1>
          <p className="lede">Signed in as {profile}.</p>
        </div>
      </div>

      <section className="row" id="personalize">
        <div className="row-head">
          <h2 className="h2">Personalize my Vault</h2>
        </div>
        <label className="fb-check">
          <input type="checkbox" checked={activityOptedIn === true} disabled={activityOptedIn === null} onChange={() => setOptInFor(activityOptedIn ? 'off' : 'on')} />
          <span>Use my activity to personalize my Vault (kept {days} days)</span>
        </label>
        <p className="meta" style={{ marginTop: 6 }}>
          {activityOptedIn === null ? 'Not available right now.' : 'Ranks Your Top 10 and Suggested for you from your own activity. Turning it off deletes your history.'}
        </p>
        <ActivityOptInDialog mode={optInFor} onClose={() => setOptInFor(null)} />
      </section>

      <section className="row">
        <div className="row-head">
          <h2 className="h2">Recent activity</h2>
        </div>
        {activity.length === 0 ? (
          <p className="meta">{activityOptedIn ? 'Nothing recorded yet. Open or download a slide to see it here.' : 'Turn on “Personalize my Vault” above to see your activity here.'}</p>
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
