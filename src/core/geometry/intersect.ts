import { rootsInUnitInterval, solveCubic, solveQuadratic } from '../numeric/roots';

import type { ArcSeg } from './arc';
import { arcContainsAngle } from './arc';
import type { CubicSeg } from './cubic';
import { EPS_MM, isZero } from './epsilon';
import { TAU, clamp, normalizeAngle } from './math';
import type { LineSeg } from './line';
import { lineVector } from './line';
import { rectExpand, rectHeight, rectIntersects, rectWidth } from './rect';
import type { Segment } from './segment';
import { segmentBounds, segmentPointAt, segmentSplitAt } from './segment';
import type { Vec2 } from './vec2';
import { add, angleOf, cross, distance, dot, perpLeft, scale, sub, vec2 } from './vec2';

export interface SegmentIntersection {
  readonly point: Vec2;
  /** Parámetro sobre el primer segmento. */
  readonly tA: number;
  /** Parámetro sobre el segundo. */
  readonly tB: number;
}

/** Tolerancia por defecto de las intersecciones, en mm. */
const DEFAULT_TOLERANCE = 1e-7;

/** Holgura al validar parámetros: recupera las tangencias justo en un extremo. */
const PARAM_TOLERANCE = 1e-9;

/**
 * Puntos de corte entre dos segmentos.
 *
 * Se usan fórmulas cerradas siempre que existen —recta×recta, recta×cúbica,
 * recta×arco, arco×arco— y subdivisión recursiva para los pares que no las
 * tienen. Cúbica×cúbica requeriría eliminar una variable entre dos
 * polinomiales de grado 3, lo que da una resultante de grado 9: analíticamente
 * posible, numéricamente pésimo.
 *
 * LIMITACIÓN CONOCIDA: los solapamientos —dos segmentos colineales que
 * comparten un tramo, o dos arcos concéntricos del mismo radio— no producen
 * puntos discretos y se devuelven como lista vacía. Es lo correcto (el
 * conjunto solución no es un punto), pero quien busque solapamientos ha de
 * comprobarlos aparte.
 */
export function intersectSegments(
  a: Segment,
  b: Segment,
  tolerance: number = DEFAULT_TOLERANCE,
): SegmentIntersection[] {
  if (a.kind === 'line' && b.kind === 'line') return intersectLineLine(a, b);
  if (a.kind === 'line' && b.kind === 'cubic') return intersectLineCubic(a, b);
  if (a.kind === 'cubic' && b.kind === 'line') return flip(intersectLineCubic(b, a));
  if (a.kind === 'line' && b.kind === 'arc') return intersectLineArc(a, b);
  if (a.kind === 'arc' && b.kind === 'line') return flip(intersectLineArc(b, a));
  if (a.kind === 'arc' && b.kind === 'arc') return intersectArcArc(a, b);

  return intersectBySubdivision(a, b, tolerance);
}

const flip = (results: readonly SegmentIntersection[]): SegmentIntersection[] =>
  results.map((r) => ({ point: r.point, tA: r.tB, tB: r.tA }));

const inUnit = (t: number): boolean => t >= -PARAM_TOLERANCE && t <= 1 + PARAM_TOLERANCE;

/* ------------------------------------------------------------ recta × recta */

/**
 * Intersección de dos segmentos rectos.
 *
 * Con `p + t·r` y `q + u·s`, igualar y multiplicar vectorialmente por `s`
 * elimina `u`:
 *
 *     t = ((q − p) × s) / (r × s)        u = ((q − p) × r) / (r × s)
 *
 * `r × s = 0` significa paralelismo. El caso colineal solapado se descarta
 * conscientemente: su solución es un segmento, no un punto.
 */
export function intersectLineLine(a: LineSeg, b: LineSeg): SegmentIntersection[] {
  const r = lineVector(a);
  const s = lineVector(b);
  const denominator = cross(r, s);

  if (isZero(denominator, 1e-14)) return [];

  const qp = sub(b.a, a.a);
  const tA = cross(qp, s) / denominator;
  const tB = cross(qp, r) / denominator;

  if (!inUnit(tA) || !inUnit(tB)) return [];

  const t = clamp(tA, 0, 1);
  return [{ point: add(a.a, scale(r, t)), tA: t, tB: clamp(tB, 0, 1) }];
}

/* ----------------------------------------------------------- recta × cúbica */

/**
 * Intersección de un segmento recto con una cúbica.
 *
 * Se sustituye la curva en la ECUACIÓN IMPLÍCITA de la recta. Con `n` la
 * normal de la recta y `gᵢ = n·(Pᵢ − a)`, la función
 * `f(t) = n·(B(t) − a)` es un polinomio cúbico en `t` cuyos coeficientes de
 * Bernstein son precisamente los `gᵢ`. Sus raíces son los parámetros donde la
 * curva cruza la RECTA INFINITA; después se comprueba que el punto caiga
 * dentro del segmento.
 *
 * Es una reducción muy favorable: pasar de un problema geométrico a buscar las
 * raíces de una cúbica, para las que hay fórmula cerrada estable.
 */
export function intersectLineCubic(line: LineSeg, curve: CubicSeg): SegmentIntersection[] {
  const direction = lineVector(line);
  const lengthSq = dot(direction, direction);
  if (isZero(lengthSq, 1e-18)) return [];

  const normal = perpLeft(direction);
  const g = [curve.p0, curve.p1, curve.p2, curve.p3].map((p) => dot(normal, sub(p, line.a)));
  const [g0, g1, g2, g3] = g;
  if (g0 === undefined || g1 === undefined || g2 === undefined || g3 === undefined) return [];

  // Bernstein → base de potencias.
  const roots = solveCubic(
    g3 - 3 * g2 + 3 * g1 - g0,
    3 * g2 - 6 * g1 + 3 * g0,
    3 * g1 - 3 * g0,
    g0,
  );

  const results: SegmentIntersection[] = [];

  for (const tCurve of rootsInUnitInterval(roots)) {
    const point = segmentPointAt(curve, tCurve);
    const tLine = dot(sub(point, line.a), direction) / lengthSq;
    if (!inUnit(tLine)) continue;

    results.push({ point, tA: clamp(tLine, 0, 1), tB: tCurve });
  }

  return dedupe(results, EPS_MM);
}

/* -------------------------------------------------------------- recta × arco */

/**
 * Intersección de un segmento recto con un arco.
 *
 * Sustituyendo `P(u) = a + u·d` en `‖P − C‖² = R²` se obtiene la cuadrática
 *
 *     (d·d)·u² + 2(f·d)·u + (f·f − R²) = 0,     f = a − C
 *
 * Las raíces dan los cortes con la CIRCUNFERENCIA completa; queda filtrar los
 * que caen dentro del barrido del arco, que es lo que distingue un arco de su
 * circunferencia soporte.
 */
export function intersectLineArc(line: LineSeg, arc: ArcSeg): SegmentIntersection[] {
  const d = lineVector(line);
  const f = sub(line.a, arc.center);

  const roots = solveQuadratic(dot(d, d), 2 * dot(f, d), dot(f, f) - arc.radius * arc.radius);
  const results: SegmentIntersection[] = [];

  for (const u of roots) {
    if (!inUnit(u)) continue;

    const point = add(line.a, scale(d, u));
    const angle = angleOf(sub(point, arc.center));
    if (!arcContainsAngle(arc, angle)) continue;

    results.push({ point, tA: clamp(u, 0, 1), tB: arcTAtAngle(arc, angle) });
  }

  return dedupe(results, EPS_MM);
}

/* --------------------------------------------------------------- arco × arco */

/**
 * Intersección de dos arcos.
 *
 * Geometría de dos circunferencias: sobre la recta de centros, a distancia
 * `a = (d² + R₁² − R₂²) / 2d` del primero, se levanta una perpendicular de
 * semilongitud `h = √(R₁² − a²)` cuyos extremos son los dos cortes.
 *
 * Circunferencias coincidentes producen infinitos puntos y se descartan, igual
 * que las rectas colineales.
 */
export function intersectArcArc(a: ArcSeg, b: ArcSeg): SegmentIntersection[] {
  const between = sub(b.center, a.center);
  const d = Math.hypot(between.x, between.y);

  if (isZero(d, 1e-12)) return []; // concéntricas
  if (d > a.radius + b.radius + EPS_MM) return [];
  if (d < Math.abs(a.radius - b.radius) - EPS_MM) return [];

  const projection = (d * d + a.radius * a.radius - b.radius * b.radius) / (2 * d);
  const heightSq = a.radius * a.radius - projection * projection;
  const height = heightSq <= 0 ? 0 : Math.sqrt(heightSq);

  const unit = vec2(between.x / d, between.y / d);
  const base = add(a.center, scale(unit, projection));
  const offset = scale(perpLeft(unit), height);

  const candidates = height === 0 ? [base] : [add(base, offset), sub(base, offset)];
  const results: SegmentIntersection[] = [];

  for (const point of candidates) {
    const angleA = angleOf(sub(point, a.center));
    const angleB = angleOf(sub(point, b.center));
    if (!arcContainsAngle(a, angleA) || !arcContainsAngle(b, angleB)) continue;

    results.push({ point, tA: arcTAtAngle(a, angleA), tB: arcTAtAngle(b, angleB) });
  }

  return dedupe(results, EPS_MM);
}

/** Parámetro del arco correspondiente a un ángulo que sabemos contenido. */
function arcTAtAngle(arc: ArcSeg, angle: number): number {
  const sweep = Math.abs(arc.sweepAngle);
  if (sweep === 0) return 0;

  const direction = arc.sweepAngle >= 0 ? 1 : -1;
  const travelled = normalizeAngle((angle - arc.startAngle) * direction);

  // Un ángulo justo antes del inicio se normaliza a casi 2π; se trata como 0.
  const corrected = travelled > sweep && TAU - travelled < EPS_MM ? 0 : travelled;
  return clamp(corrected / sweep, 0, 1);
}

/* ------------------------------------------------------ subdivisión genérica */

/**
 * Techo de recursión.
 *
 * Cada nivel parte UNO de los dos segmentos, así que alcanzar una resolución
 * `r` partiendo de un tamaño `S` exige del orden de `2·log₂(S/r)` niveles. Para
 * una pieza de 500 mm y una tolerancia de 1e-6 mm son ~58. Un techo de 30
 * —que parecía holgado— dejaba las celdas en 0.005 mm y hacía que un mismo
 * cruce se reportara dos veces.
 */
const MAX_SUBDIVISION_DEPTH = 64;

/**
 * Tope de hojas recogidas. Acota el caso patológico de dos curvas solapadas,
 * donde ninguna subdivisión llega a separarlas. Holgado a propósito: si el tope
 * se alcanza con cruces normales, la exploración se corta y se PIERDEN
 * intersecciones, que es peor que tardar.
 */
const MAX_RESULTS = 256;

/**
 * Intersección por subdivisión recursiva de cajas envolventes.
 *
 * Si las cajas de dos trozos no se tocan, esos trozos no pueden cortarse: se
 * poda la rama. Si se tocan, se parte por la mitad el trozo mayor y se repite.
 * Cuando ambos son menores que la tolerancia, su solapamiento se reporta como
 * un punto.
 *
 * Es un método sólido y sin casos especiales, y funciona para cualquier par de
 * tipos porque sólo necesita `segmentBounds` y `segmentSplitAt`. A cambio,
 * converge linealmente —una bisección por nivel— frente a la convergencia
 * inmediata de las fórmulas cerradas, de ahí que se reserve para los pares que
 * no las tienen.
 *
 * `MAX_RESULTS` acota el caso patológico de dos curvas que se solapan en un
 * tramo, donde toda la región se subdivide sin llegar a separarse nunca.
 */
interface Candidate {
  readonly tA: number;
  readonly tB: number;
  /** Semianchura en parámetro de la celda, en cada curva. */
  readonly spanA: number;
  readonly spanB: number;
  /** Tamaño espacial de la celda: resolución REAL alcanzada. */
  readonly resolution: number;
}

export function intersectBySubdivision(
  a: Segment,
  b: Segment,
  tolerance: number = DEFAULT_TOLERANCE,
): SegmentIntersection[] {
  const candidates: Candidate[] = [];
  recurse(a, 0, 1, b, 0, 1, tolerance, 0, candidates);
  if (candidates.length === 0) return [];

  const results: SegmentIntersection[] = [];

  /*
   * La resolución REALMENTE alcanzada puede ser peor que la pedida si se agotó
   * la profundidad. Verificar con la tolerancia solicitada en ese caso sería
   * mentirse: se usa la efectiva, que es lo que el método distingue de verdad.
   */
  const achieved = Math.max(...candidates.map((c) => c.resolution), tolerance);
  const verifyTolerance = Math.max(achieved * 8, EPS_MM);

  for (const cluster of clusterByParameter(candidates)) {
    const tA = average(cluster.map((c) => c.tA));
    const tB = average(cluster.map((c) => c.tB));

    const onA = segmentPointAt(a, tA);
    const onB = segmentPointAt(b, tB);

    // Verificación: en un cruce real los dos puntos coinciden. Filtra los
    // falsos positivos que introduce la holgura de las cajas envolventes.
    if (distance(onA, onB) > verifyTolerance) continue;

    results.push({ point: vec2((onA.x + onB.x) / 2, (onA.y + onB.y) / 2), tA, tB });
  }

  return results.sort((x, y) => x.tA - y.tA);
}

const average = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Agrupa las hojas que describen un mismo cruce.
 *
 * Un cruce transversal deja VARIAS hojas contiguas, no una: la recursión llega
 * al tamaño objetivo por caminos distintos y todas ellas contienen el punto.
 *
 * La fusión se hace en ESPACIO DE PARÁMETROS, comparando la separación con la
 * anchura real de las celdas implicadas, y no en distancia contra un múltiplo
 * de la tolerancia. La razón es concreta: dos hojas vecinas resultaron estar a
 * 4.04·tolerancia, de modo que cualquier factor fijo —4 en el primer
 * intento— acierta o falla según la curva. La anchura de celda, en cambio, es
 * exactamente la magnitud que la recursión controla, así que el criterio se
 * ajusta solo y no tiene constantes mágicas.
 *
 * Promediar el grupo mejora además la estimación: la media de varias hojas
 * contiguas es más precisa que el centro de cualquiera de ellas.
 */
function clusterByParameter(candidates: readonly Candidate[]): Candidate[][] {
  const clusters: Candidate[][] = [];

  for (const candidate of candidates) {
    const existing = clusters.find((cluster) =>
      cluster.some(
        (other) =>
          Math.abs(other.tA - candidate.tA) <= other.spanA + candidate.spanA &&
          Math.abs(other.tB - candidate.tB) <= other.spanB + candidate.spanB,
      ),
    );

    if (existing === undefined) clusters.push([candidate]);
    else existing.push(candidate);
  }

  return clusters;
}

function recurse(
  a: Segment,
  a0: number,
  a1: number,
  b: Segment,
  b0: number,
  b1: number,
  tolerance: number,
  depth: number,
  out: Candidate[],
): void {
  if (out.length >= MAX_RESULTS) return;

  const boundsA = segmentBounds(a);
  const boundsB = segmentBounds(b);

  // La holgura sólo interviene en el TEST DE SOLAPAMIENTO, para no perder
  // tangencias por redondeo.
  if (!rectIntersects(rectExpand(boundsA, tolerance), rectExpand(boundsB, tolerance))) return;

  /*
   * El tamaño se mide sobre las cajas SIN expandir. Medirlo sobre las
   * expandidas hacía que `size` nunca bajase de 2·tolerancia y que la
   * condición de parada fuese inalcanzable: la recursión llegaba siempre al
   * techo de profundidad, generaba decenas de hojas por cada cruce y saturaba
   * `MAX_RESULTS` antes de haber explorado los cruces restantes — es decir,
   * PERDÍA intersecciones.
   */
  const sizeA = Math.max(rectWidth(boundsA), rectHeight(boundsA));
  const sizeB = Math.max(rectWidth(boundsB), rectHeight(boundsB));

  if (depth >= MAX_SUBDIVISION_DEPTH || (sizeA <= tolerance && sizeB <= tolerance)) {
    out.push({
      tA: (a0 + a1) / 2,
      tB: (b0 + b1) / 2,
      spanA: Math.abs(a1 - a0) / 2,
      spanB: Math.abs(b1 - b0) / 2,
      resolution: Math.max(sizeA, sizeB),
    });
    return;
  }

  // Se parte siempre el trozo mayor: converge más rápido que alternar.
  if (sizeA >= sizeB) {
    const [left, right] = segmentSplitAt(a, 0.5);
    const mid = (a0 + a1) / 2;
    recurse(left, a0, mid, b, b0, b1, tolerance, depth + 1, out);
    recurse(right, mid, a1, b, b0, b1, tolerance, depth + 1, out);
  } else {
    const [left, right] = segmentSplitAt(b, 0.5);
    const mid = (b0 + b1) / 2;
    recurse(a, a0, a1, left, b0, mid, tolerance, depth + 1, out);
    recurse(a, a0, a1, right, mid, b1, tolerance, depth + 1, out);
  }
}

/** Funde los resultados cuyos puntos disten menos que la tolerancia. */
function dedupe(
  results: readonly SegmentIntersection[],
  tolerance: number,
): SegmentIntersection[] {
  const unique: SegmentIntersection[] = [];

  for (const candidate of results) {
    const duplicate = unique.some((kept) => distance(kept.point, candidate.point) <= tolerance);
    if (!duplicate) unique.push(candidate);
  }

  return unique.sort((x, y) => x.tA - y.tA);
}

/** Punto de corte de dos rectas INFINITAS, ignorando los extremos. */
export function intersectInfiniteLines(a: LineSeg, b: LineSeg): Vec2 | null {
  const r = lineVector(a);
  const s = lineVector(b);
  const denominator = cross(r, s);

  if (isZero(denominator, 1e-14)) return null;

  const t = cross(sub(b.a, a.a), s) / denominator;
  return add(a.a, scale(r, t));
}

/** Punto de corte del arco con el segmento, si existe, más próximo a una referencia. */
export function nearestIntersection(
  results: readonly SegmentIntersection[],
  reference: Vec2,
): SegmentIntersection | null {
  let best: SegmentIntersection | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const result of results) {
    const d = distance(result.point, reference);
    if (d < bestDistance) {
      bestDistance = d;
      best = result;
    }
  }

  return best;
}
