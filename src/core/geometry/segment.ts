import { safeNewton } from '../numeric/solve';

import type { ArcSeg } from './arc';
import {
  arcBounds,
  arcContainsAngle,
  arcLength,
  arcNormal,
  arcPointAt,
  arcReverse,
  arcSplitAt,
  arcStart,
  arcTAtLength,
  arcTangent,
  arcToCubics,
  arcToPolyline,
  arcTransform,
} from './arc';
import type { CubicSeg } from './cubic';
import {
  cubicBounds,
  cubicDerivative,
  cubicFromLine,
  cubicLength,
  cubicNormal,
  cubicPointAt,
  cubicReverse,
  cubicSecondDerivative,
  cubicSplitAt,
  cubicTAtLength,
  cubicTangent,
  cubicToPolyline,
  cubicTransform,
} from './cubic';
import { CHORD_TOL_MM, LENGTH_TOL_MM, EPS_MM, isZero } from './epsilon';
import { clamp } from './math';
import type { LineSeg, ClosestPointResult } from './line';
import {
  closestPointOnLine,
  lineBounds,
  lineLength,
  lineNormal,
  linePointAt,
  lineReverse,
  lineSplitAt,
  lineTAtLength,
  lineTangent,
  lineToPolyline,
  lineTransform,
} from './line';
import type { Mat3 } from './mat3';
import { isSimilarity } from './mat3';
import type { Rect } from './rect';
import type { Vec2 } from './vec2';
import { angleOf, distance, dot, lengthSq, normalize, sub } from './vec2';

/**
 * Segmento de contorno: recta, cúbica o arco.
 *
 * Es una unión discriminada de OBJETOS PLANOS, no una jerarquía de clases con
 * métodos. La diferencia es deliberada y tiene tres consecuencias que importan
 * a largo plazo:
 *
 *   · Serializa a JSON sin ceremonia — el documento del patrón se guarda,
 *     se versiona y se compara tal cual.
 *   · Cruza la frontera de un Worker o de WebAssembly sin envolver ni
 *     reconstruir prototipos (Fases 13 y siguientes).
 *   · El `switch` sobre `kind` da comprobación de exhaustividad: añadir un
 *     cuarto tipo de segmento produce errores de compilación en TODOS los
 *     sitios que haya que actualizar, en lugar de fallos silenciosos.
 */
export type Segment = LineSeg | CubicSeg | ArcSeg;

/* -------------------------------------------------------------- evaluación */

export function segmentPointAt(segment: Segment, t: number): Vec2 {
  switch (segment.kind) {
    case 'line':
      return linePointAt(segment, t);
    case 'cubic':
      return cubicPointAt(segment, t);
    case 'arc':
      return arcPointAt(segment, t);
  }
}

export const segmentStart = (segment: Segment): Vec2 => segmentPointAt(segment, 0);
export const segmentEnd = (segment: Segment): Vec2 => segmentPointAt(segment, 1);

/** Tangente UNITARIA en el sentido de recorrido. */
export function segmentTangent(segment: Segment, t: number): Vec2 {
  switch (segment.kind) {
    case 'line':
      return normalize(lineTangent(segment));
    case 'cubic':
      return cubicTangent(segment, t);
    case 'arc':
      return arcTangent(segment, t);
  }
}

/**
 * Normal unitaria a la IZQUIERDA del sentido de recorrido.
 *
 * Fijar el lado por convenio, y no por el signo de una distancia, es lo que
 * hará inequívoco el margen de costura: con los contornos recorridos en
 * sentido antihorario, la normal izquierda apunta siempre hacia el interior de
 * la pieza.
 */
export function segmentNormal(segment: Segment, t: number): Vec2 {
  switch (segment.kind) {
    case 'line':
      return lineNormal(segment);
    case 'cubic':
      return cubicNormal(segment, t);
    case 'arc':
      return arcNormal(segment, t);
  }
}

/* --------------------------------------------------------------- topología */

export function segmentReverse(segment: Segment): Segment {
  switch (segment.kind) {
    case 'line':
      return lineReverse(segment);
    case 'cubic':
      return cubicReverse(segment);
    case 'arc':
      return arcReverse(segment);
  }
}

export function segmentSplitAt(segment: Segment, t: number): [Segment, Segment] {
  switch (segment.kind) {
    case 'line':
      return lineSplitAt(segment, t);
    case 'cubic':
      return cubicSplitAt(segment, t);
    case 'arc':
      return arcSplitAt(segment, t);
  }
}

export function segmentBounds(segment: Segment): Rect {
  switch (segment.kind) {
    case 'line':
      return lineBounds(segment);
    case 'cubic':
      return cubicBounds(segment);
    case 'arc':
      return arcBounds(segment);
  }
}

/* ---------------------------------------------------------------- longitud */

export function segmentLength(segment: Segment, tolerance: number = LENGTH_TOL_MM): number {
  switch (segment.kind) {
    case 'line':
      return lineLength(segment);
    case 'cubic':
      return cubicLength(segment, tolerance);
    case 'arc':
      return arcLength(segment);
  }
}

/** Parámetro alcanzado tras recorrer `arcLengthMm` desde el origen. */
export function segmentTAtLength(segment: Segment, arcLengthMm: number): number {
  switch (segment.kind) {
    case 'line':
      return lineTAtLength(segment, arcLengthMm);
    case 'cubic':
      return cubicTAtLength(segment, arcLengthMm);
    case 'arc':
      return arcTAtLength(segment, arcLengthMm);
  }
}

/**
 * Punto situado a `arcLengthMm` del origen, MEDIDO SOBRE LA CURVA.
 *
 * No es lo mismo que `segmentPointAt`: en una cúbica el parámetro no avanza en
 * proporción a la longitud recorrida. Toda colocación métrica —piquetes,
 * reparto de embebido, muestreo emparejable de aristas cosidas— usa esta
 * función y nunca el parámetro directamente.
 */
export const segmentPointAtLength = (segment: Segment, arcLengthMm: number): Vec2 =>
  segmentPointAt(segment, segmentTAtLength(segment, arcLengthMm));

/* ------------------------------------------------------------- aplanamiento */

export function segmentToPolyline(
  segment: Segment,
  tolerance: number = CHORD_TOL_MM,
): Vec2[] {
  switch (segment.kind) {
    case 'line':
      return lineToPolyline(segment);
    case 'cubic':
      return cubicToPolyline(segment, tolerance);
    case 'arc':
      return arcToPolyline(segment, tolerance);
  }
}

/** Expresa cualquier segmento como cúbicas. Para exportar y para transformar. */
export function segmentToCubics(segment: Segment): CubicSeg[] {
  switch (segment.kind) {
    case 'line':
      return [cubicFromLine(segment)];
    case 'cubic':
      return [segment];
    case 'arc':
      return arcToCubics(segment);
  }
}

/* ----------------------------------------------------------- transformación */

/**
 * Transforma un segmento.
 *
 * Devuelve una LISTA porque un arco sometido a una transformación que no es
 * semejanza deja de ser un arco: con escalado no uniforme o cizalla su imagen
 * es una elipse, que este modelo no representa, y hay que sustituirla por
 * varias cúbicas.
 *
 * Rectas y cúbicas son invariantes afines, así que en su caso la lista tiene
 * siempre un elemento.
 */
export function transformSegment(segment: Segment, m: Mat3): Segment[] {
  switch (segment.kind) {
    case 'line':
      return [lineTransform(segment, m)];
    case 'cubic':
      return [cubicTransform(segment, m)];
    case 'arc': {
      if (isSimilarity(m)) {
        const transformed = arcTransform(segment, m);
        if (transformed !== null) return [transformed];
      }
      return arcToCubics(segment).map((c) => cubicTransform(c, m));
    }
  }
}

/* --------------------------------------------------------- punto más próximo */

/** Muestreo inicial antes de refinar por Newton en una cúbica. */
const COARSE_SAMPLES = 24;

/**
 * Punto del segmento más próximo a `p`.
 *
 * Recta y arco tienen solución cerrada. La cúbica no: minimizar
 * `‖B(t) − p‖²` lleva a una quíntica, así que se hace en dos fases —muestreo
 * grueso para localizar el mínimo global y refinamiento de Newton sobre la
 * derivada de la distancia al cuadrado para afinarlo—.
 *
 * El muestreo previo no es opcional: la función distancia de una curva con
 * inflexión tiene varios mínimos locales, y arrancar Newton desde un punto
 * arbitrario converge al equivocado.
 */
export function closestPointOnSegment(segment: Segment, p: Vec2): ClosestPointResult {
  switch (segment.kind) {
    case 'line':
      return closestPointOnLine(segment, p);
    case 'arc':
      return closestPointOnArc(segment, p);
    case 'cubic':
      return closestPointOnCubic(segment, p);
  }
}

export const distancePointToSegment = (segment: Segment, p: Vec2): number =>
  closestPointOnSegment(segment, p).distance;

function closestPointOnArc(arc: ArcSeg, p: Vec2): ClosestPointResult {
  const radial = sub(p, arc.center);

  // En el centro exacto todos los puntos del arco equidistan: se elige el
  // origen. La distancia se mide al punto elegido y no se da por hecho que
  // valga el radio: para una consulta a un nanómetro del centro difieren en
  // ese nanómetro, y el invariante `distance === |p − point|` debe cumplirse
  // siempre, no casi siempre.
  if (isZero(lengthSq(radial), EPS_MM * EPS_MM)) {
    const point = arcStart(arc);
    return { point, t: 0, distance: distance(p, point) };
  }

  const angle = angleOf(radial);

  if (arcContainsAngle(arc, angle)) {
    const direction = arc.sweepAngle >= 0 ? 1 : -1;
    const travelled = ((angle - arc.startAngle) * direction + Math.PI * 4) % (Math.PI * 2);
    const t = Math.abs(arc.sweepAngle) === 0 ? 0 : clamp(travelled / Math.abs(arc.sweepAngle), 0, 1);
    const point = arcPointAt(arc, t);
    return { point, t, distance: distance(p, point) };
  }

  const start = arcPointAt(arc, 0);
  const end = arcPointAt(arc, 1);
  const dStart = distance(p, start);
  const dEnd = distance(p, end);

  return dStart <= dEnd
    ? { point: start, t: 0, distance: dStart }
    : { point: end, t: 1, distance: dEnd };
}

function closestPointOnCubic(c: CubicSeg, p: Vec2): ClosestPointResult {
  let bestT = 0;
  let bestDistSq = Number.POSITIVE_INFINITY;

  for (let i = 0; i <= COARSE_SAMPLES; i++) {
    const t = i / COARSE_SAMPLES;
    const d = lengthSq(sub(cubicPointAt(c, t), p));
    if (d < bestDistSq) {
      bestDistSq = d;
      bestT = t;
    }
  }

  // f(t) = ½·d/dt‖B(t) − p‖² = (B(t) − p) · B'(t)
  const f = (t: number): number => dot(sub(cubicPointAt(c, t), p), cubicDerivative(c, t));
  const df = (t: number): number => {
    const delta = sub(cubicPointAt(c, t), p);
    const velocity = cubicDerivative(c, t);
    return dot(velocity, velocity) + dot(delta, cubicSecondDerivative(c, t));
  };

  const window = 1 / COARSE_SAMPLES;
  const lo = Math.max(0, bestT - window);
  const hi = Math.min(1, bestT + window);

  const refined = clamp(safeNewton(f, df, lo, hi, bestT, { tolerance: 1e-10 }), 0, 1);

  // Newton puede empeorar si el mínimo cae en un extremo del intervalo.
  const candidates = [bestT, refined, 0, 1];
  let winner = bestT;
  let winnerDist = Number.POSITIVE_INFINITY;

  for (const t of candidates) {
    const d = distance(cubicPointAt(c, t), p);
    if (d < winnerDist) {
      winnerDist = d;
      winner = t;
    }
  }

  return { point: cubicPointAt(c, winner), t: winner, distance: winnerDist };
}
