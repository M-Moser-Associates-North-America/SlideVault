import type { SlideSummary } from '../contracts/dto';

/**
 * Pretend deck details for showing the screens before the server sends real ones: ?demodetails=1 in the
 * address. Never on by default. Real values replace this the moment the server sends them.
 */
const PEOPLE = ['Person A', 'Person B', 'Person C', 'Person D'];
const hash = (text: string) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export function withDemoDetails(s: SlideSummary): SlideSummary {
  const h = hash(s.provenance.sourceId);
  const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + (h % 40) + n)).toISOString();
  return { ...s, provenance: { ...s.provenance, createdBy: s.provenance.createdBy ?? PEOPLE[h % 4], uploadedBy: s.provenance.uploadedBy ?? PEOPLE[(h >> 3) % 4], createdAt: s.provenance.createdAt ?? day(-20), uploadedAt: s.provenance.uploadedAt ?? day(0) } };
}
