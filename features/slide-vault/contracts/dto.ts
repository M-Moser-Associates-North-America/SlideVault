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
  | 'UPLOAD_FAILED'
  /** Too many requests from this caller; retry after the Retry-After header (seconds) */
  | 'RATE_LIMITED'
  /** A per-person request (saved slides, My decks, activity) arrived with no signed-in person */
  | 'SIGNED_OUT'
  /** The database behind per-person data isn't reachable or set up on this server */
  | 'UNAVAILABLE';

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
  /** Real number of times this slide has been downloaded (FD-18); absent when unknown */
  downloads?: number;
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
  /** True when this exact file was already in the library; nothing new was stored (FD-11) */
  alreadyUploaded?: boolean;
  /** What the second copy's folder added to the existing deck, e.g. ["Best of the Best", "year 2024"] */
  addedDetails?: string[];
};

/** GET /library: every ready deck and slide, for screens that browse and filter in the browser (V3 prototype). */
export type LibraryDeck = {
  id: string;
  title: string;
  client: string | null;
  year: number | null;
  category: string | null;
  bestOfTheBest: boolean;
  /** "16:9", "4:3" or null when unknown */
  slideSize: string | null;
  /** Same value as provenance.sourceVersionId, needed to download */
  versionId: string;
  uploadedAt: string | null;
  source: 'upload' | 'fixture';
};

export type LibrarySlide = {
  id: string;
  deckId: string;
  slideNumber: number;
  title: string;
  text: string;
  hiddenInSource: boolean;
  previewPath: string;
  /** Duplicate group id, shared by copies of the same slide in other decks; null when it has none */
  duplicateGroupId: string | null;
};

export type LibraryData = { decks: LibraryDeck[]; slides: LibrarySlide[] };

/** GET /smart-search (docs/DECISIONS.md FD-16, FD-17): results with the reading shown and a reason per slide. */
export type SmartSearchChip = { kind: 'Topic' | 'Client' | 'Year' | 'Category' | 'Collection'; label: string };

export type SmartSearchItem = {
  slide: SlideSummary;
  /** Plain "why it fits" line, built only from what the slide and its deck contain */
  why: string;
  /** The search words found on the slide */
  matched: string[];
};

export type SmartSearchResult = {
  query: string;
  /** model: the configured AI read the request; stand-in: the rules did (a basic search, no AI set up, or it failed) */
  reader: 'model' | 'stand-in';
  /** Set when the AI was tried and failed, so the screen can say results are simpler than usual */
  readerNote: string | null;
  /** How the request was read, as removable chips */
  chips: SmartSearchChip[];
  /** true when the request's filters left nothing, so results are shown without them */
  relaxed: boolean;
  items: SmartSearchItem[];
};

/* ---- Per-person data (docs/DECISIONS.md FD-18) ----------------------------------------------- */

/** A named, ordered set of slides under My decks. savedAt is milliseconds since 1970. */
export type Draft = { id: string; name: string; slideIds: string[]; savedAt: number };

export type ActivityKind = 'viewed' | 'saved' | 'downloaded';

/** One thing a person did, recorded only while they've opted in. at is milliseconds since 1970. */
export type ActivityEntry = { kind: ActivityKind; label: string; at: number; slideId?: string };

/** GET /me/activity: whether tracking is on, and (when it is) the last 90 days, newest first. */
export type ActivityResponse = { optedIn: boolean; retentionDays: number; entries: ActivityEntry[] };
