import 'server-only';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer, type Document, type Element } from '@xmldom/xmldom';

/**
 * Combine slides from several decks into ONE editable .pptx (docs/DECISIONS.md FD-21).
 *
 * Input: one already-trimmed package per deck (export-pptx.ts exportSelectedSlides: only the picked
 * slides, no notes, comments or source properties), plus the order to show slides in across decks.
 *
 * How (the same thing PowerPoint's "keep source formatting" does):
 *  - the first deck's package is the base;
 *  - from each other deck, copy each slide with everything it depends on (its layout, master,
 *    theme, images, charts and so on), giving every copied part a fresh name so nothing collides;
 *  - register the copied masters and slides in presentation.xml with fresh, unique ids;
 *  - put the slide list in the requested order across decks.
 * Every slide keeps its own deck's design, so nothing is restyled.
 *
 * Decks with different slide sizes (for example 4:3 and 16:9) can't share one file without one of
 * them looking stretched, so that case throws MixedSlideSizesError and the caller falls back to a zip.
 */

const NS = {
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
};
const REL = {
  slide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
  slideMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
  slideLayout: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
};
const PRES = 'ppt/presentation.xml';
const MASTER_CT = 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml';

export class MixedSlideSizesError extends Error {
  constructor() {
    super('These decks use different slide sizes (for example 4:3 and 16:9), so they can’t be combined into one file.');
  }
}

export type CombineDeck = { bytes: Uint8Array };
/** One entry per slide in the final file: which deck, and which slide of that deck's trimmed package (1-based). */
export type CombineOrder = { deck: number; slide: number }[];

const parse = (xml: string): Document => new DOMParser().parseFromString(xml, 'application/xml');
const serialize = (doc: Document): string => new XMLSerializer().serializeToString(doc);
const els = (doc: Document | Element, ns: string, name: string): Element[] => Array.from(doc.getElementsByTagNameNS(ns, name)) as Element[];

const relsPathFor = (part: string) => {
  if (part === '') return '_rels/.rels';
  const i = part.lastIndexOf('/');
  return `${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`;
};
const dirOf = (part: string) => (part.includes('/') ? part.slice(0, part.lastIndexOf('/') + 1) : '');
const resolveTarget = (owner: string, target: string) => {
  if (target.startsWith('/')) return target.slice(1);
  const out: string[] = [];
  for (const seg of (dirOf(owner) + target).split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  return out.join('/');
};
/** The relative Target that points from `owner` to `part`. */
const relativeTarget = (owner: string, part: string) => {
  const from = dirOf(owner).split('/').filter(Boolean);
  const to = part.split('/');
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  return [...Array(from.length - i).fill('..'), ...to.slice(i)].join('/');
};

type Rel = { el: Element; id: string; type: string; target: string; external: boolean };
async function readRels(zip: JSZip, owner: string): Promise<{ doc: Document; rels: Rel[] } | null> {
  const f = zip.file(relsPathFor(owner));
  if (!f) return null;
  const doc = parse(await f.async('string'));
  const rels = els(doc, NS.rel, 'Relationship').map((el) => ({
    el,
    id: el.getAttribute('Id') ?? '',
    type: el.getAttribute('Type') ?? '',
    target: el.getAttribute('Target') ?? '',
    external: el.getAttribute('TargetMode') === 'External',
  }));
  return { doc, rels };
}

/** Slide parts of a package, in slide-list order. */
async function slideParts(zip: JSZip): Promise<{ part: string; sldId: Element }[]> {
  const pres = parse(await zip.file(PRES)!.async('string'));
  const rels = (await readRels(zip, PRES))!.rels;
  const byId = new Map(rels.map((r) => [r.id, resolveTarget(PRES, r.target)]));
  return els(pres, NS.p, 'sldId').map((sldId) => ({ part: byId.get(sldId.getAttributeNS(NS.r, 'id') ?? '')!, sldId }));
}

async function slideSize(zip: JSZip): Promise<string> {
  const m = (await zip.file(PRES)!.async('string')).match(/<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
  return m ? `${m[1]}x${m[2]}` : 'unknown';
}

/** Content types: Override by part name, else Default by extension. */
async function contentTypes(zip: JSZip) {
  const doc = parse(await zip.file('[Content_Types].xml')!.async('string'));
  const overrides = new Map(els(doc, NS.ct, 'Override').map((o) => [(o.getAttribute('PartName') ?? '').replace(/^\//, ''), o.getAttribute('ContentType') ?? '']));
  const defaults = new Map(els(doc, NS.ct, 'Default').map((d) => [(d.getAttribute('Extension') ?? '').toLowerCase(), d.getAttribute('ContentType') ?? '']));
  return { doc, overrides, defaults, typeOf: (part: string) => overrides.get(part) ?? defaults.get(part.split('.').pop()!.toLowerCase()) ?? null };
}

/** Everything a set of parts depends on, following internal relationships (the parts themselves included). */
async function closure(zip: JSZip, starts: string[]): Promise<string[]> {
  const seen = new Set<string>();
  const queue = [...starts];
  while (queue.length) {
    const part = queue.shift()!;
    if (seen.has(part) || !zip.file(part)) continue;
    seen.add(part);
    const rels = await readRels(zip, part);
    for (const r of rels?.rels ?? []) if (!r.external) queue.push(resolveTarget(part, r.target));
  }
  return [...seen];
}

/** A free name in the base package for a part: same folder, same stem, next number ("slideLayout12.xml"). */
function freeName(isTaken: (name: string) => boolean, part: string): string {
  if (!isTaken(part)) return part;
  const m = part.match(/^(.*\/)?([^/]*?)(\d*)(\.[^./]+)$/);
  const [dir, stem, ext] = m ? [m[1] ?? '', m[2], m[4]] : [dirOf(part), part.slice(dirOf(part).length), ''];
  for (let n = 1; ; n++) {
    const name = `${dir}${stem}${n}${ext}`;
    if (!isTaken(name)) return name;
  }
}

export async function combineDecks(decks: CombineDeck[], order: CombineOrder): Promise<Uint8Array> {
  if (decks.length === 0) throw new Error('Nothing to combine.');
  const zips = await Promise.all(decks.map((d) => JSZip.loadAsync(d.bytes)));
  const sizes = await Promise.all(zips.map(slideSize));
  if (new Set(sizes).size > 1) throw new MixedSlideSizesError();

  const base = zips[0];
  const baseCT = await contentTypes(base);
  // Part names are case-insensitive in a package, so compare lowercased.
  const taken = new Set(Object.keys(base.files).map((n) => n.toLowerCase()));
  const claim = (part: string) => {
    const name = freeName((n) => taken.has(n.toLowerCase()), part);
    taken.add(name.toLowerCase());
    return name;
  };

  const presDoc = parse(await base.file(PRES)!.async('string'));
  const presRels = (await readRels(base, PRES))!;
  const presRoot = presRels.doc.documentElement!;
  let relN = Math.max(0, ...presRels.rels.map((r) => Number(r.id.replace(/\D/g, '')) || 0));
  const newRelId = () => `rId${++relN}`;

  // Master and layout ids share one number space (2147483648 and up); slide ids start at 256.
  const masterIdLst = els(presDoc, NS.p, 'sldMasterIdLst')[0];
  const sldIdLst = els(presDoc, NS.p, 'sldIdLst')[0];
  let topId = 2147483647;
  const noteId = (v: string | null) => (topId = Math.max(topId, Number(v) || 0));
  els(presDoc, NS.p, 'sldMasterId').forEach((e) => noteId(e.getAttribute('id')));
  for (const r of presRels.rels.filter((x) => x.type === REL.slideMaster)) {
    const m = parse(await base.file(resolveTarget(PRES, r.target))!.async('string'));
    els(m, NS.p, 'sldLayoutId').forEach((e) => noteId(e.getAttribute('id')));
  }
  let slideIdN = Math.max(255, ...els(presDoc, NS.p, 'sldId').map((e) => Number(e.getAttribute('id')) || 0));

  // Slide-list entries for every deck's slides, to order at the end. Deck 0's are already there.
  const entries: Element[][] = [(await slideParts(base)).map((s) => s.sldId)];

  for (let d = 1; d < zips.length; d++) {
    const src = zips[d];
    const srcCT = await contentTypes(src);
    const slides = await slideParts(src);
    const parts = await closure(src, slides.map((s) => s.part));

    // 1. Fresh names for every part this deck brings, in its own folder.
    const rename = new Map(parts.map((p) => [p, claim(p)]));

    // 2. Copy parts and their relationships, pointing at the new names.
    for (const [from, to] of rename) {
      let content = await src.file(from)!.async('uint8array');
      const type = srcCT.typeOf(from);
      if (type === MASTER_CT) {
        // Give this master's layouts fresh ids so they never clash with the base deck's.
        const m = parse(new TextDecoder().decode(content));
        for (const e of els(m, NS.p, 'sldLayoutId')) e.setAttribute('id', String(++topId));
        content = new TextEncoder().encode(serialize(m));
      }
      base.file(to, content);
      const rels = await readRels(src, from);
      if (rels) {
        for (const r of rels.rels) {
          if (r.external) continue;
          const target = rename.get(resolveTarget(from, r.target));
          if (target) r.el.setAttribute('Target', relativeTarget(to, target));
          else rels.doc.documentElement!.removeChild(r.el); // pointed outside what we copy (e.g. a dropped part)
        }
        base.file(relsPathFor(to), serialize(rels.doc));
      }
      // 3. Content type for the new name.
      if (type) {
        const ext = to.split('.').pop()!.toLowerCase();
        if (baseCT.defaults.get(ext) !== type || srcCT.overrides.has(from)) {
          const o = baseCT.doc.createElementNS(NS.ct, 'Override');
          o.setAttribute('PartName', `/${to}`);
          o.setAttribute('ContentType', type);
          baseCT.doc.documentElement!.appendChild(o);
          baseCT.overrides.set(to, type);
        }
      }
    }

    // 4. Register this deck's masters (one per distinct master its slides use).
    for (const [from, to] of rename) {
      if (srcCT.typeOf(from) !== MASTER_CT) continue;
      const rid = newRelId();
      const rel = presRels.doc.createElementNS(NS.rel, 'Relationship');
      rel.setAttribute('Id', rid);
      rel.setAttribute('Type', REL.slideMaster);
      rel.setAttribute('Target', relativeTarget(PRES, to));
      presRoot.appendChild(rel);
      const m = presDoc.createElementNS(NS.p, 'p:sldMasterId');
      m.setAttribute('id', String(++topId));
      m.setAttributeNS(NS.r, 'r:id', rid);
      masterIdLst.appendChild(m);
    }

    // 5. Register this deck's slides (placed in order below).
    entries.push(
      slides.map((s) => {
        const rid = newRelId();
        const rel = presRels.doc.createElementNS(NS.rel, 'Relationship');
        rel.setAttribute('Id', rid);
        rel.setAttribute('Type', REL.slide);
        rel.setAttribute('Target', relativeTarget(PRES, rename.get(s.part)!));
        presRoot.appendChild(rel);
        const e = presDoc.createElementNS(NS.p, 'p:sldId');
        e.setAttribute('id', String(++slideIdN));
        e.setAttributeNS(NS.r, 'r:id', rid);
        return e;
      }),
    );
  }

  // 6. Final slide order across decks.
  const used = new Set<Element>();
  const ordered = order.map(({ deck, slide }) => {
    const e = entries[deck]?.[slide - 1];
    if (!e || used.has(e)) throw new Error(`Bad combine order entry: deck ${deck}, slide ${slide}.`);
    used.add(e);
    return e;
  });
  if (ordered.length !== entries.reduce((n, list) => n + list.length, 0)) throw new Error('The combine order must list every slide once.');
  for (const e of els(presDoc, NS.p, 'sldId')) sldIdLst.removeChild(e);
  for (const e of ordered) sldIdLst.appendChild(e);

  base.file(PRES, serialize(presDoc));
  base.file(relsPathFor(PRES), serialize(presRels.doc));
  base.file('[Content_Types].xml', serialize(baseCT.doc));
  if (base.file('docProps/app.xml')) {
    const app = await base.file('docProps/app.xml')!.async('string');
    base.file('docProps/app.xml', app.replace(/<Slides>\d+<\/Slides>/, `<Slides>${ordered.length}</Slides>`));
  }
  return base.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
