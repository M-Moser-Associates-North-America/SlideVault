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
  | 'LIBRARY_NOT_READY'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'DUPLICATE_DECK'
  | 'UPLOAD_FAILED';

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
  /**
   * Deck details read from the folder path (docs/foundry/SLIDE_RECORD.md). Optional and null when
   * unknown, never guessed. Added so the library can group by client, year and category (FD-13).
   */
  clientName?: string | null;
  deckYear?: number | null;
  category?: string | null;
  bestOfTheBest?: boolean;
};

/** The same (or nearly the same) slide also appears in other decks (duplicate grouping, PRD P1). */
export type AlsoIn = {
  /** Stable duplicate-group id */
  groupId: string;
  /** How many other decks have this slide, not counting this card's own deck */
  otherDeckCount: number;
  /** identical = same words; near = nearly the same words (e.g. one number changed) */
  match: 'identical' | 'near';
};

export type SlideSummary = {
  id: string;
  title: string;
  hiddenInSource: boolean;
  /** Path relative to the API root, resolved with runtime.assetUrl() */
  previewPath: string;
  provenance: Provenance;
  /** Set by search when this slide is also in other decks; absent or null otherwise */
  alsoIn?: AlsoIn | null;
};

export type SlideDetail = SlideSummary & { text: string };

/** POST /exports body (docs/DATA_AND_API.md, "Example export request"). */
export type ExportRequest = {
  format: 'pptx';
  fidelityPolicy: 'preserve-source';
  items: { slideId: string; sourceVersionId: string }[];
};

/** POST /uploads form fields (docs/foundry/SLIDE_RECORD.md: deck fields from the folder path). */
export type UploadDeckMeta = {
  clientName: string | null;
  deckYear: number | null;
  category: string | null;
  folderPath: string | null;
  bestOfTheBest: boolean;
};

export type DeckSummary = {
  id: string;
  title: string;
  status: 'queued' | 'processing' | 'ready' | 'failed';
  error: string | null;
  slideCount: number;
};
