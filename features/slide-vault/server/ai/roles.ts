import type { StoryRole, StoryUserRole } from '../../contracts/dto';

/**
 * Who is building the story (docs/DECISIONS.md FD-25). Grant named three groups on 21 Oct, each with
 * a different day: business developers meet and research clients and lead the pursuit; directors lead
 * the proposal's story, capabilities and pricing; BD support and marketing pull slides from the
 * master deck, put them in order and clean them up, under time pressure. The storyboard engine is
 * the same for all three; this table only changes what each part looks for, how many options each
 * part offers, and which questions are worth asking. The BD survey's answers are meant to refine it.
 */

export const USER_ROLES: readonly StoryUserRole[] = ['business-developer', 'director', 'bd-support'];

export type RoleTuning = {
  label: string;
  /** Extra words each part looks for, for what this role is accountable for */
  words: Partial<Record<StoryRole, string[]>>;
  /** Options shown per part: support wants choices to pick from, others a short, strong list */
  slidesPerPart: number;
  /** Questions beyond the shared ones (audience, worry, what a win is), each asked only when the brief doesn't say */
  asks: { ask: string; told: RegExp }[];
  /** Most questions worth asking this role before the story is useful */
  maxQuestions: number;
};

export const ROLE_TUNING: Record<StoryUserRole, RoleTuning> = {
  'business-developer': {
    label: 'Business developer',
    words: {
      'client-challenge': ['objectives', 'needs', 'brief', 'context'],
      insight: ['research', 'trends', 'insight', 'opportunity'],
    },
    slidesPerPart: 3,
    asks: [{ ask: "What do we already know about this client from past work or meetings?", told: /\b(history|relationship|past|previous|again|returning|worked (with|for))\b/i }],
    maxQuestions: 3,
  },
  director: {
    label: 'Director',
    words: {
      'why-us': ['capabilities', 'expertise', 'leadership', 'team'],
      outcome: ['cost', 'fees', 'value', 'savings', 'budget', 'return'],
    },
    slidesPerPart: 3,
    asks: [{ ask: 'What budget or fee range is the client expecting, and who signs off?', told: /\b(budget|fee|fees|price|pricing|cost|sign[- ]?off|approv\w*|decision[- ]maker)\b/i }],
    maxQuestions: 3,
  },
  'bd-support': {
    label: 'BD support / marketing',
    words: {},
    slidesPerPart: 5,
    asks: [],
    maxQuestions: 1,
  },
};

export const DEFAULT_SLIDES_PER_PART = 3;

/** A role from a request, or null when none (or an unknown one) was sent. */
export const roleOf = (raw: unknown): StoryUserRole | null => (USER_ROLES.includes(raw as StoryUserRole) ? (raw as StoryUserRole) : null);
