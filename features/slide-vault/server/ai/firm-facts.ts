/**
 * What everyone at M Moser knows and no slide spells out (FD-87; Schiffon, 5 Nov: "for 45 years of files, it
 * should know that Moira Moser is the head of M Moser"). Read by the AI with every search, so "a photo of
 * our founder" means Moira Moser and "all our studios" means the offices. One fact per line, in plain words:
 * M Moser can add to it without touching the search code. The rules keep the same facts as search words
 * (domain/search-rules.ts: founder, offices, IDD).
 */
export const FIRM_FACTS: readonly string[] = [
  'Moira Moser founded M Moser Associates and leads it. "Our founder", "the founder" or "Moira" means Moira Moser.',
  'M Moser calls its offices "studios". "Global locations", "physical presence", "global network" and a list of cities on a map all mean its offices.',
  'M Moser office cities: New York, San Francisco, Los Angeles, Denver, Raleigh, Miami, Vancouver, Toronto, Montreal, Calgary, Winnipeg, London, Paris, Amsterdam, Dubai, Cyprus, Mumbai, Delhi, Bengaluru, Hyderabad, Singapore, Kuala Lumpur, Manila, Hong Kong, Shanghai, Beijing, Shenzhen, Guangzhou, Chengdu, Taipei, Sydney, Melbourne, Brisbane, Perth.',
  'IDD (Integrated Design Delivery) is M Moser\'s design-and-build offer: its slides say "Design & Build", not "IDD".',
];

export const firmFactsInstructions = (): string[] => (FIRM_FACTS.length ? ['Facts about M Moser:', ...FIRM_FACTS.map((f) => `- ${f}`)] : []);
