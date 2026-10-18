// Browser-safe public entry point for the SlideVault feature (docs/INTEGRATION_CONTRACT.md).
export { SlideVaultWorkspace } from './components/SlideVaultWorkspace';
export { CONTRACT_VERSION } from './contracts/runtime';
export type { Capability, Location, RuntimeRequest, SlideVaultRuntime, SlideVaultWorkspaceProps, View } from './contracts/runtime';
export type { ApiError, ApiErrorCode, ApiOk, ApiPage, ExportRequest, Provenance, Session, SlideDetail, SlideSummary } from './contracts/dto';
export { useProfile } from './client/profile-store';
export { startTour } from './client/tour-store';
