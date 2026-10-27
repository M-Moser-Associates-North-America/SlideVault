'use client';

import { useState } from 'react';
import { ROLE_CHOICES, useStoryRole } from '../client/role-store';
import { useWorkspace } from './state';
import './storyboard.css';

/**
 * "Your role" at the top of My decks (FD-25): one line showing the role every storyboard is tuned
 * for, opening to the three choices only when someone wants to change it. The three are the groups
 * Grant described on 21 Oct, in his words. The Storyboard has the same setting inline.
 */
export function StoryRoleSetting() {
  const { profile, announce } = useWorkspace();
  const { role, setRole } = useStoryRole(profile);
  const [open, setOpen] = useState(false);
  const current = ROLE_CHOICES.find((c) => c.role === role);
  return (
    <section className="sb-roles" aria-labelledby="sb-roles-h">
      <p className="sb-roles-line">
        <span id="sb-roles-h" className="sb-label">
          Your role
        </span>
        <b>{current ? current.label : 'Not set'}</b>
        <span className="muted">{current ? current.tuned : 'Set it and every storyboard is tuned to how you build proposals.'}</span>
        <button type="button" className="btn-link" aria-expanded={open} aria-controls="sb-role-list" onClick={() => setOpen((o) => !o)}>
          {open ? 'Done' : current ? 'Change' : 'Set it'}
        </button>
      </p>
      {open && (
        <div className="sb-role-list" id="sb-role-list" role="radiogroup" aria-labelledby="sb-roles-h">
          {ROLE_CHOICES.map((c) => (
            <label key={c.role} className={`sb-role${role === c.role ? ' is-on' : ''}`}>
              <input
                type="radio"
                name="sb-role"
                value={c.role}
                checked={role === c.role}
                onChange={() => {
                  setRole(c.role);
                  setOpen(false);
                  announce(`Your role: ${c.label}`);
                }}
              />
              <span className="sb-role-name">{c.label}</span>
              <span className="sb-role-day">{c.day}</span>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
