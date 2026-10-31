import type { StoryBeat, StoryboardSlide, StoryRole } from '../../contracts/dto';
import { STORY_ROLES } from '../ai/storyboard';
import { firstSentence, joined, ROLE_TITLE, rulesBridge } from './story-beats';

/**
 * Talking to a storyboard (docs/DECISIONS.md FD-43): each message continues the story on screen
 * instead of starting over. Slides the person marked Useful always stay. The message is read for
 * what to do (rules only, so it works without the AI):
 *
 * - find:   "look for X", "find X", "add X", "what about X", "more on X" (several things: "X, Y and Z")
 * - like:   "more like these", "similar slides"  -> slides from the same family, or of the same kind
 * - remove: "drop X", "remove X", "take out X", "without X"
 * - keep:   "only keep the useful ones"
 * - length: "shorter", "tighten" / "longer", "more slides"
 *
 * Anything else is more context for the client: the caller rebuilds the story with it, keeping the
 * Useful slides. Every turn answers in one or two plain sentences saying what it did.
 */

export type Turn = { find: string[]; remove: string[]; like: boolean; keepOnly: boolean; shorter: boolean; longer: boolean };

const FIND = /\b(?:look(?:ing)? for|find|search for|add|include|pull(?: in)?|bring in|what about|how about|more (?:on|about)|i (?:also )?(?:need|want))\s+(.+)/i;
const REMOVE = /\b(?:remove|drop|take out|get rid of|delete|lose|without|no more)\s+(.+)/i;
const FILLER = /^(?:me|us|some|a|an|the|any|more|other|slides?|ones?|pages?|for|of|on|about|that|which|show|shows|showing)\b\s*/i;

/** "this, that and the third" -> three things to look for */
function phrases(text: string): string[] {
  return text
    .replace(/[.?!]+(\s|$)[\s\S]*$/, '')
    .split(/\s*(?:,|;|\band also\b|\bas well as\b|\band\b|&|\bplus\b)\s*/i)
    .map((p) => {
      // Each part can bring its own verb: "drop the fees and take out résumés".
      let t = p.trim().replace(/^(?:remove|drop|take out|get rid of|delete|lose|look for|find|search for|add|include|pull in|bring in)\s+/i, '');
      for (let i = 0; i < 4; i++) t = t.replace(FILLER, '');
      return t.replace(/\s*\b(?:slides?|ones?|pages?|too|as well|please)\b\s*$/i, '').trim();
    })
    // A request about length or keeping is a command, not something to look for ("I want it shorter").
    .filter((p) => p.length >= 3 && !/^(it|this|the story)?\s*(shorter|longer|tighter|fewer|more slides|only|just)\b/i.test(p))
    .slice(0, 4);
}

export function readTurn(message: string): Turn {
  const m = message.trim();
  const sentences = m.split(/(?<=[.?!])\s+/);
  const find = sentences.flatMap((s) => (REMOVE.test(s) ? [] : phrases(FIND.exec(s)?.[1] ?? '')));
  const remove = sentences.flatMap((s) => phrases(REMOVE.exec(s)?.[1] ?? ''));
  return {
    find: [...new Set(find)],
    remove: [...new Set(remove)],
    like: /\b(more (like|of) (these|this|those|that)|similar (slides|ones)|ones? like (these|this|those))\b/i.test(m),
    keepOnly: /\b(only|just) (keep|use)\b|\bkeep only\b|\bonly the (useful|helpful) ones\b/i.test(m),
    shorter: /\b(shorter|fewer slides|trim|tighten|cut it down|too long)\b/i.test(m),
    longer: /\b(longer|more slides|expand|too short)\b/i.test(m),
  };
}

export const understood = (t: Turn) => t.find.length > 0 || t.remove.length > 0 || t.like || t.keepOnly || t.shorter || t.longer;

export type RefineDeps = {
  /** The best slides for a phrase, best first (home search's ranking, FD-33) */
  find: (phrase: string, limit: number) => Promise<StoryboardSlide[]>;
  /** What is known about a slide: its part of the story and what was read on it */
  known: (slideId: string) => { role?: string; about?: string; type?: string } | undefined;
  /** Other slides of the same family (FD-42), in order */
  familyMates?: (slideId: string) => Promise<StoryboardSlide[]>;
  /** May this slide go in a story at all (not hidden, not from an archived deck, not never-show) */
  tellable: (slide: StoryboardSlide) => boolean;
};

const PER_PHRASE = 2;
const LIKE_LIMIT = 4;
const roleOf = (role: string | undefined): StoryRole => (STORY_ROLES.includes(role as StoryRole) ? (role as StoryRole) : 'why-us');
// Accents folded first ("résumés" -> "resumes"), so a word is never split into pieces like "sum".
const plain = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
// A plural asks for the same thing: "résumés" also takes out a slide titled "Résumé".
const words = (s: string) => plain(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3).map((w) => (w.length > 4 ? w.replace(/s$/, '') : w));

/** Continue a story from one message. Returns the new beats and what was done, in plain words. */
export async function refineStory(beats: StoryBeat[], message: string, pinned: Set<string>, deps: RefineDeps): Promise<{ beats: StoryBeat[]; reply: string; understood: boolean }> {
  const turn = readTurn(message);
  let out = beats.map((b) => ({ ...b, more: [...b.more] }));
  const said: string[] = [];
  const inStory = () => new Set(out.flatMap((b) => [b.lead, ...b.more].map((i) => i.slide.id)));
  const keptCount = out.flatMap((b) => [b.lead, ...b.more]).filter((i) => pinned.has(i.slide.id)).length;
  if (keptCount) said.push(`Kept your ${keptCount} useful slide${keptCount === 1 ? '' : 's'}.`);

  // Remove first, so what's found next can take its place. Useful slides are never removed.
  if (turn.keepOnly) {
    out = out
      .map((b) => {
        const items = [b.lead, ...b.more].filter((i) => pinned.has(i.slide.id));
        return items.length ? { ...b, lead: items[0], more: items.slice(1) } : null;
      })
      .filter((b): b is StoryBeat => !!b);
    said.push(pinned.size ? 'Trimmed the story to the slides you marked useful.' : 'Nothing is marked useful yet, so I kept the story as it is.');
    if (!pinned.size) out = beats.map((b) => ({ ...b, more: [...b.more] }));
  }
  for (const phrase of turn.remove) {
    const w = words(phrase);
    let n = 0;
    out = out
      .map((b) => {
        const items = [b.lead, ...b.more].filter((i) => {
          const hay = plain(`${i.slide.title} ${deps.known(i.slide.id)?.about ?? ''} ${b.title}`);
          const hit = !pinned.has(i.slide.id) && w.length > 0 && w.every((x) => hay.includes(x));
          if (hit) n++;
          return !hit;
        });
        return items.length ? { ...b, lead: items[0], more: items.slice(1) } : null;
      })
      .filter((b): b is StoryBeat => !!b);
    said.push(n ? `Took out ${n} slide${n === 1 ? '' : 's'} about ${phrase}.` : `Nothing in the story was about ${phrase}, so nothing was taken out.`);
  }
  if (turn.shorter) {
    out = out.map((b) => ({ ...b, more: b.more.filter((i) => pinned.has(i.slide.id)) }));
    said.push('Tightened it to one slide per moment, plus your useful ones.');
  }

  // Put a found slide where its part of the story is, after what's already there.
  const place = (item: StoryboardSlide, why: string) => {
    const role = roleOf(deps.known(item.slide.id)?.role);
    const home = [...out].reverse().find((b) => b.role === role && !b.kind);
    if (home) {
      home.more.push(item);
      return;
    }
    const at = STORY_ROLES.indexOf(role);
    const before = out.findIndex((b) => STORY_ROLES.indexOf(b.role) > at);
    const i = before >= 0 ? before : out.length;
    const about = deps.known(item.slide.id)?.about;
    out.splice(i, 0, { role, title: ROLE_TITLE[role], bridge: rulesBridge(i ? out[i - 1].role : null, role, []), narration: about ? firstSentence(about) : '', why, matches: [], lead: item, more: [] });
  };
  const added = (n: number, what: string) => `Added ${n} slide${n === 1 ? '' : 's'} ${what}.`;

  const found: string[] = [];
  const missing: string[] = [];
  for (const phrase of turn.find) {
    const have = inStory();
    const hits = (await deps.find(phrase, 12)).filter((i) => !have.has(i.slide.id) && deps.tellable(i)).slice(0, PER_PHRASE);
    for (const h of hits) place({ ...h, why: `Added for "${phrase}". ${h.why}`.trim() }, `You asked for ${phrase}.`);
    (hits.length ? found : missing).push(hits.length ? `${hits.length} on ${phrase}` : phrase);
  }
  if (found.length) said.push(`Added ${joined(found)}.`);
  if (missing.length) said.push(`Couldn't find anything new on ${joined(missing)}.`);

  if (turn.like || turn.longer) {
    const have = inStory();
    const seeds = [...pinned].filter((id) => have.has(id));
    const fromFamily = deps.familyMates ? (await Promise.all((seeds.length ? seeds : [...have].slice(0, 3)).map((id) => deps.familyMates!(id)))).flat() : [];
    const extra = fromFamily.filter((i, k, all) => !have.has(i.slide.id) && deps.tellable(i) && all.findIndex((x) => x.slide.id === i.slide.id) === k).slice(0, LIKE_LIMIT);
    for (const e of extra) place({ ...e, why: `Belongs with the slides you liked. ${e.why}`.trim() }, 'More like the slides you liked.');
    said.push(extra.length ? added(extra.length, 'that belong with the ones you liked') : 'No more slides belong with these, so nothing was added.');
  }

  return { beats: out, reply: said.join(' ') || 'Done.', understood: understood(turn) };
}
