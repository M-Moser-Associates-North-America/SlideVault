import 'server-only';
import { randomUUID } from 'node:crypto';
import type { ApiErrorCode } from '../contracts/dto';

/**
 * Response helpers for /api/slide-vault/v1 (docs/DATA_AND_API.md, "HTTP conventions"):
 * { data, requestId } on success, { error: { code, message, retryable }, requestId } on failure,
 * private and uncached by default.
 */

const baseHeaders = (requestId: string): HeadersInit => ({
  'Cache-Control': 'private, no-store',
  'X-Request-Id': requestId,
});

export function ok<T>(data: T, extra?: Record<string, unknown>) {
  const requestId = randomUUID();
  return Response.json({ data, ...extra, requestId }, { headers: baseHeaders(requestId) });
}

export function fail(status: number, code: ApiErrorCode, message: string, retryable = false, headers?: Record<string, string>) {
  const requestId = randomUUID();
  return Response.json({ error: { code, message, retryable }, requestId }, { status, headers: { ...baseHeaders(requestId), ...headers } });
}

export function file(bytes: Uint8Array, contentType: string, downloadName?: string) {
  const requestId = randomUUID();
  const headers: Record<string, string> = { ...(baseHeaders(requestId) as Record<string, string>), 'Content-Type': contentType };
  if (downloadName) headers['Content-Disposition'] = `attachment; filename="${downloadName}"`;
  return new Response(Buffer.from(bytes), { headers });
}

/** A domain error the route layer maps to an HTTP response. */
export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const toResponse = (e: ServiceError) => fail(e.status, e.code, e.message);
