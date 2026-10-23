import { ok } from '@/features/slide-vault/server';
import { CONTRACT_VERSION } from '@/features/slide-vault/contracts/runtime';

// GET /session: effective capabilities for the caller.
// Prototype: no sign-in yet (decision FD-01), so the single local user gets the read/export set.
export async function GET() {
  return ok({ contractVersion: CONTRACT_VERSION, capabilities: ['library.read', 'collection.write', 'export.create'] });
}
