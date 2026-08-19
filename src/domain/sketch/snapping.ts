import { snapToGrid } from '@core/geometry/grid';
import type { Vec2 } from '@core/geometry/vec2';

import { findPoint } from './document';
import { nearestPoint } from './hitTest';
import type { PointId, SketchDocument } from './types';


export type SnapKind = 'free' | 'grid' | 'point';

export interface SnapResult {
  readonly point: Vec2;
  readonly kind: SnapKind;
  /** Punto existente al que se ha enganchado, si `kind === 'point'`. */
  readonly targetId: PointId | null;
}

export interface SnapOptions {
  readonly gridEnabled: boolean;
  readonly gridStepMm: number;
  /** Radio del imán a puntos existentes, en mm (traducido desde px por el editor). */
  readonly pointRadiusMm: number;
  /** Puntos que no deben capturar el imán (p. ej. los que se están arrastrando). */
  readonly exclude?: ReadonlySet<PointId>;
}

/**
 * Radio, en mm, por debajo del cual dos posiciones se consideran el mismo sitio.
 *
 * No es un imán: es resolución de identidad. Un micrómetro está muy por debajo
 * de cualquier magnitud con sentido en confección, así que sólo dispara ante
 * coincidencias reales, no ante proximidad.
 */
const COINCIDENCE_TOL_MM = 1e-3;

/**
 * Resuelve la posición efectiva del cursor.
 *
 * Prioridad: punto existente sobre rejilla sobre libre. El imán a puntos gana
 * siempre porque coincidir con un vértice existente es una intención
 * topológica —unir dos elementos—, mientras que la rejilla es sólo una ayuda
 * métrica. Invertir esta prioridad hace imposible cerrar un contorno cuando el
 * vértice no cae en la rejilla.
 *
 * La comprobación de coincidencia final es lo que garantiza la INTEGRIDAD
 * TOPOLÓGICA, y no es redundante con el imán. Caso real que la motiva: con un
 * paso de rejilla de 10 mm, el radio del imán (10 px ≈ 2.6 mm a escala 1:1) es
 * menor que la mitad del paso. Al hacer clic para cerrar un contorno sobre su
 * primer vértice, el cursor puede quedar fuera del alcance del imán y aun así
 * la rejilla lo lleva EXACTAMENTE a la posición de ese vértice. Sin esta
 * comprobación se crearía un segundo punto en las mismas coordenadas: el
 * contorno parecería cerrado en pantalla pero no lo estaría en el modelo, y el
 * fallo sólo se manifestaría mucho después, al construir piezas o costuras.
 */
export function resolveSnap(
  doc: SketchDocument,
  world: Vec2,
  options: SnapOptions,
): SnapResult {
  const asExisting = (id: PointId): SnapResult | null => {
    const target = findPoint(doc, id);
    return target === undefined ? null : { point: target.p, kind: 'point', targetId: id };
  };

  if (options.pointRadiusMm > 0) {
    const magnetised = nearestPoint(doc, world, options.pointRadiusMm, options.exclude);
    const result = magnetised === null ? null : asExisting(magnetised);
    if (result !== null) return result;
  }

  const useGrid = options.gridEnabled && options.gridStepMm > 0;
  const candidate = useGrid ? snapToGrid(world, options.gridStepMm) : world;

  const coincident = nearestPoint(doc, candidate, COINCIDENCE_TOL_MM, options.exclude);
  const existing = coincident === null ? null : asExisting(coincident);
  if (existing !== null) return existing;

  return { point: candidate, kind: useGrid ? 'grid' : 'free', targetId: null };
}
