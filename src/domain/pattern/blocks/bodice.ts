import { cubicSeg } from '@core/geometry/cubic';
import { lineSeg } from '@core/geometry/line';
import { degToRad } from '@core/geometry/math';
import type { Segment } from '@core/geometry/segment';
import type { Vec2 } from '@core/geometry/vec2';
import { add, fromPolar, vec2 } from '@core/geometry/vec2';

export interface BodiceUpperSpec {
  /** Punto de cintura en el costado, de donde arranca el bloque. */
  readonly waistSide: Vec2;
  /** Distancia del centro a la axila: medio contorno de pecho por cuarto. */
  readonly widthQuarter: number;
  /** Altura de la línea de axila. COMÚN a delantero y espalda. */
  readonly underarmLevel: number;
  readonly neckWidth: number;
  readonly shoulderY: number;
  readonly neckDrop: number;
  readonly shoulderLength: number;
  /** Caída de hombro, en grados. */
  readonly shoulderSlope: number;
}

export interface BodiceUpperBlock {
  readonly underarm: Vec2;
  readonly shoulderTip: Vec2;
  readonly shoulderNeck: Vec2;
  readonly centerNeck: Vec2;
  /** De la cintura a la axila. */
  readonly side: Segment;
  /** De la axila a la punta del hombro. */
  readonly armhole: Segment;
  /** De la punta del hombro al cuello. */
  readonly shoulder: Segment;
  /** Del cuello al centro. */
  readonly neckline: Segment;
}

/**
 * MITAD SUPERIOR DE UN CUERPO — el bloque que comparten blusa y vestido.
 *
 * Va de la cintura al centro del escote, pasando por el costado, la sisa y el
 * hombro. No sabe si por debajo hay un bajo, una falda cosida o nada: eso lo
 * decide quien lo compone.
 *
 * ── Tres reglas que el bloque impone ───────────────────────────────────────
 *
 *   · La sisa sale VERTICAL de la axila, continuando el costado. Ambos forman
 *     una línea continua, de modo que al unir las dos mitades del cuerpo la
 *     axila queda redonda y no en pico.
 *   · El escote llega HORIZONTAL al centro. Si no, al abrir la pieza por el
 *     doblez aparecería un pico en mitad del escote.
 *   · El hombro es una recta de largo y caída dados, iguales en delantero y
 *     espalda, así que su costura casa sin ajustar nada.
 */
export function bodiceUpperBlock(spec: BodiceUpperSpec): BodiceUpperBlock {
  const underarm = vec2(spec.widthQuarter, spec.underarmLevel);
  const shoulderNeck = vec2(spec.neckWidth, spec.shoulderY);
  const shoulderTip = add(
    shoulderNeck,
    fromPolar(spec.shoulderLength, degToRad(-spec.shoulderSlope)),
  );
  const centerNeck = vec2(0, spec.shoulderY - spec.neckDrop);

  const rise = spec.underarmLevel - spec.waistSide.y;

  const side = cubicSeg(
    spec.waistSide,
    vec2(spec.waistSide.x, spec.waistSide.y + rise * 0.42),
    vec2(underarm.x, underarm.y - rise * 0.34),
    underarm,
  );

  const armholeRise = shoulderTip.y - underarm.y;
  const armholeRun = underarm.x - shoulderTip.x;
  const armhole = cubicSeg(
    underarm,
    vec2(underarm.x, underarm.y + armholeRise * 0.45),
    vec2(shoulderTip.x + armholeRun * 0.45, shoulderTip.y - armholeRise * 0.1),
    shoulderTip,
  );

  const neckline = cubicSeg(
    shoulderNeck,
    vec2(shoulderNeck.x - spec.neckWidth * 0.28, shoulderNeck.y - spec.neckDrop * 0.55),
    vec2(centerNeck.x + spec.neckWidth * 0.52, centerNeck.y),
    centerNeck,
  );

  return {
    underarm,
    shoulderTip,
    shoulderNeck,
    centerNeck,
    side,
    armhole,
    shoulder: lineSeg(shoulderTip, shoulderNeck),
    neckline,
  };
}
