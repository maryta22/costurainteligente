import type { Draft, DraftContext } from '../construction/draft';
import type { PatternPiece, Seam } from '../types';

export type GarmentId = 'skirt' | 'blouse' | 'dress';

export interface GeneratedGarment {
  readonly pieces: readonly PatternPiece[];
  readonly seams: readonly Seam[];
  /** Trazado con los puntos nombrados: la base de los ajustes manuales. */
  readonly draft: Draft;
  /** Observaciones del generador, para la interfaz. */
  readonly notes: readonly string[];
}

export interface GarmentGenerator {
  readonly id: GarmentId;
  readonly name: string;
  /** Parámetros que el generador necesita tener definidos. */
  readonly requires: readonly string[];
  generate(context: DraftContext): GeneratedGarment;
}
