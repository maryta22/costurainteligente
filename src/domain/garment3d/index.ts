export * from './types';
export { buildGarmentMesh } from './build';
export {
  classifyPanel,
  instanceCount,
  isCenterEdge,
  panelNormal,
  panelPointToWorld,
  planPlacement,
} from './placement';
export type { PanelKind } from './placement';
export { chainBoundary, planSampleCounts, sampleBoundary } from './sampling';
export type { BoundaryResult, SampleCounts, SampledEdge } from './sampling';
export { angleStats, meanEdgeLength, triangularLattice, triangulatePolygon } from './triangulate';
export type { AngleStats, Triangulation } from './triangulate';
