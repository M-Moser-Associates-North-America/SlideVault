// Server entry point for the SlideVault feature. Never import this from browser code.
export { readConfig, type ServerConfig } from './server/config';
export { loadLibraryIndex, findSlide, previewFile, type LibraryIndex } from './server/library-repository';
export { searchSlides, toSummary, DEFAULT_LIMIT } from './server/services/search';
export { exportSlides } from './server/services/export';
export { exportSelectedSlides, listSlides, ExportValidationError } from './server/export-pptx';
export { ok, fail, file, ServiceError, toResponse } from './server/http';
