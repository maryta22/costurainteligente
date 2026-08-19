import type { EdgeId, PieceId } from '@domain/pattern/types';

import type { RelaxReport } from './relax';
import type { StrainField } from './strain';

/** A qué parte del cuerpo se ciñe un panel. */
export type WrapGroup = 'torso' | 'band' | 'arm0' | 'arm1';

export interface FittedPanel {
  readonly piece: PieceId;
  readonly instance: number;
  readonly group: WrapGroup;
  /** Posiciones ya vestidas, tres por vértice. */
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uv: Float32Array;
  readonly indices: Uint32Array;
  readonly boundary: ReadonlyMap<EdgeId, readonly number[]>;
  /** Deformación por vértice, para colorear. */
  readonly strain: Float32Array;
  readonly vertexCount: number;
}

export interface FittedGarment {
  readonly panels: readonly FittedPanel[];
  readonly relax: RelaxReport;
  readonly strain: StrainField;
  /** Contorno de la prenda a las alturas clave, para explicar la holgura. */
  readonly easeAtLevels: ReadonlyMap<string, EaseReading>;
  readonly warnings: readonly string[];
}

/** Cuánto separa la prenda del cuerpo a una altura concreta. */
export interface EaseReading {
  readonly bodyMm: number;
  readonly garmentMm: number;
  readonly easeMm: number;
}

export interface FitOptions {
  /** Separación mínima entre la tela y la piel. */
  readonly clearanceMm?: number;
  readonly iterations?: number;
  readonly seamStiffness?: number;
  readonly edgeStiffness?: number;
  readonly maxSeamPullMm?: number;
}

export const DEFAULT_CLEARANCE_MM = 6;
export const DEFAULT_ITERATIONS = 60;
export const DEFAULT_SEAM_STIFFNESS = 0.5;
export const DEFAULT_EDGE_STIFFNESS = 0.5;
export const DEFAULT_MAX_SEAM_PULL_MM = 15;
