import type { Contour } from '@core/geometry/contour';
import { contour, contourLength, splitContourAtLength } from '@core/geometry/contour';
import type { CubicSeg } from '@core/geometry/cubic';
import { lineSeg } from '@core/geometry/line';
import type { Mat3 } from '@core/geometry/mat3';
import { solveIncreasing } from '@core/numeric/solve';
import { segmentReverse } from '@core/geometry/segment';
import { catmullRomToCubics } from '@core/geometry/spline';
import type { Vec2 } from '@core/geometry/vec2';
import { add, perpLeft, scale, sub, vec2 } from '@core/geometry/vec2';

import { edgeLength, findEdge } from '../edge';
import { edgeId } from '../ids';
import { createNotch } from '../notch';
import type { Notch, PatternPiece } from '../types';

import { assemblePanel, label, verticalGrain } from './assemble';

/** Desviaciones de la copa respecto a su diagonal, en mm. */
const CAP_HOLLOW = 5;
const CAP_BULGE_FRONT = 13;
const CAP_BULGE_BACK = 18;

/** Posición de los piquetes sobre la sisa, como fracción desde la axila. */
export const FRONT_ARMHOLE_NOTCH = 0.35;
export const BACK_ARMHOLE_NOTCH = 0.4;

export interface SleeveSpec {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly wristWidth: number;
  readonly armLength: number;
  /** Longitud medida de la sisa delantera. */
  readonly frontArmhole: number;
  readonly backArmhole: number;
  readonly capEase: number;
  /** Parte del embebido que se lleva el delantero, de 0 a 1. */
  readonly frontEaseShare: number;
  readonly placement: Mat3;
}

export interface SleeveBlock {
  readonly piece: PatternPiece;
  readonly capHeight: number;
  readonly points: Readonly<Record<string, Vec2>>;
  readonly warnings: readonly string[];
}

/**
 * Media copa, por el método clásico de desviaciones sobre la diagonal.
 *
 * El trazado de taller marca la diagonal del sobaco a lo alto de la copa, la
 * divide en cuartos y desvía la curva: hacia DENTRO en el primer cuarto —el
 * hueco que permite bajar el brazo— y hacia FUERA en el tercero —la comba que
 * da volumen al hombro—.
 *
 * Sin el hueco la copa sería una cúpula: la longitud casaría con la sisa y la
 * manga tiraría igualmente, porque la sisa sí lo tiene.
 */
function capHalf(underarm: Vec2, apex: Vec2, bulge: number): CubicSeg[] {
  const chord = sub(apex, underarm);
  const span = Math.hypot(chord.x, chord.y);
  if (span <= 0) return [];

  const direction = vec2(chord.x / span, chord.y / span);

  // Normal orientada hacia FUERA: al mismo lado que el sobaco.
  const candidate = perpLeft(direction);
  const outward =
    Math.sign(candidate.x) === Math.sign(underarm.x) ? candidate : scale(candidate, -1);

  const along = (fraction: number): Vec2 => add(underarm, scale(direction, span * fraction));

  return catmullRomToCubics(
    [
      underarm,
      add(along(0.25), scale(outward, -CAP_HOLLOW)),
      along(0.5),
      add(along(0.75), scale(outward, bulge)),
      apex,
    ],
    {
      startTangent: vec2(0, span * 0.3),
      endTangent: vec2(-Math.sign(underarm.x) * span * 0.3, 0),
    },
  );
}

/** Copa completa, del sobaco delantero al trasero pasando por lo alto. */
function capContour(width: number, height: number): Contour {
  const half = width / 2;
  const apex = vec2(0, height);

  return contour(
    [
      ...capHalf(vec2(-half, 0), apex, CAP_BULGE_FRONT),
      ...capHalf(vec2(half, 0), apex, CAP_BULGE_BACK).map(segmentReverse).reverse(),
    ],
    false,
  );
}

/**
 * MANGA MONTADA — el bloque que comparten blusa y vestido.
 *
 * ── El casamiento ──────────────────────────────────────────────────────────
 *
 * Se resuelve la ALTURA de copa que hace que la curva mida la sisa más el
 * embebido. La anchura no se toca: la dicta el brazo, y estrecharla para
 * cuadrar longitudes daría una manga que no entra.
 *
 * La copa se traza como UNA curva y se parte por el punto que corresponde al
 * encuentro delantero-espalda, de modo que cada mitad mide exactamente lo que
 * su sisa más su parte del embebido — por construcción, no por ajuste.
 */
export function sleeveBlock(spec: SleeveSpec): SleeveBlock {
  const warnings: string[] = [];
  const targetCap = spec.frontArmhole + spec.backArmhole + spec.capEase;

  if (spec.width >= targetCap) {
    warnings.push(
      'La manga es más ancha que la sisa: no hay altura de copa que case. Reduce la holgura de brazo.',
    );
  }

  const capHeight = solveIncreasing(
    (height) => contourLength(capContour(spec.width, height), 1e-6),
    targetCap,
    0,
    Math.max(targetCap, spec.width * 2),
    { tolerance: 1e-6 },
  );

  const cap = capContour(spec.width, capHeight);
  const frontCapLength = spec.frontArmhole + spec.capEase * spec.frontEaseShare;
  const [frontCap, backCap] = splitContourAtLength(cap, frontCapLength);

  const half = spec.width / 2;
  const halfWrist = spec.wristWidth / 2;

  const points = {
    underarmFront: vec2(-half, 0),
    underarmBack: vec2(half, 0),
    wristFront: vec2(-halfWrist, -spec.armLength),
    wristBack: vec2(halfWrist, -spec.armLength),
    capTop: vec2(0, capHeight),
  };

  const piece = assemblePanel({
    id: spec.id,
    name: spec.name,
    edges: [
      {
        name: 'wrist',
        role: 'hem',
        segments: [lineSeg(points.wristFront, points.wristBack)],
        label: 'bajo de manga',
      },
      {
        name: 'underarmBack',
        role: 'underarm',
        segments: [lineSeg(points.wristBack, points.underarmBack)],
        label: 'costura de manga',
      },
      {
        name: 'capBack',
        role: 'sleeve-cap',
        segments: backCap.map(segmentReverse).reverse(),
        label: 'copa · espalda',
      },
      {
        name: 'capFront',
        role: 'sleeve-cap',
        segments: frontCap.map(segmentReverse).reverse(),
        label: 'copa · delantero',
      },
      {
        name: 'underarmFront',
        role: 'underarm',
        segments: [lineSeg(points.underarmFront, points.wristFront)],
        label: 'costura de manga',
      },
    ],
    grainLine: verticalGrain(vec2(0, capHeight - spec.armLength * 0.4), spec.armLength * 0.6),
    labels: [label(`${spec.name.toUpperCase()} · 2`, vec2(0, -spec.armLength * 0.45))],
    placement: spec.placement,
    cutCount: 2,
  });

  return { piece: { ...piece, notches: capNotches(piece, spec.id) }, capHeight, points, warnings };
}

/**
 * Piquetes de la copa, en la posición PROPORCIONAL a los de la sisa.
 *
 * No a la misma distancia: la copa es más larga, y repartir el embebido de
 * forma uniforme a lo largo de la costura es lo que hace una costurera al
 * montar la manga.
 */
function capNotches(piece: PatternPiece, id: string): Notch[] {
  const notches: Notch[] = [];

  const front = findEdge(piece, edgeId(id, 'capFront'));
  if (front !== undefined) {
    // La arista se recorre de la copa al sobaco, así que se mide al revés.
    notches.push(
      createNotch(
        {
          edge: front.id,
          arcLength: edgeLength(piece, front) * (1 - FRONT_ARMHOLE_NOTCH),
          type: 'single',
        },
        0,
      ),
    );
  }

  const back = findEdge(piece, edgeId(id, 'capBack'));
  if (back !== undefined) {
    notches.push(
      createNotch(
        { edge: back.id, arcLength: edgeLength(piece, back) * BACK_ARMHOLE_NOTCH, type: 'double' },
        0,
      ),
    );
  }

  return notches;
}
