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
  /** The change clashes with what's stored, e.g. a slide that is already in a pack (FD-52) */
  | 'CONFLICT'
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
  /** true when the server has an AI reader set up, so Home can offer "Deeper AI search" before the first search (FD-79) */
  aiAvailable?: boolean;
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
  /** Where the deck's client is, e.g. "Vancouver" or "Global" (FD-35); null when unknown */
  location?: string | null;
  /** True when the deck is archived (hidden from the app, search and AI, not deleted; FD-50). Only sent when archived decks are asked for. */
  archived?: boolean;
  /** Who archived the deck and when (ISO date); only with archived (FD-52) */
  archivedBy?: string | null;
  archivedAt?: string | null;
  /**
   * Deck details from the file or the SharePoint-style view (FD-33). Real values only; null or absent
   * when the server does not know them. The filters and the Details panels show them only when they exist.
   */
  createdBy?: string | null;
  uploadedBy?: string | null;
  /** ISO dates */
  createdAt?: string | null;
  uploadedAt?: string | null;
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

/**
 * Slides that only work together, shown and added as a set ("pack"). Set by the server on every slide in
 * the pack; absent or null when the slide is in none. A slide is in at most one pack. All slides of a
 * pack are from the same deck.
 */
export type PackRef = {
  id: string;
  label: string | null;
  /** suggested = found by the system, not yet confirmed by a person */
  status: 'suggested' | 'confirmed';
  /** Who confirmed it and when (ISO date); null or absent while it is only suggested */
  confirmedBy?: string | null;
  confirmedAt?: string | null;
  /** The pack's slide ids, in the order they belong in (the same list on every member) */
  slideIds: string[];
};

/**
 * What a slide does in a proposal (FD-51, FD-53): from the team's reviewed metadata ("confirmed") or
 * the AI's reading alone ("suggested", Alina's rule: AI labels stay suggestions until a person
 * confirms). Absent when nothing is known about the slide.
 */
export type SlideStory = {
  /** client challenge, insight, approach, proof, why us, outcome, intro, admin or divider */
  role: string | null;
  /** e.g. cover, team_resume, case_study_detail */
  type: string | null;
  /** reusable, reusable - check currency, client-specific - reference only, or internal - never show */
  reuse: string | null;
  themes: string[];
  /** Sectors a case study proves experience in */
  sectors: string[];
  /** Projects a case study shows */
  projects: string[];
  /** e.g. names another client / leftover placeholder */
  flags: string[];
  /** One line each: what the slide shows, and what it convinces the client of */
  shows: string | null;
  convinces: string | null;
  status: 'suggested' | 'confirmed';
  /** The AI wasn't sure of its own reading (only for suggested) */
  uncertain: boolean;
};

/** A free-form tag a person added to a slide or to its deck (Alina, 21 Oct; FD-53). */
export type FreeTag = {
  id: string;
  tag: string;
  /** Added to this slide, or to the whole deck it comes from */
  on: 'slide' | 'deck';
  addedBy: string;
  addedAt: string;
};

/** Who last set a slide's title (FD-73): a person, the AI, or the system (read automatically from the slide's text). Absent = the system. */
export type TitleEdit = { kind: 'person' | 'ai' | 'system'; by?: string; at?: string };

/** Reddit-style vote on a whole slide (FD-72): people who said up and down, and what the signed-in person said. Absent until the server counts votes. */
export type SlideVotes = { up: number; down: number; myVote: 1 | -1 | 0 };

/** A comment on a slide (FD-72). Plain text, never markup. */
export type SlideComment = { id: string; text: string; author: string; at: string };

/** A tag someone removed (FD-72), kept so the slide page can say who removed it and let anyone restore it. */
export type TagRemoval = { id: string; tag: string; on: 'slide' | 'deck'; addedBy: string; removedBy: string; removedAt: string };

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
  /** The pack this slide belongs to, if any (FD-38) */
  pack?: PackRef | null;
  /** What the slide does in a proposal, when known (FD-53) */
  story?: SlideStory | null;
  /** Free-form tags on this slide or its deck, when any (FD-53) */
  tags?: FreeTag[];
  /** Up and down votes on the slide and how many comments it has (FD-72); absent until the server has them */
  votes?: SlideVotes;
  commentCount?: number;
  /** Who last set the title, and when (FD-73); absent until the server keeps that */
  titleEdit?: TitleEdit;
  /** The deck section the slide sits in (FD-57, "page breakers"), set by search when known; divider is its cover */
  section?: { name: string; kind: string; divider: boolean; dividerId: string } | null;
};

export type SlideDetail = SlideSummary & { text: string };

/** POST /exports body (docs/DATA_AND_API.md, "Example export request"). */
export type ExportRequest = {
  format: 'pptx';
  fidelityPolicy: 'preserve-source';
  items: { slideId: string; sourceVersionId: string }[];
  /**
   * Slides from several decks: true puts them all in ONE .pptx, in the selected order, each slide
   * keeping its own deck's design (FD-21). Absent or false keeps the .zip of one file per deck (FD-09).
   * If the decks have different slide sizes, the server sends the .zip anyway and says why in the
   * X-SlideVault-Export-Note response header.
   */
  combine?: boolean;
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
  /** How many free-form tags sent with the upload were saved (FD-54) */
  tagsAdded?: number;
};

/**
 * POST /uploads/preview (FD-54): a chosen .pptx's slides as pictures, before anything is stored.
 * Each previewPath is relative to the API root (runtime.assetUrl), served for about two hours.
 */
export type UploadPreview = {
  /** The file's fingerprint; the pictures are kept under it */
  token: string;
  fileName: string;
  slideCount: number;
  /** Set when this exact file is already in the library: the deck's title */
  alreadyUploadedAs: string | null;
  slides: { number: number; title: string; hiddenInSource: boolean; previewPath: string }[];
};

/** GET /library: every ready deck and slide, for screens that browse and filter in the browser (V3 prototype). */
export type LibraryDeck = {
  id: string;
  title: string;
  client: string | null;
  year: number | null;
  category: string | null;
  bestOfTheBest: boolean;
  /** Where the deck's client is (FD-35); null when unknown */
  location?: string | null;
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
export type SmartSearchChip = { kind: 'Topic' | 'Label' | 'Client' | 'Year' | 'Category' | 'Collection' | 'Mentions'; label: string };

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
  /** true when the server has an AI reader set up, so the screen can offer "Deeper AI search" (FD-79) */
  aiAvailable?: boolean;
  /** 'short' when the AI was asked for but the search was too short for it (about four words or fewer and not a question): the rules read it; the screen asks whether to use the AI anyway, which re-sends the search with ai=always (FD-79) */
  aiSkipped?: 'short';
  /** How the request was read, as removable chips */
  chips: SmartSearchChip[];
  /** true when the request's filters left nothing, so results are shown without them */
  relaxed: boolean;
  /** Set when the search is only a deck section ("case studies", "resumes"): the standard sections it asks for (FD-80) */
  sections?: string[];
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

/* ---- Storyboard (docs/DECISIONS.md FD-22) --------------------------------------------------- */

export type StoryRole = 'client-challenge' | 'insight' | 'strategy' | 'experience' | 'why-us' | 'outcome';

/** Who is building the story (FD-25): Grant's three groups, set once in the profile */
export type StoryUserRole = 'business-developer' | 'director' | 'bd-support';

/** A slide placed in one part of the story, with why it supports that part */
export type StoryboardSlide = {
  slide: SlideSummary;
  why: string;
  matched: string[];
  /** The working behind `why`: the brief's words on the slide, what on it does this part's job, and its deck's details */
  reasons: { brief: string[]; part: string[]; from: string[] };
  /** What colleagues said about this slide in this part, for similar briefs (FD-24); absent when no one has yet */
  learned?: { useful: number; notRight: number };
  /** Which of the brief's needs the slide speaks to, e.g. "healthcare", "staff wellbeing" (FD-29) */
  needs?: string[];
};

/**
 * One beat of the story as the client will hear it (FD-30): a lead slide shown large, the other
 * slides behind it (shown on click), a title in the client's terms and what to say. The parts of the
 * story (challenge, approach, proof...) only decide the order; they are never shown.
 */
export type StoryBeat = {
  /** The part of the story this beat serves: never shown, kept so feedback teaches the right part */
  role: StoryRole;
  title: string;
  /** What to say to the client over this slide, in one short paragraph */
  narration: string;
  /** How this beat follows from the one before (for the first: why the story starts here), so the slides read as one story */
  bridge: string;
  /** Why this slide is here, for the person building the deck */
  why: string;
  /** What in the brief this beat answers, e.g. "healthcare", "reuse" */
  matches: string[];
  lead: StoryboardSlide;
  more: StoryboardSlide[];
  /**
   * Retelling a deck (FD-32): "required" marks a section of pages the proposal needs that isn't
   * story (résumés, fees, schedule, legal...), kept where the deck had it; "suggested" marks slides
   * from other decks offered for a part the deck never had, placed where that part belongs.
   */
  kind?: 'required' | 'suggested';
};

/** "Was this helpful?" on a storyboard: a slide is useful or not right for its part, or nothing in a part fits */
export type StoryFeedbackVerdict = 'useful' | 'not-right' | 'nothing-fits';

export type StoryboardSection = {
  role: StoryRole;
  /** The standard name for this part of the story, e.g. "Proof we've done this" */
  label: string;
  /** A heading in the client's terms */
  title: string;
  /** What this part must convince the client of */
  need: string;
  items: StoryboardSlide[];
  /** true when no slide in the library proves this part yet: a new slide is needed */
  gap: boolean;
};

/** POST /storyboard: a client situation turned into a story of slides, in order */
/**
 * POST /storyboard/refine (FD-43): one message in a conversation about the story on screen. The story
 * is sent as its slide ids only (the server reads every slide itself); Useful slides always stay.
 */
export type StoryRefineRequest = {
  situation: string;
  message: string;
  /** The story on screen, beat by beat: the slide ids (lead first) and the words shown */
  beats: { role: StoryRole; kind?: 'required' | 'suggested'; title: string; bridge: string; narration: string; why: string; matches: string[]; slideIds: string[] }[];
  /** Slides the person marked Useful: never removed */
  pinned: string[];
  role?: StoryUserRole | null;
};
/** The story after the message: either the same story changed (beats), or rebuilt with the message as more context (story) */
export type StoryRefineResult = { reply: string; beats?: StoryBeat[]; story?: StoryboardResult };

export type StoryboardResult = {
  /** model: the AI read the situation; rules: the standard story order was used */
  reader: 'model' | 'rules';
  readerNote: string | null;
  summary: string;
  /** What the storyboard doesn't know yet; answer them and send again for a sharper story */
  questions: string[];
  sections: StoryboardSection[];
  /** The brief's topic words, sent back with any feedback so it can help similar briefs (never the brief itself) */
  topics: string[];
  /** The role the story was tuned for, or null for the standard tuning (FD-25) */
  role: StoryUserRole | null;
  /** The story's name in the client's terms, e.g. "Three campuses, one hospital" (FD-30) */
  title: string;
  /** The story in one line: what the whole deck has to convince the client of. Every beat serves it. */
  thesis: string;
  /** The story's last words: what the client gets, in their terms (empty when nothing can be said honestly) */
  close: string;
  /** The story told slide by slide, in order (FD-30) */
  beats: StoryBeat[];
  /** model: the AI chose, ordered and narrated the slides; rules: the ranked slides in story order */
  composer: 'model' | 'rules';
  /** How many slides were weighed for this story */
  considered: number;
  /**
   * What the request asked for (FD-31): "build" a new story from the whole library, "retrieve" an
   * existing deck as it was saved (no beats: open `deck`), or "reimagine" an existing deck as a
   * better story, using every one of its slides.
   */
  mode: 'build' | 'retrieve' | 'reimagine';
  /** The existing deck the request named, for retrieve and reimagine */
  deck?: { id: string; title: string; slideCount: number };
  /** Retrieve asked for a deck the library doesn't have (FD-34): the name or years asked for, said honestly */
  missing?: { name: string | null; years: number[] };
  /** Build: the family of slides that belong together the story was told from, when one clearly answered the request (FD-42) */
  family?: { title: string; slides: number };
  /** Build: the decks we already made for clients the brief names, used for the parts about them */
  context?: { id: string; title: string }[];
};

/** One deck section in full, in deck order: GET /sections/:dividerId (FD-80). */
export type SectionSlides = { name: string; kind: string; slides: SlideSummary[] };

/** One deck's section in a listing: GET /sections?kind= (FD-80). slideCount can include slides the section route leaves out (hidden or internal). */
export type SectionListing = { dividerId: string; name: string; kind: string; slideCount: number; cover: SlideSummary };
