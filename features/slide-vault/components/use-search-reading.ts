'use client';

import { useCallback, useMemo, useState } from 'react';
import type { SmartSearchChip } from '../contracts/dto';
import { wordsBehindChip } from './search-reading';
import type { SearchState } from './state';

/**
 * Chips the person crossed out (or whose box they unticked) for the search that ran. The typed words never change;
 * the server is told which words not to read (`ignore`, docs/DECISIONS.md FD-107) and the results follow. Typing a new
 * search starts fresh.
 */
export function useIgnoredReadings(searched: string) {
  const [off, setOff] = useState<{ for: string; phrases: string[] }>({ for: '', phrases: [] });
  const ignore = useMemo(() => (off.for === searched ? off.phrases : []), [off, searched]);
  const ignoreChip = useCallback(
    (chip: SmartSearchChip, alsoCalled?: string) => {
      const runs = wordsBehindChip(searched, chip, alsoCalled);
      if (runs.length) setOff((cur) => ({ for: searched, phrases: [...new Set([...(cur.for === searched ? cur.phrases : []), ...runs])] }));
    },
    [searched],
  );
  return { ignore, ignoreChip };
}

/**
 * The deck section the words ask for ("bank case studies section", FD-80). `sectionsInWords` is what the words say;
 * `sectionsFromSearch` is that minus what the person turned off for this search; `autoSection` is the one section
 * treated as the Section filter being on, unless a section is picked by hand.
 */
export function useSectionReading({ aiAsk, query, search, pickedByHand }: { aiAsk: boolean; query: string; search: SearchState; pickedByHand: number }) {
  const [sectionOffFor, setSectionOffFor] = useState('');
  const sectionsInWords = useMemo(() => {
    if (aiAsk || !query.trim() || search.status !== 'ready') return [];
    const { sections = [], items } = search.result;
    // Only a section this search has slides in: an automatic filter must never hide every result (decks with no sections found).
    return sections.filter((kind) => items.some((i) => i.slide.section?.kind === kind));
  }, [aiAsk, query, search]);
  const sectionsFromSearch = useMemo(() => (sectionOffFor === query.trim() ? [] : sectionsInWords), [sectionOffFor, query, sectionsInWords]);
  const autoSection = pickedByHand === 0 && sectionsFromSearch.length === 1 ? sectionsFromSearch[0] : null;
  const dismissAutoSection = useCallback(() => setSectionOffFor(query.trim()), [query]);
  return { sectionsInWords, sectionsFromSearch, autoSection, dismissAutoSection };
}
