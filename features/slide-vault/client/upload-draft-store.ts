import { useSyncExternalStore } from 'react';

/**
 * Whether the Upload screen holds work that would be lost (a chosen file, details, tags) and, when
 * someone tries to sign out with it, the question "leave it behind?". A tiny shared store so the
 * app shell's Sign out button (outside the workspace) and the Upload screen can talk to each other.
 * Holds a short label only, never the file or its text. Nothing here is saved anywhere.
 */
export type UploadDraft = { label: string; uploading: boolean };

let draft: UploadDraft | null = null;
let pending: (() => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setUploadDraft(next: UploadDraft | null) {
  if (draft === next || (draft && next && draft.label === next.label && draft.uploading === next.uploading)) return;
  draft = next;
  if (!next) pending = null;
  emit();
}

export const hasUploadDraft = () => draft !== null;

/** Run `leave` now when nothing would be lost; otherwise ask first (the workspace shows the question). */
export function askBeforeLeavingUpload(leave: () => void) {
  if (!draft) {
    leave();
    return;
  }
  pending = leave;
  emit();
}

export function answerLeaveUpload(leave: boolean) {
  const run = pending;
  pending = null;
  emit();
  if (leave) run?.();
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

/** What the leave question needs: the draft and whether it is being asked right now. */
export function useLeaveUploadQuestion(): { draft: UploadDraft | null; asking: boolean } {
  const d = useSyncExternalStore(subscribe, () => draft, () => null);
  const asking = useSyncExternalStore(subscribe, () => pending !== null, () => false);
  return { draft: d, asking };
}
