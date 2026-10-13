// Server entry point for the SlideVault feature. Never import this from browser code.
export { readConfig, readSupabaseConfig, type ServerConfig } from './server/config';
export { loadLibraryIndex, findSlide, previewFile, type LibraryIndex } from './server/library-repository';
export { searchSlides, toSummary, DEFAULT_LIMIT } from './server/services/search';
export { exportSlides, type ExportFile } from './server/services/export';
export { exportSelectedSlides, listSlides, ExportValidationError } from './server/export-pptx';
export { ok, fail, file, ServiceError, toResponse } from './server/http';
export { findDeckByHash, createDeck, insertSlides, markDeckReady, markDeckFailed, getDeck, getSlidePg, searchSlidesPg, listSlideTextsPg } from './server/pg-repository';
export { uploadOriginal, uploadPreview, downloadPreview } from './server/storage';
export { groupDuplicates, type SlideText } from './server/duplicates';
export { withDuplicateBadges, fixtureSlideTexts } from './server/services/duplicate-badges';
