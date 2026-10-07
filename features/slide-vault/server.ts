// Server entry point for the SlideVault feature. Never import this from browser code.
export { loadLibrary } from './server/library';
export { exportSelectedSlides, listSlides, ExportValidationError } from './server/export-pptx';
export { SOURCE_DECK } from './server/source-deck';
