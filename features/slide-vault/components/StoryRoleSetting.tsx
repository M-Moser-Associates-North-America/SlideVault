'use client';

import { ROLE_CHOICES, useStoryRole } from '../client/role-store';
import { useWorkspace } from './state';
import './storyboard.css';

/**
 * "I build proposals as…" in the profile (FD-25): set once, used to tune every storyboard. The
 * three choices are the groups Grant described on 21 Oct, in his words.
 */
export function StoryRoleSetting() {
  const { profile, announce } = useWorkspace();
  const { role, setRole } = useStoryRole(profile);
  return (
    <section className="row sb-roles" aria-labelledby="sb-roles-h">
      <div className="row-head">
        <h2 className="h2" id="sb-roles-h">
          How you build proposals
        </h2>
      </div>
      <p className="meta">The Storyboard tunes each story to your role. You can change this any time.</p>
      <div className="sb-role-list" role="radiogroup" aria-labelledby="sb-roles-h">
        {ROLE_CHOICES.map((c) => (
          <label key={c.role} className={`sb-role${role === c.role ? ' is-on' : ''}`}>
            <input
              type="radio"
              name="sb-role"
              value={c.role}
              checked={role === c.role}
              onChange={() => {
                setRole(c.role);
                announce(`Storyboards will be tuned for: ${c.label}`);
              }}
            />
            <span className="sb-role-name">{c.label}</span>
            <span className="sb-role-day">{c.day}</span>
            <span className="sb-role-tuned">{c.tuned}</span>
          </label>
        ))}
      </div>
    </section>
  );
}
