import type { LineId, PointId } from './types';

/**
 * Generación de identificadores.
 *
 * Vive fuera de `core` a propósito: producir un identificador es un efecto, y
 * el núcleo debe permanecer libre de estado global (§1 de
 * docs/ARCHITECTURE.md).
 *
 * Un contador monótono basta mientras el documento no se persiste. Al llegar la
 * persistencia (Fase 15) habrá que sembrar el contador al cargar —para eso está
 * `seedIdCounter`— o migrar a UUID; el resto del sistema no se entera porque
 * sólo depende del tipo `PointId`, nunca de su forma.
 */
let counter = 0;

export const createPointId = (): PointId => `p${++counter}` as PointId;
export const createLineId = (): LineId => `l${++counter}` as LineId;

/** Reposiciona el contador. Para tests deterministas y para carga de documentos. */
export function seedIdCounter(value: number): void {
  counter = Math.max(0, Math.floor(value));
}
