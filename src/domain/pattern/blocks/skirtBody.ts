import { cubicSeg } from '@core/geometry/cubic';
import { lineSeg } from '@core/geometry/line';
import type { Segment } from '@core/geometry/segment';
import type { Vec2 } from '@core/geometry/vec2';
import { vec2 } from '@core/geometry/vec2';

export interface SkirtLowerSpec {
  /** Punto del bajo en el centro de la pieza. */
  readonly centerHem: Vec2;
  /** Distancia del centro al costado a la altura de la cadera. */
  readonly hipQuarter: number;
  /** Altura de la línea de cadera. */
  readonly hipLevel: number;
  /** Punto de cintura en el costado, donde termina el bloque. */
  readonly waistSide: Vec2;
}

export interface SkirtLowerBlock {
  readonly sideHem: Vec2;
  readonly hipSide: Vec2;
  /** Del centro al costado. */
  readonly hem: Segment;
  /** Del bajo a la cadera: recto. */
  readonly sideLower: Segment;
  /** De la cadera a la cintura: la curva del entalle. */
  readonly sideUpper: Segment;
}

/**
 * MITAD INFERIOR DE UNA FALDA — el bloque que comparten falda y vestido.
 *
 * De la línea del bajo a la cintura por el costado. Por debajo de la cadera el
 * costado es recto —es una falda recta— y por encima entra hacia la cintura.
 *
 * La curva del entalle es VERTICAL en sus dos extremos: en la cadera porque
 * continúa el tramo recto de abajo, y en la cintura porque debe llegar
 * perpendicular a ella. De ahí su forma en S característica.
 */
export function skirtLowerBlock(spec: SkirtLowerSpec): SkirtLowerBlock {
  const sideHem = vec2(spec.centerHem.x + spec.hipQuarter, spec.centerHem.y);
  const hipSide = vec2(sideHem.x, spec.hipLevel);

  const rise = (spec.waistSide.y - spec.hipLevel) / 3;

  return {
    sideHem,
    hipSide,
    hem: lineSeg(spec.centerHem, sideHem),
    sideLower: lineSeg(sideHem, hipSide),
    sideUpper: cubicSeg(
      hipSide,
      vec2(hipSide.x, hipSide.y + rise),
      vec2(spec.waistSide.x, spec.waistSide.y - rise),
      spec.waistSide,
    ),
  };
}
