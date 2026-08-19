import { CHORD_TOL_MM } from '@core/geometry/epsilon';
import type { JoinStyle } from '@core/geometry/offset';
import { offsetPolygon } from '@core/geometry/offset';
import type { Polygon } from '@core/geometry/polygon';
import { polygonArea } from '@core/geometry/polygon';

import { flattenBoundary, seamAllowancePerSide } from './piece';
import type { PatternPiece } from './types';

export interface SeamAllowanceOptions {
  /** Tolerancia de cuerda al aplanar el contorno, en mm. */
  readonly tolerance?: number;
  readonly join?: JoinStyle;
  readonly miterLimit?: number;
}

export interface CutLine {
  /** Línea de corte, como polígono cerrado en coordenadas LOCALES. */
  readonly polygon: Polygon;
  /** Línea de costura aplanada con la misma tolerancia, para comparar. */
  readonly seamLine: Polygon;
}

/**
 * Calcula la LÍNEA DE CORTE de una pieza a partir de su línea de costura.
 *
 * Es geometría DERIVADA, nunca almacenada. Cambiar un margen no toca el
 * patrón: vuelve a pasar por aquí. Esa es la razón de guardar como fuente la
 * línea de costura y no la de corte.
 *
 * ── Por qué se aplana antes de desplazar ────────────────────────────────────
 *
 * El desplazamiento de una curva de Bézier NO es una curva de Bézier: no existe
 * solución exacta, sólo aproximaciones. Aplanar con una tolerancia conocida y
 * desplazar la polilínea da un error acotado y comprensible —0.05 mm por
 * defecto, muy por debajo del grosor de un trazo— en lugar de un error de
 * aproximación difícil de razonar. Un reajuste a Béziers para exportación suave
 * es un paso posterior, no un requisito.
 *
 * ── Aristas al doblez ───────────────────────────────────────────────────────
 *
 * Reciben margen cero y la línea de corte pasa exactamente por la de costura,
 * porque ahí la tela no se corta: continúa reflejada al otro lado.
 */
export function cutLine(piece: PatternPiece, options: SeamAllowanceOptions = {}): CutLine {
  const tolerance = options.tolerance ?? CHORD_TOL_MM;
  const boundary = flattenBoundary(piece, tolerance);
  const widths = seamAllowancePerSide(piece, boundary);

  const polygon = offsetPolygon(boundary.polygon, widths, {
    join: options.join ?? 'miter',
    ...(options.miterLimit !== undefined ? { miterLimit: options.miterLimit } : {}),
  });

  return { polygon, seamLine: boundary.polygon };
}

/**
 * Superficie de tela que consume la pieza, en mm².
 *
 * Se mide sobre la línea de CORTE, no sobre la de costura: lo que se paga es
 * la tela que se corta.
 */
export function fabricArea(piece: PatternPiece, options?: SeamAllowanceOptions): number {
  return polygonArea(cutLine(piece, options).polygon);
}

/**
 * Comprueba que el margen ha añadido material en todas partes.
 *
 * Un desplazamiento hacia fuera SIEMPRE debe aumentar el área. Que disminuya
 * significa que el signo se ha invertido —contorno recorrido al revés— o que la
 * limpieza de auto-intersecciones se ha comido una región. Es una verificación
 * barata que atrapa la clase entera de errores de orientación.
 */
export function allowanceAddsMaterial(piece: PatternPiece, options?: SeamAllowanceOptions): boolean {
  const { polygon, seamLine } = cutLine(piece, options);
  return polygonArea(polygon) >= polygonArea(seamLine);
}
