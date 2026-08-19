import type { CubicSeg } from '@core/geometry/cubic';
import { cubicLength } from '@core/geometry/cubic';
import { lineSeg } from '@core/geometry/line';
import type { Segment } from '@core/geometry/segment';
import { segmentReverse } from '@core/geometry/segment';
import type { Vec2 } from '@core/geometry/vec2';
import { add, vec2 } from '@core/geometry/vec2';

import { dartOnCurve, solveWaistRun, waistCurve } from '../construction/steps';

/**
 * Cómo queda determinada la anchura de la cintura.
 *
 * Los dos modos existen porque las dos prendas plantean la pregunta al revés:
 *
 *   · Una FALDA parte de la cintura: se conoce cuánto debe medir la línea y hay
 *     que averiguar hasta dónde llega. Como la línea sube hacia el costado, su
 *     longitud no es su proyección y hay que resolverla numéricamente.
 *   · Un CUERPO parte del pecho: el costado está donde lo pone la axila, y la
 *     cintura llega hasta ahí. La anchura es un dato, no una incógnita.
 *
 * Que un mismo bloque admita ambos es lo que permite que el vestido use la
 * MISMA cintura arriba y abajo. Si cada mitad la resolviera a su manera, el
 * cuerpo y la falda no casarían en la costura de talle.
 */
export type WaistExtent =
  | { readonly kind: 'span'; readonly span: number }
  | { readonly kind: 'run'; readonly run: number };

export interface WaistSpec {
  /** Punto de la cintura en el centro de la pieza. */
  readonly center: Vec2;
  readonly extent: WaistExtent;
  /** Cuánto sube la cintura hacia el costado. Cero deja la línea horizontal. */
  readonly rise: number;
  readonly dartIntake: number;
  /** Posición de la pinza desde el centro, sobre la curva. */
  readonly dartPosition: number;
  readonly dartLength: number;
  /**
   * A qué lado cae el vértice de la pinza recorriendo del centro al costado.
   * En una falda el interior queda abajo (`right`); en un cuerpo, arriba
   * (`left`).
   */
  readonly dartSide: 'left' | 'right';
}

export interface WaistBlock {
  readonly side: Vec2;
  readonly apex: Vec2;
  /** Extremo de la pinza del lado del centro. */
  readonly legCenterSide: Vec2;
  /** Extremo del lado del costado. */
  readonly legSideSide: Vec2;
  readonly curve: CubicSeg;
  /** Anchura horizontal resuelta. Menor que `span`, porque la línea sube. */
  readonly run: number;
  /** Del centro al costado: tramo, pata, pata, tramo. */
  readonly segments: readonly Segment[];
  /** Longitud de cintura terminada: la curva menos lo que recoge la pinza. */
  readonly finishedLength: number;
}

/**
 * LÍNEA DE CINTURA — el bloque que comparten falda, cuerpo y vestido.
 *
 * Los tres tienen el mismo problema y la misma solución. La cintura debe medir
 * exactamente lo que el cuerpo más la holgura más las pinzas, pero la línea
 * SUBE hacia el costado y su longitud no es su proyección horizontal. Como la
 * longitud de una Bézier no tiene forma cerrada, la anchura se RESUELVE
 * numéricamente en vez de calcularse.
 *
 * Que sea un bloque compartido no es sólo evitar repetir treinta líneas: es lo
 * que garantiza que la cintura de un cuerpo y la de la falda a la que se cose
 * salgan idénticas. Si cada generador la trazara por su cuenta, bastaría un
 * redondeo distinto para que el vestido no cerrara en la cintura.
 */
export function waistBlock(spec: WaistSpec): WaistBlock {
  const run =
    spec.extent.kind === 'run' ? spec.extent.run : solveWaistRun(spec.extent.span, spec.rise);

  const curve = waistCurve(spec.center, run, spec.rise);
  const span = spec.extent.kind === 'span' ? spec.extent.span : cubicLength(curve, 1e-6);

  const dart = dartOnCurve(
    curve,
    spec.dartPosition,
    spec.dartIntake,
    spec.dartLength,
    spec.dartSide,
  );

  return {
    side: add(spec.center, vec2(run, spec.rise)),
    apex: dart.apex,
    legCenterSide: dart.legStart,
    legSideSide: dart.legEnd,
    curve,
    run,
    segments: [
      dart.before,
      lineSeg(dart.legStart, dart.apex),
      lineSeg(dart.apex, dart.legEnd),
      dart.after,
    ],
    finishedLength: span - spec.dartIntake,
  };
}

/** Los mismos segmentos recorridos del costado al centro. */
export const waistTowardCenter = (block: WaistBlock): Segment[] =>
  block.segments.map((segment) => segmentReverse(segment)).reverse();

/** Tramo de cintura pegado al centro, ya listo como arista. */
export const waistInnerSegments = (block: WaistBlock): Segment[] =>
  block.segments.slice(0, 1);

/** Las dos patas de la pinza. */
export const waistDartSegments = (block: WaistBlock): Segment[] =>
  block.segments.slice(1, 3);

/** Tramo de cintura pegado al costado. */
export const waistOuterSegments = (block: WaistBlock): Segment[] =>
  block.segments.slice(3, 4);
