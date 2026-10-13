/**
 * Typed calls to /api/slide-vault/v1, made only through the host's runtime.request()
 * (docs/INTEGRATION_CONTRACT.md: the host owns transport, authentication and the API root).
 */
import type { ApiError, ApiOk, ApiPage, ExportRequest, SlideDetail, SlideSummary } from '../contracts/dto';
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

export async function searchSlides(runtime: Transport, query: string, signal?: AbortSignal): Promise<SlideSummary[]> {
  const params = new URLSearchParams({ kind: 'slide', limit: '100' });
  if (query.trim()) params.set('q', query.trim());
  const res = await runtime.request({ path: `/search?${params}`, method: 'GET', signal });
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiPage<SlideSummary>).data;
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
