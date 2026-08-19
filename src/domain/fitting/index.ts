export * from './types';
export { fitGarment } from './fit';
export {
  penetration,
  pushOutside,
  sectionAngleAtArcLength,
  sectionArcLength,
  sectionAt,
  sectionPerimeter,
  sectionPoint,
} from './bodySurface';
export type { Section } from './bodySurface';
export { buildProfile, fitSection, panelArcAt, panelWidthAt, perimeterAt, tubeRange } from './profile';
export type { Profile, ProfileInput } from './profile';
export { relax } from './relax';
export type { BodyCollider, RelaxConstraints, RelaxOptions, RelaxReport } from './relax';
export { STRAIN_TOLERANCE, computeStrain, strainColor } from './strain';
export type { StrainField } from './strain';
export { angleAtFraction, buildFitSurface, surfaceSectionAt, tabulate, wrapPoint } from './wrap';
export type { FitSurface, SectionTable } from './wrap';
