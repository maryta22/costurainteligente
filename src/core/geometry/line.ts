import { isZeroLengthSq } from './epsilon';
import { clamp } from './math';
import type { Mat3 } from './mat3';
import { applyToPoint } from './mat3';
import type { Rect } from './rect';
import { rectFromCorners } from './rect';
import type { Vec2 } from './vec2';
import { add, distance, dot, lengthSq, normalize, perpLeft, scale, sub, vec2 } from './vec2';

/** Segmento recto. Caso `line` de la unión `Segment`. */
export interface LineSeg {
  readonly kind: 'line';
  readonly a: Vec2;
  readonly b: Vec2;
}

export const lineSeg = (a: Vec2, b: Vec2): LineSeg => ({ kind: 'line', a, b });

export const lineVector = (s: LineSeg): Vec2 => sub(s.b, s.a);
export const lineLength = (s: LineSeg): number => distance(s.a, s.b);
export const linePointAt = (s: LineSeg, t: number): Vec2 => add(s.a, scale(lineVector(s), t));
export const lineMidpoint = (s: LineSeg): Vec2 => linePointAt(s, 0.5);
export const lineBounds = (s: LineSeg): Rect => rectFromCorners(s.a, s.b);
export const lineReverse = (s: LineSeg): LineSeg => lineSeg(s.b, s.a);

/** Tangente sin normalizar. Constante a lo largo de todo el segmento. */
export const lineTangent = (s: LineSeg): Vec2 => lineVector(s);

/** Normal unitaria a la izquierda del sentido de recorrido. */
export const lineNormal = (s: LineSeg): Vec2 => normalize(perpLeft(lineVector(s)));

export function lineSplitAt(s: LineSeg, t: number): [LineSeg, LineSeg] {
  const mid = linePointAt(s, t);
  return [lineSeg(s.a, mid), lineSeg(mid, s.b)];
}

export const lineTransform = (s: LineSeg, m: Mat3): LineSeg =>
  lineSeg(applyToPoint(m, s.a), applyToPoint(m, s.b));

/** Una recta ya es su propia polilínea. */
export const lineToPolyline = (s: LineSeg): Vec2[] => [s.a, s.b];

/** Parámetro correspondiente a una longitud recorrida. Lineal por definición. */
export function lineTAtLength(s: LineSeg, arcLength: number): number {
  const total = lineLength(s);
  return total === 0 ? 0 : clamp(arcLength / total, 0, 1);
}

export interface ClosestPointResult {
  /** Punto del segmento más próximo a la consulta. */
  readonly point: Vec2;
  /** Parámetro del punto sobre el segmento, saturado a [0, 1]. */
  readonly t: number;
  /** Distancia entre la consulta y `point`. */
  readonly distance: number;
}

/**
 * Punto del segmento más próximo a `p`.
 *
 * Proyección escalar sobre la dirección del segmento, saturada a [0, 1] para
 * que el resultado no se salga de los extremos:
 *
 *     t = ((p − a) · (b − a)) / ‖b − a‖²
 *
 * El umbral de degeneración se compara contra `EPS_MM²` porque `lenSq` es un
 * ÁREA. Confrontar un cuadrado con una tolerancia lineal desplaza el umbral
 * efectivo a √EPS_MM, mil veces por encima de la política de tolerancias.
 */
export function closestPointOnLine(s: LineSeg, p: Vec2): ClosestPointResult {
  const dir = lineVector(s);
  const lenSq = lengthSq(dir);

  if (isZeroLengthSq(lenSq)) {
    return { point: s.a, t: 0, distance: distance(p, s.a) };
  }

  const t = clamp(dot(sub(p, s.a), dir) / lenSq, 0, 1);
  const point = add(s.a, scale(dir, t));
  return { point, t, distance: distance(p, point) };
}

export function distancePointToLine(s: LineSeg, p: Vec2): number {
  return closestPointOnLine(s, p).distance;
}

/**
 * Valor de la forma implícita de la recta que soporta el segmento.
 *
 * `f(p) = n · (p − a)`, con `n` la normal izquierda sin normalizar. Su signo
 * indica el lado y su magnitud es proporcional a la distancia. Es la primitiva
 * con la que se convierte una intersección recta-curva en la búsqueda de
 * raíces de un polinomio.
 */
export function lineImplicit(s: LineSeg, p: Vec2): number {
  const n = perpLeft(lineVector(s));
  return dot(n, sub(p, s.a));
}

/** Recta infinita que pasa por un punto con una dirección dada, como segmento unitario. */
export const lineThrough = (origin: Vec2, direction: Vec2): LineSeg =>
  lineSeg(origin, add(origin, direction));

/** Pie de la perpendicular desde `p` a la recta INFINITA que soporta el segmento. */
export function perpendicularFoot(s: LineSeg, p: Vec2): Vec2 {
  const dir = lineVector(s);
  const lenSq = lengthSq(dir);
  if (isZeroLengthSq(lenSq)) return s.a;

  const t = dot(sub(p, s.a), dir) / lenSq;
  return add(s.a, scale(dir, t));
}

/** Desplaza el segmento `distanceMm` hacia su normal izquierda. */
export function offsetLine(s: LineSeg, distanceMm: number): LineSeg {
  const n = lineNormal(s);
  const delta = vec2(n.x * distanceMm, n.y * distanceMm);
  return lineSeg(add(s.a, delta), add(s.b, delta));
}
