'use client';

import { useCallback, useMemo, useState } from 'react';
import type { SmartSearchChip } from '../contracts/dto';
import { wordsBehindChip } from './search-reading';
import type { SearchState } from './state';

/**
 * Chips the person crossed out (or whose box they unticked) for the search that ran. The typed words never change;
 * the server is told which words not to read (`ignore`, docs/DECISIONS.md FD-107) and the results follow. `run` counts the
 * searches the person has pressed, so every press of search reads the words afresh, even the same words again.
 */
export function useIgnoredReadings(searched: string, run: number) {
  const [off, setOff] = useState<{ run: number; phrases: string[] }>({ run: -1, phrases: [] });
  const ignore = useMemo(() => (off.run === run ? off.phrases : []), [off, run]);
  /** Switch the reading of these typed words off (no chip needed), e.g. the words that asked for a section. */
  const ignoreWords = useCallback(
    (phrases: string[]) => {
      if (phrases.length) setOff((cur) => ({ run, phrases: [...new Set([...(cur.run === run ? cur.phrases : []), ...phrases])] }));
    },
    [run],
  );
  const ignoreChip = useCallback(
    (chip: SmartSearchChip, alsoCalled?: string): boolean => {
      const runs = wordsBehindChip(searched, chip, alsoCalled);
      if (runs.length) setOff((cur) => ({ run, phrases: [...new Set([...(cur.run === run ? cur.phrases : []), ...runs])] }));
      return runs.length > 0;
    },
    [searched, run],
  );
  return { ignore, ignoreChip, ignoreWords };
}

/**
 * The deck section the words ask for ("bank case studies section", FD-80). `sectionsInWords` is what the words say;
 * `sectionsFromSearch` is that minus what the person turned off for this search; `autoSection` is the one section
 * treated as the Section filter being on, unless a section is picked by hand. Turning it off lasts for the search that
 * ran (`run`): the next press of search reads the words afresh.
 */
export function useSectionReading({ aiAsk, query, search, pickedByHand, run }: { aiAsk: boolean; query: string; search: SearchState; pickedByHand: number; run: number }) {
  const [sectionOffRun, setSectionOffRun] = useState(-1);
  /* What the words ask for, whether or not the person has turned it off: used to tell when a ticked section disagrees with them. */
  const sectionsInWords = useMemo(() => (aiAsk || !query.trim() || search.status !== 'ready' ? [] : (search.result.sections ?? [])), [aiAsk, query, search]);
  /* The section the search asked for, treated as the Section filter being on: only one this search has slides in (an automatic filter
     must never hide every result), and none once it has been turned off. */
  const sectionsFromSearch = useMemo(
    () => (sectionOffRun === run || search.status !== 'ready' ? [] : sectionsInWords.filter((kind) => search.result.items.some((i) => i.slide.section?.kind === kind))),
    [sectionOffRun, run, sectionsInWords, search],
  );
  const autoSection = pickedByHand === 0 && sectionsFromSearch.length === 1 ? sectionsFromSearch[0] : null;
  const dismissAutoSection = useCallback(() => setSectionOffRun(run), [run]);
  return { sectionsInWords, sectionsFromSearch, autoSection, dismissAutoSection, sectionsOff: sectionOffRun === run };
}
