import { CHORD_TOL_MM, LENGTH_TOL_MM, EPS_MM } from './epsilon';
import type { Mat3 } from './mat3';
import type { Rect } from './rect';
import { rectUnion } from './rect';
import type { ClosestPointResult } from './line';
import { lineSeg } from './line';
import type { Segment } from './segment';
import {
  closestPointOnSegment,
  segmentBounds,
  segmentEnd,
  segmentLength,
  segmentPointAt,
  segmentReverse,
  segmentSplitAt,
  segmentStart,
  segmentTAtLength,
  segmentToPolyline,
  transformSegment,
} from './segment';
import type { Vec2 } from './vec2';
import { distance, equals } from './vec2';

/**
 * Cadena de segmentos consecutivos.
 *
 * Es el nivel en el que empieza a existir una PIEZA: el contorno de un
 * delantero es una secuencia de rectas y curvas que comparten extremos. La
 * continuidad C0 —cada segmento arranca donde acaba el anterior— es un
 * invariante que este módulo no impone al construir pero sí sabe comprobar,
 * con `validateContour`.
 *
 * En la Fase 3 los extremos pasarán a referenciarse por identidad, y entonces
 * la continuidad dejará de ser comprobable para pasar a ser estructural.
 */
export interface Contour {
  readonly segments: readonly Segment[];
  readonly closed: boolean;
}

export const contour = (segments: readonly Segment[], closed = false): Contour => ({
  segments,
  closed,
});

export const emptyContour: Contour = Object.freeze({
  segments: Object.freeze([]) as readonly Segment[],
  closed: false,
});

/** Polilínea cerrada o abierta a partir de una lista de vértices. */
export function contourFromPoints(points: readonly Vec2[], closed = false): Contour {
  const segments: Segment[] = [];

  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a === undefined || b === undefined) continue;
    segments.push(lineSeg(a, b));
  }

  const first = points[0];
  const last = points.at(-1);
  if (closed && first !== undefined && last !== undefined && !equals(first, last)) {
    segments.push(lineSeg(last, first));
  }

  return contour(segments, closed);
}

export const isEmptyContour = (c: Contour): boolean => c.segments.length === 0;

export function contourStart(c: Contour): Vec2 | null {
  const first = c.segments[0];
  return first === undefined ? null : segmentStart(first);
}

export function contourEnd(c: Contour): Vec2 | null {
  const last = c.segments.at(-1);
  return last === undefined ? null : segmentEnd(last);
}

export function contourLength(c: Contour, tolerance: number = LENGTH_TOL_MM): number {
  let total = 0;
  for (const segment of c.segments) total += segmentLength(segment, tolerance);
  return total;
}

/** Longitudes individuales. Se calcula una vez y se reutiliza en las búsquedas. */
export function segmentLengths(
  c: Contour,
  tolerance: number = LENGTH_TOL_MM,
): readonly number[] {
  return c.segments.map((segment) => segmentLength(segment, tolerance));
}

export function contourBounds(c: Contour): Rect | null {
  let result: Rect | null = null;

  for (const segment of c.segments) {
    const bounds = segmentBounds(segment);
    result = result === null ? bounds : rectUnion(result, bounds);
  }

  return result;
}

/**
 * Invierte el sentido de recorrido.
 *
 * Hay que invertir la lista Y cada segmento: sólo con lo primero, los
 * segmentos quedarían encadenados fin contra fin. El sentido de recorrido no
 * es cosmético — determina hacia dónde apunta la normal y, con ella, el lado
 * al que se añade el margen de costura.
 */
export const contourReverse = (c: Contour): Contour =>
  contour(c.segments.map(segmentReverse).reverse(), c.closed);

export function contourTransform(c: Contour, m: Mat3): Contour {
  const segments: Segment[] = [];
  for (const segment of c.segments) segments.push(...transformSegment(segment, m));
  return contour(segments, c.closed);
}

/**
 * Aproxima el contorno completo por una polilínea.
 *
 * Los extremos compartidos entre segmentos consecutivos aparecen dos veces —
 * como final de uno y principio del siguiente — y se eliminan al vuelo. Un
 * vértice duplicado genera una arista de longitud cero, que más adelante
 * produce normales indefinidas y triángulos degenerados en la malla.
 */
export function contourToPolyline(
  c: Contour,
  tolerance: number = CHORD_TOL_MM,
): Vec2[] {
  const points: Vec2[] = [];

  for (const segment of c.segments) {
    for (const point of segmentToPolyline(segment, tolerance)) {
      const previous = points.at(-1);
      if (previous !== undefined && equals(previous, point)) continue;
      points.push(point);
    }
  }

  // En un contorno cerrado, el primer y el último vértice son el mismo punto.
  if (c.closed && points.length > 1) {
    const first = points[0];
    const last = points.at(-1);
    if (first !== undefined && last !== undefined && equals(first, last)) points.pop();
  }

  return points;
}

/** Posición dentro del contorno, expresada de forma independiente del zoom. */
export interface ContourLocation {
  readonly segmentIndex: number;
  /** Parámetro dentro de ese segmento. */
  readonly t: number;
  /** Longitud recorrida desde el origen del contorno, en mm. */
  readonly arcLength: number;
  readonly point: Vec2;
}

/**
 * Localiza el punto situado a `arcLengthMm` del origen del contorno.
 *
 * Es la primitiva sobre la que se apoyará todo lo métrico de la Fase 3: los
 * piquetes se guardan como `(arista, longitud de arco)` y NUNCA como
 * coordenada absoluta, para que sobrevivan a cualquier cambio de medidas.
 *
 * La búsqueda es lineal sobre los segmentos. Con contornos de decenas de
 * segmentos es irrelevante; si algún día deja de serlo, la suma acumulada se
 * precalcula y se busca por bisección sin tocar esta interfaz.
 */
export function contourLocationAtLength(
  c: Contour,
  arcLengthMm: number,
  tolerance: number = LENGTH_TOL_MM,
): ContourLocation | null {
  const first = c.segments[0];
  if (first === undefined) return null;

  if (arcLengthMm <= 0) {
    return { segmentIndex: 0, t: 0, arcLength: 0, point: segmentStart(first) };
  }

  let consumed = 0;

  for (let i = 0; i < c.segments.length; i++) {
    const segment = c.segments[i];
    if (segment === undefined) continue;

    const length = segmentLength(segment, tolerance);

    if (consumed + length >= arcLengthMm - EPS_MM) {
      const local = arcLengthMm - consumed;
      const t = segmentTAtLength(segment, local);
      return {
        segmentIndex: i,
        t,
        arcLength: arcLengthMm,
        point: segmentPointAt(segment, t),
      };
    }

    consumed += length;
  }

  const last = c.segments.at(-1);
  if (last === undefined) return null;

  return {
    segmentIndex: c.segments.length - 1,
    t: 1,
    arcLength: consumed,
    point: segmentEnd(last),
  };
}

/**
 * Parte el contorno por una LONGITUD DE ARCO, no por un índice de segmento.
 *
 * El corte cae casi siempre en mitad de un segmento, que se subdivide de forma
 * exacta —De Casteljau para las cúbicas— sin aproximar la geometría.
 *
 * Es la operación que hace posible casar una copa de manga con su sisa: la copa
 * se traza como una sola curva y se parte por el punto que corresponde a la
 * unión del delantero con la espalda, de modo que cada mitad mide exactamente
 * lo que su sisa. Sin ella habría que dibujar las dos mitades por separado y
 * confiar en que empalmaran.
 */
export function splitContourAtLength(
  c: Contour,
  arcLengthMm: number,
  tolerance: number = LENGTH_TOL_MM,
): [Segment[], Segment[]] {
  const location = contourLocationAtLength(c, arcLengthMm, tolerance);
  if (location === null) return [[], [...c.segments]];

  const before: Segment[] = c.segments.slice(0, location.segmentIndex);
  const after: Segment[] = c.segments.slice(location.segmentIndex + 1);

  const cut = c.segments[location.segmentIndex];
  if (cut === undefined) return [before, after];

  const [head, tail] = segmentSplitAt(cut, location.t);

  // Un corte justo en una juntura no debe dejar un segmento de longitud cero.
  if (segmentLength(head, tolerance) > tolerance) before.push(head);
  if (segmentLength(tail, tolerance) > tolerance) after.unshift(tail);

  return [before, after];
}

export function contourPointAtLength(
  c: Contour,
  arcLengthMm: number,
  tolerance: number = LENGTH_TOL_MM,
): Vec2 | null {
  return contourLocationAtLength(c, arcLengthMm, tolerance)?.point ?? null;
}

export interface ContourClosestPoint extends ClosestPointResult {
  readonly segmentIndex: number;
}

export function closestPointOnContour(c: Contour, p: Vec2): ContourClosestPoint | null {
  let best: ContourClosestPoint | null = null;

  for (let i = 0; i < c.segments.length; i++) {
    const segment = c.segments[i];
    if (segment === undefined) continue;

    const candidate = closestPointOnSegment(segment, p);
    if (best === null || candidate.distance < best.distance) {
      best = { ...candidate, segmentIndex: i };
    }
  }

  return best;
}

/* ------------------------------------------------------------- validación */

export type ContourIssue =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'gap';
      readonly segmentIndex: number;
      readonly gapMm: number;
    }
  | { readonly kind: 'not-closed'; readonly gapMm: number }
  | { readonly kind: 'zero-length'; readonly segmentIndex: number };

/**
 * Comprueba los invariantes del contorno.
 *
 * Se ejecuta tras cada regeneración paramétrica, no sólo en los tests: un
 * hueco de 0.2 mm entre dos segmentos es invisible en pantalla, pasa por el
 * exportador sin protestar, y reaparece como un agujero en la malla o como una
 * costura que no cierra, a varias fases de distancia de su causa.
 */
export function validateContour(
  c: Contour,
  tolerance: number = EPS_MM * 1000,
): ContourIssue[] {
  const issues: ContourIssue[] = [];

  if (c.segments.length === 0) return [{ kind: 'empty' }];

  for (let i = 0; i < c.segments.length; i++) {
    const segment = c.segments[i];
    if (segment === undefined) continue;

    if (segmentLength(segment) <= tolerance) {
      issues.push({ kind: 'zero-length', segmentIndex: i });
    }

    const next = c.segments[i + 1];
    if (next === undefined) continue;

    const gap = distance(segmentEnd(segment), segmentStart(next));
    if (gap > tolerance) issues.push({ kind: 'gap', segmentIndex: i, gapMm: gap });
  }

  if (c.closed) {
    const start = contourStart(c);
    const end = contourEnd(c);
    if (start !== null && end !== null) {
      const gap = distance(end, start);
      if (gap > tolerance) issues.push({ kind: 'not-closed', gapMm: gap });
    }
  }

  return issues;
}

export const isValidContour = (c: Contour, tolerance?: number): boolean =>
  validateContour(c, tolerance).length === 0;
