'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

/**
 * Stand-in for sign-in. Login and access keys belong to M Moser's system (docs/INTEGRATION_CONTRACT.md),
 * so the shell owns this setting and turns it into the capabilities the workspace receives.
 * For now it only decides whether Upload is allowed; the approval tiers (Suggested, Approved,
 * Retired) are not connected to real data yet.
 */
export type Access = 'viewer' | 'editor' | 'curator';

const Ctx = createContext<{ access: Access; setAccess: (a: Access) => void }>({
  access: 'editor',
  setAccess: () => {},
});
export const useAccess = () => useContext(Ctx);

export function AccessProvider({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<Access>('editor');
  return <Ctx.Provider value={{ access, setAccess }}>{children}</Ctx.Provider>;
}
