/**
 * Data shapes exchanged over /api/slide-vault/v1 (docs/DATA_AND_API.md, "HTTP conventions").
 * JSON is camelCase; IDs are opaque strings; responses never include storage paths.
 */

/** Success envelope: { data, requestId }; lists add page.nextCursor. */
export type ApiOk<T> = { data: T; requestId: string };
export type ApiPage<T> = ApiOk<T[]> & { page: { nextCursor: string | null } };

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'INVALID_SELECTION'
  | 'UNSUPPORTED_SELECTION'
  | 'EXPORT_FAILED'
  | 'LIBRARY_NOT_READY';

/** Error envelope: { error: { code, message, retryable }, requestId } */
export type ApiError = {
  error: { code: ApiErrorCode; message: string; retryable: boolean };
  requestId: string;
};

export type Session = {
  contractVersion: string;
  capabilities: string[];
};

/** Provenance every slide carries (docs/PRODUCT_BRIEF.md, PR-03). Unknown values stay null. */
export type Provenance = {
  sourceId: string;
  sourceVersionId: string;
  sourceTitle: string;
  sourceFileName: string;
  /** 1-based position in the source deck version */
  slideNumber: number;
  owner: string | null;
  approvalStatus: 'approved' | 'in_review' | 'draft' | null;
  reviewedAt: string | null;
};

export type SlideSummary = {
  id: string;
  title: string;
  hiddenInSource: boolean;
  /** Path relative to the API root, resolved with runtime.assetUrl() */
  previewPath: string;
  provenance: Provenance;
};

export type SlideDetail = SlideSummary & { text: string };

/** POST /exports body (docs/DATA_AND_API.md, "Example export request"). */
export type ExportRequest = {
  format: 'pptx';
  fidelityPolicy: 'preserve-source';
  items: { slideId: string; sourceVersionId: string }[];
};
