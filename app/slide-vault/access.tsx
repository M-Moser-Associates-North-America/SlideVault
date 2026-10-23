'use client';

import { createContext, useContext, useId, useRef, useState, type ReactNode } from 'react';
import { useTheme } from './theme';
import styles from './shell.module.css';

/**
 * Stand-in for sign-in. Login and access keys belong to M Moser's system (docs/INTEGRATION_CONTRACT.md),
 * so the shell owns this switch and turns it into the capabilities the workspace receives.
 * For now it only decides whether Upload is allowed; the approval tiers (Suggested, Approved,
 * Retired) are not connected to real data yet.
 */
export type Access = 'viewer' | 'editor' | 'curator';
const OPTIONS: { value: Access; label: string }[] = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'editor', label: 'Editor' },
  { value: 'curator', label: 'Curator' },
];

const Ctx = createContext<{ access: Access; setAccess: (a: Access) => void }>({
  access: 'editor',
  setAccess: () => {},
});
export const useAccess = () => useContext(Ctx);

export function AccessProvider({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<Access>('editor');
  return <Ctx.Provider value={{ access, setAccess }}>{children}</Ctx.Provider>;
}

export function AccessSwitch() {
  const { access, setAccess } = useAccess();
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();

  const show = () => {
    setOpen(true);
    ref.current?.showModal();
  };
  const close = () => {
    ref.current?.close();
    setOpen(false);
  };

  return (
    <>
      <div className={styles.access}>
        <label htmlFor={`${id}-role`} className={styles.accessLabel}>
          Access
        </label>
        <select id={`${id}-role`} className={styles.accessSelect} value={access} onChange={(e) => setAccess(e.target.value as Access)}>
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="button" className={styles.accessInfo} aria-label="What each access tier can see" title="What each tier can see" onClick={show}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        </button>
      </div>
      <dialog
        ref={ref}
        className="slidevault sv-dialog"
        data-theme={theme}
        aria-labelledby={`${id}-t`}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === e.currentTarget && close()}
      >
        {open && (
          <>
            <div className="dlg-head">
              <div>
                <h2 id={`${id}-t`}>What each tier can see</h2>
                <p className="meta">Assumed for now. To confirm with M Moser.</p>
              </div>
              <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Close" onClick={close}>
                ✕
              </button>
            </div>
            <div className="dlg-body">
              <table className="tier-table">
                <thead>
                  <tr>
                    <th>Access</th>
                    <th>Sees</th>
                    <th>Can do</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <strong>Viewer</strong>
                    </td>
                    <td>Approved slides</td>
                    <td>Search, preview, download</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Editor</strong>
                    </td>
                    <td>Approved and Suggested</td>
                    <td>Also upload decks</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Curator</strong>
                    </td>
                    <td>Approved, Suggested and Retired</td>
                    <td>Also approve labels and retire slides</td>
                  </tr>
                </tbody>
              </table>
              <p className="meta" style={{ marginTop: 12 }}>
                Login and access keys come from M Moser&apos;s system. This switch stands in for them. In this version it only controls Upload; the approval tiers are not connected
                to the real slides yet.
              </p>
            </div>
            <div className="dlg-foot">
              <button type="button" className="btn" onClick={close}>
                Close
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
