/**
 * Typed calls to /api/slide-vault/v1, made only through the host's runtime.request()
 * (docs/INTEGRATION_CONTRACT.md: the host owns transport, authentication and the API root).
 */
import type { ApiError, ApiOk, ApiPage, DeckSummary, ExportRequest, FreeTag, SlideComment, SlideVotes, TagRemoval, SectionListing, SectionSlides, SlideDetail, SlideSummary, Session, SmartSearchResult, StoryboardResult, StoryFeedbackVerdict, StoryRefineRequest, StoryRefineResult, StoryRole, StoryUserRole, UploadDeckMeta, UploadPreview } from '../contracts/dto';
import type { SlideVaultRuntime } from '../contracts/runtime';

/** The part of the runtime API calls need. Stable across navigation in a well-behaved host. */
export type Transport = Pick<SlideVaultRuntime, 'request' | 'onSessionExpired'>;

/** A failed call, carrying the server's safe message for display. */
export class ApiCallError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

async function failure(runtime: Transport, res: Response): Promise<never> {
  if (res.status === 401) runtime.onSessionExpired();
  const body = (await res.json().catch(() => null)) as ApiError | null;
  throw new ApiCallError(body?.error.message ?? `Request failed (${res.status}).`, res.status, body?.error.retryable ?? res.status >= 500);
}

/** Search results: one card per group of near-identical slides, marked "also in N decks". */
export async function searchSlides(runtime: Transport, query: string, signal?: AbortSignal): Promise<SlideSummary[]> {
  const params = new URLSearchParams({ kind: 'slide', limit: '100' });
  if (query.trim()) params.set('q', query.trim());
  const res = await runtime.request({ path: `/search?${params}`, method: 'GET', signal });
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiPage<SlideSummary>).data;
}

/**
 * Quick AI search (FD-16, FD-17). `read` is true only when the person submitted the search; while
 * they type, the server reads with rules only, so a long question never calls the AI mid-sentence.
 * `ai: false` is the "Deeper AI search" checkbox unticked: the rules read it even on submit (FD-79).
 */
export async function smartSearch(runtime: Transport, query: string, read: boolean, signal?: AbortSignal, opts: { includeHidden?: boolean; role?: StoryUserRole | null; ai?: boolean; forceAi?: boolean } = {}): Promise<SmartSearchResult> {
  const params = new URLSearchParams({ q: query.trim(), limit: '100' });
  if (opts.includeHidden) params.set('hidden', 'include'); // slides hidden in the original deck (FD-50)
  if (opts.role) params.set('role', opts.role); // how this person builds proposals tunes the results (FD-59)
  if (read) params.set('read', '1');
  if (opts.ai === false) params.set('ai', 'off'); // "Deeper AI search" unticked (FD-79)
  else if (opts.forceAi) params.set('ai', 'always'); // the person chose the AI for a short search too (FD-79)
  const res = await runtime.request({ path: `/smart-search?${params}`, method: 'GET', signal });
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiOk<SmartSearchResult>).data;
}

/** Whether the server has an AI reader, so "Deeper AI search" can be offered before the first search (FD-79). Any failure reads as "not available". */
export async function fetchAiAvailable(runtime: Transport, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await runtime.request({ path: '/session', method: 'GET', signal });
    if (!res.ok) return false;
    return ((await res.json()) as ApiOk<Session>).data.aiAvailable === true;
  } catch {
    return false;
  }
}

const MAX_LIBRARY_PAGES = 30;

/**
 * Every slide in the library, every copy kept (duplicates=all), so decks can be listed in full.
 * Follows the cursor until the server says there are no more pages. Slides can repeat across pages
 * (uploaded decks are returned on every page for now), so they are de-duplicated by id.
 */
/** Slides hidden in their original deck are left out unless includeHidden is set (FD-50). */
export async function listLibrary(runtime: Transport, signal?: AbortSignal, opts: { includeHidden?: boolean; includeArchived?: boolean; onlyArchived?: boolean } = {}): Promise<SlideSummary[]> {
  const byId = new Map<string, SlideSummary>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_LIBRARY_PAGES; page++) {
    const params = new URLSearchParams({ kind: 'slide', limit: '1000', duplicates: 'all' });
    if (opts.includeHidden) params.set('hidden', 'include');
    if (opts.onlyArchived) params.set('archived', 'only'); // only the archived decks, for the Archived decks page
    else if (opts.includeArchived) params.set('archived', 'include'); // archived decks, marked provenance.archived (FD-50)
    if (cursor) params.set('cursor', cursor);
    const res = await runtime.request({ path: `/search?${params}`, method: 'GET', signal });
    if (!res.ok) return failure(runtime, res);
    const body = (await res.json()) as ApiPage<SlideSummary>;
    for (const s of body.data) byId.set(s.id, s);
    cursor = body.page.nextCursor;
    if (!cursor) break;
  }
  return [...byId.values()];
}

export async function getSlide(runtime: Transport, slideId: string, signal?: AbortSignal): Promise<SlideDetail> {
  const res = await runtime.request({ path: `/slides/${encodeURIComponent(slideId)}`, method: 'GET', signal });
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiOk<SlideDetail>).data;
}

/** `note` is the server's explanation when it sent something other than what was asked for (X-SlideVault-Export-Note). */
export type ExportDownload = { blob: Blob; fileName: string; note?: string };

/** File name from Content-Disposition, e.g. attachment; filename="SlideVault-export.zip". */
const downloadName = (res: Response, fallback: string) =>
  /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallback;

/**
 * Returns the export as a Blob plus its file name; the caller decides how to save it.
 * One deck gives a .pptx; slides from several decks give a .zip with one .pptx per deck, or, with
 * `combine`, one .pptx that holds them all (the server falls back to the .zip for mixed slide sizes).
 */
export async function exportPptx(runtime: Transport, slides: SlideSummary[], options: { combine?: boolean } = {}): Promise<ExportDownload> {
  const body: ExportRequest = {
    format: 'pptx',
    fidelityPolicy: 'preserve-source',
    items: slides.map((s) => ({ slideId: s.id, sourceVersionId: s.provenance.sourceVersionId })),
    ...(options.combine ? { combine: true } : {}),
  };
  const res = await runtime.request({ path: '/exports', method: 'POST', body });
  if (!res.ok) return failure(runtime, res);
  const note = res.headers.get('X-SlideVault-Export-Note') ?? undefined;
  return { blob: await res.blob(), fileName: downloadName(res, 'SlideVault-export.pptx'), note };
}

/** POST /uploads (multipart/form-data). Throws ApiCallError on failure, including duplicates (409). */
export async function uploadDeck(runtime: Transport, file: File, meta: UploadDeckMeta, tags: { deckTags?: string[]; slideTags?: Record<number, string[]> } = {}): Promise<DeckSummary> {
  const form = new FormData();
  // Tags chosen on the upload page, saved with the deck (FD-54)
  if (tags.deckTags?.length) form.set('deckTags', JSON.stringify(tags.deckTags));
  if (tags.slideTags && Object.keys(tags.slideTags).length) form.set('slideTags', JSON.stringify(tags.slideTags));
  form.set('file', file);
  if (meta.clientName) form.set('clientName', meta.clientName);
  if (meta.deckYear !== null) form.set('deckYear', String(meta.deckYear));
  if (meta.category) form.set('category', meta.category);
  if (meta.folderPath) form.set('folderPath', meta.folderPath);
  form.set('bestOfTheBest', String(meta.bestOfTheBest));

  const res = await runtime.request({ path: '/uploads', method: 'POST', body: form });
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiOk<DeckSummary>).data;
}

/* ---- Storyboard (FD-22, FD-24) ---------------------------------------------------------------- */

/** A client situation turned into a story of slides. `read` lets the configured AI read it (slower). */
export async function buildStory(runtime: Transport, situation: string, opts: { read: boolean; answers?: string; role?: StoryUserRole | null; mode?: 'retrieve' | 'reimagine' | 'build' }, signal?: AbortSignal): Promise<StoryboardResult> {
  const res = await runtime.request({ path: '/storyboard', method: 'POST', body: { situation, read: opts.read, answers: opts.answers || undefined, role: opts.role ?? undefined, mode: opts.mode }, signal });
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiOk<StoryboardResult>).data;
}

/** "Was this helpful?": saved without a name or the brief, used to rank the next similar storyboard. */
/** One message in a conversation about the story on screen (FD-43): the story continues, Useful slides stay. */
export async function refineStory(runtime: Transport, request: StoryRefineRequest, signal?: AbortSignal): Promise<StoryRefineResult> {
  const res = await runtime.request({ path: '/storyboard/refine', method: 'POST', body: request, signal });
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiOk<StoryRefineResult>).data;
}

/** saved: false when learning from this person's activity is off (FD-37): nothing was stored. */
export async function sendStoryFeedback(runtime: Transport, feedback: { role: StoryRole; slideId: string | null; verdict: StoryFeedbackVerdict; topics: string[]; by?: StoryUserRole | null }): Promise<{ saved: boolean }> {
  const res = await runtime.request({ path: '/storyboard/feedback', method: 'POST', body: feedback });
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiOk<{ saved: boolean }>).data;
}

/** One deck section in full, in deck order, so it can be opened or added whole (FD-80). Null when the server can't say. */
export async function getSection(runtime: Transport, dividerId: string, signal?: AbortSignal): Promise<SectionSlides | null> {
  const res = await runtime.request({ path: `/sections/${encodeURIComponent(dividerId)}`, method: 'GET', signal });
  if (!res.ok) return null;
  return ((await res.json()) as ApiOk<SectionSlides>).data;
}

/** Every deck's section of one standard kind, to browse sections without a search (FD-80). Null when the server can't say. */
export async function listSections(runtime: Transport, kind: string, signal?: AbortSignal): Promise<SectionListing[] | null> {
  const res = await runtime.request({ path: `/sections?kind=${encodeURIComponent(kind)}`, method: 'GET', signal });
  if (!res.ok) return null;
  return ((await res.json()) as ApiOk<SectionListing[]>).data;
}

/** Useful / Not relevant on a search result (FD-59); { saved: false } when the person hasn't turned on learning. */
export async function sendSearchFeedback(runtime: Transport, feedback: { query: string; slideId: string; verdict: 'useful' | 'not-relevant'; by?: StoryUserRole | null; undo?: boolean }): Promise<{ saved: boolean }> {
  const res = await runtime.request({ path: '/smart-search/feedback', method: 'POST', body: feedback });
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiOk<{ saved: boolean }>).data;
}

/** Whether talking instead of typing is set up on this server. */
/** 'on', 'off' (not set up here) or 'down' (set up, but the speech service isn't answering) */
export type SpeechStatus = 'on' | 'off' | 'down';

export async function speechStatus(runtime: Transport): Promise<SpeechStatus> {
  const res = await runtime.request({ path: '/speech', method: 'GET' }).catch(() => null);
  if (!res?.ok) return 'off';
  const data = ((await res.json()) as ApiOk<{ available: boolean; status?: SpeechStatus }>).data;
  return data.status ?? (data.available ? 'on' : 'off');
}

/** A WAV recording -> the words said. */
export async function transcribe(runtime: Transport, wav: Blob, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  form.append('audio', wav, 'speech.wav');
  const res = await runtime.request({ path: '/speech', method: 'POST', body: form, signal });
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiOk<{ text: string }>).data.text;
}

/* ---------------------------------------------------------------- Packs (FD-38) */

/** What the server returns for a pack it stored. */
export type PackResult = { id: string; label: string | null; status: 'suggested' | 'confirmed'; confirmedBy?: string | null; confirmedAt?: string | null; slideIds: string[] };

/**
 * Packs are stored by the server (POST, PATCH and DELETE /packs). Until it has those routes a call
 * answers 404 or 405; these functions then return null so the caller can keep the change in this browser.
 */
const notThere = (res: Response) => res.status === 404 || res.status === 405 || res.status === 501;

export async function createPack(runtime: Transport, body: { slideIds: string[]; label: string | null }): Promise<PackResult | null> {
  const res = await runtime.request({ path: '/packs', method: 'POST', body });
  if (notThere(res)) return null;
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiOk<PackResult>).data;
}

export async function renamePack(runtime: Transport, packId: string, label: string | null): Promise<PackResult | null> {
  const res = await runtime.request({ path: `/packs/${encodeURIComponent(packId)}`, method: 'PATCH', body: { label } });
  if (notThere(res)) return null;
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiOk<PackResult>).data;
}

/** Confirm a suggested pack, or move a confirmed one back to suggested. The server records who and when. */
export async function setPackStatus(runtime: Transport, packId: string, status: 'suggested' | 'confirmed'): Promise<PackResult | null> {
  const res = await runtime.request({ path: `/packs/${encodeURIComponent(packId)}`, method: 'PATCH', body: { status } });
  if (notThere(res)) return null;
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiOk<PackResult>).data;
}

/** Ungroup: the pack goes, its slides stay. Returns false when the server has no such route yet. */
export async function deletePack(runtime: Transport, packId: string): Promise<boolean> {
  const res = await runtime.request({ path: `/packs/${encodeURIComponent(packId)}`, method: 'DELETE' });
  if (notThere(res)) return false;
  if (!res.ok) return failure(runtime, res);
  return true;
}

/* ---------------------------------------------------------------- Archive (FD-50) */

/**
 * Archive or restore a deck: PATCH /decks/:id { archived }. Hidden from the app, search and AI; nothing
 * is deleted. Returns false when the server has no such route yet (404, 405 or 501), so nothing is faked.
 */
export async function archiveDeck(runtime: Transport, deckId: string, archived: boolean): Promise<boolean> {
  const res = await runtime.request({ path: `/decks/${encodeURIComponent(deckId)}`, method: 'PATCH', body: { archived } });
  if (res.status === 404 || res.status === 405 || res.status === 501) return false;
  if (!res.ok) return failure(runtime, res);
  return true;
}

/* ---------------------------------------------------------------- Free tags (FD-53) */

/** Every free-form tag in use, most used first, for the filter list. Empty when the server has none. */
export async function listTags(runtime: Transport, signal?: AbortSignal): Promise<{ tag: string; slides: number; decks: number }[]> {
  const res = await runtime.request({ path: '/tags', method: 'GET', signal });
  if (notThere(res)) return [];
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiOk<{ tag: string; slides: number; decks: number }[]>).data;
}

/** Tag a slide, or a whole deck (then every slide in it shows the tag). Adding one that's already there returns it. */
export async function addTag(runtime: Transport, on: 'slide' | 'deck', id: string, tag: string): Promise<FreeTag | null> {
  const res = await runtime.request({ path: '/tags', method: 'POST', body: { on, id, tag } });
  if (notThere(res)) return null;
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiOk<FreeTag>).data;
}

/** Remove a tag by its id (FreeTag.id). Returns false when the server has no such route yet. */
export async function removeTag(runtime: Transport, tagId: string): Promise<boolean> {
  const res = await runtime.request({ path: `/tags/${encodeURIComponent(tagId)}`, method: 'DELETE' });
  if (notThere(res)) return false;
  if (!res.ok) return failure(runtime, res);
  return true;
}

/* Tag restore and the removal log, and votes and comments on a slide (FD-72). The server routes are asked for, not built yet: each call returns null until they exist. */

/** Bring back a removed tag with its original adder and votes. */
export async function restoreTag(runtime: Transport, tagId: string): Promise<FreeTag | null> {
  const res = await runtime.request({ path: `/tags/${encodeURIComponent(tagId)}/restore`, method: 'POST' });
  if (notThere(res)) return null;
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiOk<FreeTag>).data;
}

/** The tags removed from a slide or deck, newest first, with who removed each. Null when the server has no log yet. */
export async function listRemovedTags(runtime: Transport, on: 'slide' | 'deck', id: string, signal?: AbortSignal): Promise<TagRemoval[] | null> {
  const res = await runtime.request({ path: `/tags/removed?${new URLSearchParams({ on, id })}`, method: 'GET', signal });
  if (notThere(res)) return null;
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiOk<TagRemoval[]>).data;
}

/** Rename a slide for everyone (FD-73). Returns the saved name, or null when the server has no such route yet. */
export async function renameSlide(runtime: Transport, slideId: string, title: string): Promise<string | null> {
  const res = await runtime.request({ path: `/slides/${encodeURIComponent(slideId)}`, method: 'PATCH', body: { title } });
  if (notThere(res)) return null;
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiOk<{ title: string }>).data.title;
}

/** Up (1), down (-1) or clear (0) your vote on a slide. Returns the slide's counts. */
export async function voteSlide(runtime: Transport, slideId: string, value: 1 | -1 | 0): Promise<SlideVotes | null> {
  const res = await runtime.request({ path: `/slides/${encodeURIComponent(slideId)}/vote`, method: 'POST', body: { value } });
  if (notThere(res)) return null;
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiOk<SlideVotes>).data;
}

/** The comments on a slide, oldest first. Null when the server has none yet. */
export async function listComments(runtime: Transport, slideId: string, signal?: AbortSignal): Promise<SlideComment[] | null> {
  const res = await runtime.request({ path: `/slides/${encodeURIComponent(slideId)}/comments`, method: 'GET', signal });
  if (notThere(res)) return null;
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiOk<SlideComment[]>).data;
}

export async function addComment(runtime: Transport, slideId: string, text: string): Promise<SlideComment | null> {
  const res = await runtime.request({ path: `/slides/${encodeURIComponent(slideId)}/comments`, method: 'POST', body: { text } });
  if (notThere(res)) return null;
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiOk<SlideComment>).data;
}

/** Delete a comment (the server only lets the author do it). Returns false when the server has no such route yet. */
export async function deleteComment(runtime: Transport, slideId: string, commentId: string): Promise<boolean> {
  const res = await runtime.request({ path: `/slides/${encodeURIComponent(slideId)}/comments/${encodeURIComponent(commentId)}`, method: 'DELETE' });
  if (notThere(res)) return false;
  if (!res.ok) return failure(runtime, res);
  return true;
}

/** Slides with a given free tag, on the slide or its deck. Search with the library's own params plus tag=. */
export async function slidesWithTag(runtime: Transport, tag: string, signal?: AbortSignal): Promise<SlideSummary[]> {
  const params = new URLSearchParams({ kind: 'slide', limit: '1000', duplicates: 'all', tag });
  const res = await runtime.request({ path: `/search?${params}`, method: 'GET', signal });
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiPage<SlideSummary>).data;
}


/* ---------------------------------------------------------------- Upload preview (FD-54) */

/** The chosen file's slides as pictures, before anything is stored. Null when the server has no such route yet. */
export async function previewUpload(runtime: Transport, file: File, signal?: AbortSignal): Promise<UploadPreview | null> {
  const form = new FormData();
  form.set('file', file);
  const res = await runtime.request({ path: '/uploads/preview', method: 'POST', body: form, signal });
  if (notThere(res)) return null;
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiOk<UploadPreview>).data;
}

/* ---------------------------------------------------------------- Role on the server (FD-71) */

/** The signed-in person's role and activity opt-in. Null when the server has no such route yet. */
export async function getMySettings(runtime: Transport): Promise<{ role: StoryUserRole | null; activityOptedIn: boolean } | null> {
  const res = await runtime.request({ path: '/me/settings', method: 'GET' });
  if (notThere(res)) return null;
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiOk<{ role: StoryUserRole | null; activityOptedIn: boolean }>).data;
}

/** Save the person's role on the server (null clears it). Returns false when the server has no such route yet. */
/**
 * Suggested for you by role (FD-71): slide ids people in the signed-in person's role saved or downloaded
 * most, with how many people, never who. Empty until they pick a role and 3+ people in it used a slide.
 */
export async function getRoleSuggestions(runtime: Transport): Promise<{ role: StoryUserRole | null; minPeople: number; items: { slideId: string; people: number }[] } | null> {
  const res = await runtime.request({ path: '/me/suggested', method: 'GET' });
  if (notThere(res)) return null;
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiOk<{ role: StoryUserRole | null; minPeople: number; items: { slideId: string; people: number }[] }>).data;
}

export async function setMyRole(runtime: Transport, role: StoryUserRole | null): Promise<boolean> {
  const res = await runtime.request({ path: '/me/settings', method: 'PATCH', body: { role } });
  if (notThere(res)) return false;
  if (!res.ok) return failure(runtime, res);
  return true;
}

/** Tags worth adding to a slide, from the slides closest to it in meaning (FD-82). Empty when that isn't set up. */
export type TagSuggestionItem = { tag: string; from: 'people' | 'reading' | 'ai'; score: number };
export async function tagSuggestions(runtime: Transport, slideId: string, signal?: AbortSignal): Promise<TagSuggestionItem[]> {
  const res = await runtime.request({ path: `/slides/${encodeURIComponent(slideId)}/tag-suggestions`, method: 'GET', signal }).catch(() => null);
  if (!res?.ok) return [];
  return ((await res.json()) as ApiOk<{ suggestions: TagSuggestionItem[] }>).data.suggestions;
}

/** Tag suggestions for a file in the upload form, before saving (FD-82): for the deck and per slide number. Empty when not set up or expired. */
export async function previewTagSuggestions(runtime: Transport, token: string, signal?: AbortSignal): Promise<{ deck: TagSuggestionItem[]; slides: Record<string, TagSuggestionItem[]> }> {
  const res = await runtime.request({ path: `/uploads/preview/${encodeURIComponent(token)}/tag-suggestions`, method: 'GET', signal }).catch(() => null);
  if (!res?.ok) return { deck: [], slides: {} };
  return ((await res.json()) as ApiOk<{ deck: TagSuggestionItem[]; slides: Record<string, TagSuggestionItem[]> }>).data;
}

/**
 * Deck details read from the file for the upload form (FD-23): client, year, category and more, each with
 * where it came from. `ai: true` lets the server's AI fill what the rules couldn't, only when the server
 * has one (session aiAvailable) and the person ticked it; otherwise rules only. Null on failure.
 */
type SuggestedFact<T> = { value: T; source: 'folder' | 'file name' | 'file properties' | 'slide text' | 'ai'; evidence: string } | null;
export type UploadDetailSuggestions = {
  suggestions: { client: SuggestedFact<string>; year: SuggestedFact<number>; category: SuggestedFact<string>; bestOfTheBest: SuggestedFact<boolean>; author: SuggestedFact<string>; lastEditedBy: SuggestedFact<string>; office: SuggestedFact<string> };
  reader: 'rules' | 'model';
  readerNote: string | null;
  slideCount: number;
  /** Tags the AI read from the slides (FD-85), present only when asked for (`tags: true`) and when it worked */
  tags?: { deck: TagSuggestionItem[]; slides: Record<string, TagSuggestionItem[]> };
};
export async function suggestUploadDetails(runtime: Transport, file: File, opts: { ai: boolean; tags?: boolean; folderPath?: string | null }, signal?: AbortSignal): Promise<UploadDetailSuggestions | null> {
  const form = new FormData();
  form.set('file', file);
  if (opts.folderPath) form.set('folderPath', opts.folderPath);
  if (opts.ai) form.set('read', 'true');
  if (opts.ai && opts.tags) form.set('tags', 'true');
  const res = await runtime.request({ path: '/uploads/suggest', method: 'POST', body: form, signal });
  if (!res.ok) return null;
  return ((await res.json()) as ApiOk<UploadDetailSuggestions>).data;
}

/** Whether the server can fill upload details with AI (GET /uploads/suggest). False when unsure. */
export async function uploadAiAvailable(runtime: Transport, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await runtime.request({ path: '/uploads/suggest', method: 'GET', signal });
    if (!res.ok) return false;
    return ((await res.json()) as ApiOk<{ aiAvailable: boolean }>).data.aiAvailable === true;
  } catch {
    return false;
  }
}
