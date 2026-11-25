/**
 * "Save my changes first" / "Save my draft deck first" (opening a saved draft while the draft deck has unsaved work) hands the saving to the draft deck's own Save as draft box.
 * It asks for it here, with what to do once the draft is saved; the draft deck opens, shows its box, and calls `after` only when the person saved.
 * Closing the box (outside click, Escape, Cancel) drops the request and nothing else happens. Kept in memory only.
 */
/** `updated`: the save replaced the saved deck the draft deck came from (so it now holds these slides), rather than saving a new one. */
export type Saved = { id: string | null; name: string; updated: boolean };
export type AfterSave = (saved: Saved) => void;

const handlers = new Set<(after: AfterSave) => void>();

export function requestDraftSave(after: AfterSave): void {
  handlers.forEach((h) => h(after));
}

/** The draft deck listens for requests (one listener at a time is enough). Returns the way to stop listening. */
export function onDraftSaveRequest(handler: (after: AfterSave) => void): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}
