'use client';


import type { StoryUserRole } from '../contracts/dto';
import { ROLE_CHOICES, useStoryRole } from '../client/role-store';
import { useWorkspace } from './state';
import './storyboard.css';

/**
 * "Your role" in Settings (FD-25, FD-71): the three groups Grant described on 21 Oct, in his words,
 * plus "Not set". The server keeps the choice; it shows beside the name in the account menu and
 * tunes search and every storyboard.
 */
export function StoryRoleSetting() {
  const { profile, announce } = useWorkspace();
  const { role, setRole } = useStoryRole(profile);

  function pick(next: StoryUserRole | null, label: string) {
    setRole(next);
    announce(next ? `Your role: ${label}` : 'Your role is not set');
  }

  return (
    <section className="row" id="role" aria-labelledby="sb-roles-h">
      <div className="row-head">
        <h2 className="h2" id="sb-roles-h">
          Your role
        </h2>
      </div>
      <p className="meta" style={{ marginBottom: 6 }}>
        Tunes your search results and storyboards to how you build proposals. It shows next to your name in the account menu.
      </p>
      <div className="sb-role-list" role="radiogroup" aria-labelledby="sb-roles-h">
        {ROLE_CHOICES.map((c) => (
          <label key={c.role} className={`sb-role${role === c.role ? ' is-on' : ''}`}>
            <input type="radio" name="sb-role" value={c.role} checked={role === c.role} onChange={() => pick(c.role, c.label)} />
            <span className="sb-role-name">{c.label}</span>
            <span className="sb-role-day">{c.day}</span>
          </label>
        ))}
        <label className={`sb-role${role === null ? ' is-on' : ''}`}>
          <input type="radio" name="sb-role" value="" checked={role === null} onChange={() => pick(null, '')} />
          <span className="sb-role-name">Not set</span>
          <span className="sb-role-day">Results and storyboards are not tuned to a role.</span>
        </label>
      </div>
    </section>
  );
}
