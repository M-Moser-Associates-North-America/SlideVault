/**
 * Typed calls to /api/slide-vault/v1, made only through the host's runtime.request()
 * (docs/INTEGRATION_CONTRACT.md: the host owns transport, authentication and the API root).
 */
import type { ApiError, ApiOk, ApiPage, DeckSummary, ExportRequest, SlideDetail, SlideSummary, UploadDeckMeta } from '../contracts/dto';
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

const MAX_LIBRARY_PAGES = 30;

/**
 * Every slide in the library, every copy kept (duplicates=all), so decks can be listed in full.
 * Follows the cursor until the server says there are no more pages. Slides can repeat across pages
 * (uploaded decks are returned on every page for now), so they are de-duplicated by id.
 */
export async function listLibrary(runtime: Transport, signal?: AbortSignal): Promise<SlideSummary[]> {
  const byId = new Map<string, SlideSummary>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_LIBRARY_PAGES; page++) {
    const params = new URLSearchParams({ kind: 'slide', limit: '1000', duplicates: 'all' });
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

export type ExportDownload = { blob: Blob; fileName: string };

/** File name from Content-Disposition, e.g. attachment; filename="SlideVault-export.zip". */
const downloadName = (res: Response, fallback: string) =>
  /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallback;

/**
 * Returns the export as a Blob plus its file name; the caller decides how to save it.
 * One deck gives a .pptx; slides from several decks give a .zip with one .pptx per deck.
 */
export async function exportPptx(runtime: Transport, slides: SlideSummary[]): Promise<ExportDownload> {
  const body: ExportRequest = {
    format: 'pptx',
    fidelityPolicy: 'preserve-source',
    items: slides.map((s) => ({ slideId: s.id, sourceVersionId: s.provenance.sourceVersionId })),
  };
  const res = await runtime.request({ path: '/exports', method: 'POST', body });
  if (!res.ok) return failure(runtime, res);
  return { blob: await res.blob(), fileName: downloadName(res, 'SlideVault-export.pptx') };
}

/** POST /uploads (multipart/form-data). Throws ApiCallError on failure, including duplicates (409). */
export async function uploadDeck(runtime: Transport, file: File, meta: UploadDeckMeta): Promise<DeckSummary> {
  const form = new FormData();
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
