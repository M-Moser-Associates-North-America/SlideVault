import JSZip from 'jszip';

/**
 * What PowerPoint itself recorded about a deck file (docProps/core.xml): who created it and when.
 * Real values only (docs/DECISIONS.md FD-52): anything missing or unreadable comes back null, never
 * guessed. No 'server-only' marker, so scripts can use it too.
 */
export type FileFacts = { createdBy: string | null; createdAt: string | null };

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export function readCoreXml(xml: string): FileFacts {
  const creator = /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/.exec(xml)?.[1];
  const created = /<dcterms:created[^>]*>([\s\S]*?)<\/dcterms:created>/.exec(xml)?.[1];
  const name = creator ? unescape(creator).trim() : '';
  const when = created ? new Date(created.trim()) : null;
  return {
    createdBy: name && name.length <= 120 ? name : null,
    createdAt: when && !Number.isNaN(when.getTime()) && when.getFullYear() > 1990 ? when.toISOString() : null,
  };
}

export async function readFileFacts(bytes: Uint8Array | Buffer): Promise<FileFacts> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const core = zip.file('docProps/core.xml');
    return core ? readCoreXml(await core.async('string')) : { createdBy: null, createdAt: null };
  } catch {
    return { createdBy: null, createdAt: null };
  }
}

/**
 * A recorded author as people read it (FD-54): "JordanEllis - M Moser Associates" becomes
 * "Jordan Ellis". Drops a trailing " - M Moser..." (the company, not the person) and splits a
 * name typed without a space where a lower-case letter meets a capital, only after at least three
 * letters, so "McDonald" and "DeAndre" stay as they are. The stored value is never changed.
 */
export function tidyPersonName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let name = raw.replace(/\s+-\s+M\s*Moser\b.*$/i, '').trim();
  if (!/\s/.test(name)) name = name.replace(/([a-z]{3,})(?=[A-Z][a-z])/g, '$1 ');
  return name || raw.trim();
}
