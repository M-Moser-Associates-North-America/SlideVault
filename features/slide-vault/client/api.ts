/**
 * Typed calls to /api/slide-vault/v1, made only through the host's runtime.request()
 * (docs/INTEGRATION_CONTRACT.md: the host owns transport, authentication and the API root).
 */
import type { ApiError, ApiOk, ApiPage, ExportRequest, SlideDetail, SlideSummary } from '../contracts/dto';
import type { SlideVaultRuntime } from '../contracts/runtime';

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

async function failure(runtime: SlideVaultRuntime, res: Response): Promise<never> {
  if (res.status === 401) runtime.onSessionExpired();
  const body = (await res.json().catch(() => null)) as ApiError | null;
  throw new ApiCallError(body?.error.message ?? `Request failed (${res.status}).`, res.status, body?.error.retryable ?? res.status >= 500);
}

export async function searchSlides(runtime: SlideVaultRuntime, query: string, signal?: AbortSignal): Promise<SlideSummary[]> {
  const params = new URLSearchParams({ kind: 'slide', limit: '100' });
  if (query.trim()) params.set('q', query.trim());
  const res = await runtime.request({ path: `/search?${params}`, method: 'GET', signal });
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiPage<SlideSummary>).data;
}

export async function getSlide(runtime: SlideVaultRuntime, slideId: string, signal?: AbortSignal): Promise<SlideDetail> {
  const res = await runtime.request({ path: `/slides/${encodeURIComponent(slideId)}`, method: 'GET', signal });
  if (!res.ok) return failure(runtime, res);
  return ((await res.json()) as ApiOk<SlideDetail>).data;
}

/** Returns the .pptx as a Blob; the caller decides how to save it. */
export async function exportPptx(runtime: SlideVaultRuntime, slides: SlideSummary[]): Promise<Blob> {
  const body: ExportRequest = {
    format: 'pptx',
    fidelityPolicy: 'preserve-source',
    items: slides.map((s) => ({ slideId: s.id, sourceVersionId: s.provenance.sourceVersionId })),
  };
  const res = await runtime.request({ path: '/exports', method: 'POST', body });
  if (!res.ok) return failure(runtime, res);
  return res.blob();
}
