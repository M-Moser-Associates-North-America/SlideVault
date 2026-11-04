import 'server-only';
import JSZip from 'jszip';
import { DOMParser, XMLSerializer, type Document, type Element } from '@xmldom/xmldom';

/**
 * Build a client-ready .pptx containing ONLY the requested slides, in the requested order.
 *
 * Works on a copy of the source package (the source bytes are never modified):
 *  1. rewrite the slide list (p:sldIdLst) to the selection order
 *  2. drop relationships to unselected slides, comments and (by default) speaker notes
 *  3. garbage-collect every part no longer reachable from the package root,
 *     so unselected slides, their media and notes are physically removed
 *  4. replace document properties that would leak the source deck (author, slide titles, cover thumbnail)
 *
 * Limitation (v1): one source deck per export, and each slide at most once.
 */

const NS = {
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
};
const REL_TYPE = {
  slide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
  notesSlide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide',
  thumbnail: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail',
};
// Reviewer comments and comment authors are internal; never ship them.
const isCommentRel = (type: string) => /\/(comments|commentAuthors|authors)$/i.test(type);

export class ExportValidationError extends Error {}

export type ExportOptions = { includeNotes?: boolean };

const parse = (xml: string): Document => new DOMParser().parseFromString(xml, 'application/xml');
const serialize = (doc: Document): string => new XMLSerializer().serializeToString(doc);
const elements = (doc: Document | Element, ns: string, name: string): Element[] =>
  Array.from(doc.getElementsByTagNameNS(ns, name)) as Element[];

/** "ppt/slides/slide1.xml" -> "ppt/slides/_rels/slide1.xml.rels" ("" = package root) */
const relsPathFor = (part: string) => {
  if (part === '') return '_rels/.rels';
  const i = part.lastIndexOf('/');
  return `${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`;
};
/** Resolve a relationship Target relative to the part that owns the .rels file. */
const resolveTarget = (ownerPart: string, target: string) => {
  if (target.startsWith('/')) return target.slice(1);
  const base = ownerPart.includes('/') ? ownerPart.slice(0, ownerPart.lastIndexOf('/') + 1) : '';
  const out: string[] = [];
  for (const seg of (base + target).split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  return out.join('/');
};

type Rel = { el: Element; id: string; type: string; target: string; external: boolean };
async function readRels(zip: JSZip, ownerPart: string): Promise<{ doc: Document; rels: Rel[] } | null> {
  const file = zip.file(relsPathFor(ownerPart));
  if (!file) return null;
  const doc = parse(await file.async('string'));
  const rels = elements(doc, NS.rel, 'Relationship').map((el) => ({
    el,
    id: el.getAttribute('Id') ?? '',
    type: el.getAttribute('Type') ?? '',
    target: el.getAttribute('Target') ?? '',
    external: el.getAttribute('TargetMode') === 'External',
  }));
  return { doc, rels };
}

export type SourceSlide = { number: number; part: string; hidden: boolean };

/** Ordered slide list of a deck, as PowerPoint shows it (1-based numbers). */
export async function listSlides(source: Uint8Array): Promise<SourceSlide[]> {
  const zip = await JSZip.loadAsync(source);
  const pres = parse(await zip.file('ppt/presentation.xml')!.async('string'));
  const rels = (await readRels(zip, 'ppt/presentation.xml'))!.rels;
  const byId = new Map(rels.map((r) => [r.id, resolveTarget('ppt/presentation.xml', r.target)]));
  const out: SourceSlide[] = [];
  for (const [i, el] of elements(pres, NS.p, 'sldId').entries()) {
    const part = byId.get(el.getAttributeNS(NS.r, 'id') ?? '')!;
    const slideXml = await zip.file(part)!.async('string');
    out.push({ number: i + 1, part, hidden: /<p:sld\b[^>]*\sshow="0"/.test(slideXml) });
  }
  return out;
}

export async function exportSelectedSlides(
  source: Uint8Array,
  slideNumbers: number[],
  opts: ExportOptions = {},
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(source); // independent copy; `source` is never written
  const presPart = 'ppt/presentation.xml';
  const presDoc = parse(await zip.file(presPart)!.async('string'));
  const presRels = (await readRels(zip, presPart))!;
  const sldIdLst = elements(presDoc, NS.p, 'sldIdLst')[0];
  const sldIds = elements(presDoc, NS.p, 'sldId');

  // ---- validate ------------------------------------------------------------
  if (!Array.isArray(slideNumbers) || slideNumbers.length === 0)
    throw new ExportValidationError('Select at least one slide.');
  if (slideNumbers.some((n) => !Number.isInteger(n) || n < 1 || n > sldIds.length))
    throw new ExportValidationError(`Slide numbers must be whole numbers from 1 to ${sldIds.length}.`);
  if (new Set(slideNumbers).size !== slideNumbers.length)
    throw new ExportValidationError('Each slide can be used once per export in this version.');

  // ---- 1. slide list in selection order ---------------------------------------
  const keptRelIds = new Set<string>();
  const ordered = slideNumbers.map((n) => sldIds[n - 1]);
  for (const el of sldIds) sldIdLst.removeChild(el);
  for (const el of ordered) {
    sldIdLst.appendChild(el);
    keptRelIds.add(el.getAttributeNS(NS.r, 'id') ?? '');
  }

  // ---- 2. drop relationships we don't ship ------------------------------------
  for (const r of presRels.rels) {
    if ((r.type === REL_TYPE.slide && !keptRelIds.has(r.id)) || isCommentRel(r.type)) {
      presRels.doc.documentElement!.removeChild(r.el);
    }
  }
  zip.file(presPart, serialize(presDoc));
  zip.file(relsPathFor(presPart), serialize(presRels.doc));

  for (const relId of keptRelIds) {
    const slidePart = resolveTarget(presPart, presRels.rels.find((r) => r.id === relId)!.target);
    // A selected slide should be visible in the export even if it was hidden in the source.
    const slideXml = await zip.file(slidePart)!.async('string');
    zip.file(slidePart, slideXml.replace(/(<p:sld\b[^>]*?)\sshow="0"/, '$1'));
    const sr = await readRels(zip, slidePart);
    if (!sr) continue;
    for (const r of sr.rels) {
      if (isCommentRel(r.type) || (!opts.includeNotes && r.type === REL_TYPE.notesSlide)) {
        sr.doc.documentElement!.removeChild(r.el);
      }
    }
    zip.file(relsPathFor(slidePart), serialize(sr.doc));
  }

  // Drop the source deck's cover thumbnail from the package root.
  const rootRels = (await readRels(zip, ''))!;
  for (const r of rootRels.rels) if (r.type === REL_TYPE.thumbnail) rootRels.doc.documentElement!.removeChild(r.el);
  zip.file('_rels/.rels', serialize(rootRels.doc));

  // ---- 3. garbage-collect unreachable parts ------------------------------------
  const reachable = new Set<string>();
  const queue = [''];
  while (queue.length) {
    const owner = queue.shift()!;
    const rels = await readRels(zip, owner);
    if (!rels) continue;
    for (const r of rels.rels) {
      if (r.external) continue;
      const target = resolveTarget(owner, r.target);
      if (!reachable.has(target) && zip.file(target)) {
        reachable.add(target);
        queue.push(target);
      }
    }
  }
  const removed: string[] = [];
  for (const name of Object.keys(zip.files)) {
    const f = zip.files[name];
    if (!f || f.dir || name === '[Content_Types].xml' || name.endsWith('.rels')) continue; // !f: removed earlier in this loop
    if (!reachable.has(name)) {
      zip.remove(name);
      zip.remove(relsPathFor(name));
      removed.push(name);
    }
  }
  // Remove any orphaned .rels whose owner part is gone.
  for (const name of Object.keys(zip.files)) {
    if (!name.endsWith('.rels') || name === '_rels/.rels') continue;
    const owner = name.replace(/_rels\/([^/]+)\.rels$/, '$1');
    if (!zip.file(owner)) zip.remove(name);
  }
  const ctDoc = parse(await zip.file('[Content_Types].xml')!.async('string'));
  for (const o of elements(ctDoc, NS.ct, 'Override')) {
    const part = (o.getAttribute('PartName') ?? '').replace(/^\//, '');
    if (!zip.file(part)) ctDoc.documentElement!.removeChild(o);
  }
  zip.file('[Content_Types].xml', serialize(ctDoc));

  // ---- 4. neutral document properties ------------------------------------------
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  if (zip.file('docProps/core.xml')) {
    zip.file(
      'docProps/core.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title></dc:title><dc:creator>SlideVault</dc:creator><cp:lastModifiedBy>SlideVault</cp:lastModifiedBy><cp:revision>1</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`,
    );
  }
  if (zip.file('docProps/app.xml')) {
    zip.file(
      'docProps/app.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>SlideVault</Application><Slides>${slideNumbers.length}</Slides></Properties>`,
    );
  }

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
