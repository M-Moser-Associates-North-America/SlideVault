import 'server-only';
import path from 'node:path';

/**
 * The one deck this version of the library is built from. Read-only: exports work on a copy.
 * Multi-deck libraries (upload, versions) replace this with storage + database records.
 */
const fileName = 'SlideVault_Presentation1_Aug5.pptx';

export const SOURCE_DECK = {
  fileName,
  path: path.join(process.cwd(), 'reference', fileName),
} as const;
