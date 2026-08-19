import { adaptiveQuadrature } from '../numeric/quadrature';
import { rootsInUnitInterval, solveQuadratic } from '../numeric/roots';
import { safeNewton } from '../numeric/solve';

import { CHORD_TOL_MM, EPS_PARAM, LENGTH_TOL_MM, isZero } from './epsilon';
import { clamp } from './math';
import type { Mat3 } from './mat3';
import { applyToPoint } from './mat3';
import type { LineSeg } from './line';
import type { Rect } from './rect';
import { rectFromPoints } from './rect';
import type { Vec2 } from './vec2';
import { add, length, lerpVec, normalize, perpLeft, scale, sub, vec2 } from './vec2';

/**
 * Curva de Bézier cúbica. Único tipo de curva libre del sistema.
 *
 * La elección está razonada en §3.1 de docs/ARCHITECTURE.md: una sola familia
 * de curvas significa una sola ruta de código para subdividir, aplanar,
 * intersecar, medir y desplazar. Las «curvas francesas» del patronaje
 * tradicional son cúbicas, y cuadráticas y B-splines se convierten a cúbicas
 * sin pérdida.
 */
export interface CubicSeg {
  readonly kind: 'cubic';
  readonly p0: Vec2;
  readonly p1: Vec2;
  readonly p2: Vec2;
  readonly p3: Vec2;
}

export const cubicSeg = (p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): CubicSeg => ({
  kind: 'cubic',
  p0,
  p1,
  p2,
  p3,
});

/** Eleva un segmento recto a cúbica, con los tiradores en los tercios. */
export const cubicFromLine = (s: LineSeg): CubicSeg =>
  cubicSeg(s.a, lerpVec(s.a, s.b, 1 / 3), lerpVec(s.a, s.b, 2 / 3), s.b);

/**
 * Evaluación por el algoritmo de De Casteljau.
 *
 * Se prefiere a la forma de Bernstein por estabilidad numérica: De Casteljau
 * es una cadena de interpolaciones lineales, todas ellas combinaciones convexas
 * de puntos ya calculados, así que ningún resultado intermedio se sale de la
 * envolvente convexa de los puntos de control y no hay cancelación posible.
 * De regalo, deja construida la subdivisión.
 */
export function cubicPointAt(c: CubicSeg, t: number): Vec2 {
  const p01 = lerpVec(c.p0, c.p1, t);
  const p12 = lerpVec(c.p1, c.p2, t);
  const p23 = lerpVec(c.p2, c.p3, t);
  const p012 = lerpVec(p01, p12, t);
  const p123 = lerpVec(p12, p23, t);
  return lerpVec(p012, p123, t);
}

/** Derivada primera: vector velocidad, sin normalizar. */
export function cubicDerivative(c: CubicSeg, t: number): Vec2 {
  const u = 1 - t;
  const d1 = sub(c.p1, c.p0);
  const d2 = sub(c.p2, c.p1);
  const d3 = sub(c.p3, c.p2);

  return scale(
    add(add(scale(d1, u * u), scale(d2, 2 * u * t)), scale(d3, t * t)),
    3,
  );
}

/** Derivada segunda: vector aceleración. */
export function cubicSecondDerivative(c: CubicSeg, t: number): Vec2 {
  const a = add(sub(c.p2, scale(c.p1, 2)), c.p0);
  const b = add(sub(c.p3, scale(c.p2, 2)), c.p1);
  return scale(add(scale(a, 1 - t), scale(b, t)), 6);
}

/**
 * Tangente unitaria, con degradación en los puntos singulares.
 *
 * Cuando dos puntos de control coinciden —caso habitual: un tirador pegado a
 * su extremo para forzar una salida recta— la derivada primera se anula y la
 * dirección queda indefinida. El límite correcto lo da entonces la derivada
 * segunda; si también se anula, la curva es un punto y se recurre a la cuerda.
 *
 * Sin esta cascada aparecen normales nulas justo en los extremos, que es donde
 * se aplican los márgenes de costura y se colocan los piquetes.
 */
export function cubicTangent(c: CubicSeg, t: number): Vec2 {
  const first = cubicDerivative(c, t);
  if (!isZero(length(first))) return normalize(first);

  const second = cubicSecondDerivative(c, t);
  if (!isZero(length(second))) return normalize(second);

  return normalize(sub(c.p3, c.p0));
}

/** Normal unitaria a la izquierda del sentido de recorrido. */
export const cubicNormal = (c: CubicSeg, t: number): Vec2 => perpLeft(cubicTangent(c, t));

export const cubicReverse = (c: CubicSeg): CubicSeg => cubicSeg(c.p3, c.p2, c.p1, c.p0);

/** Subdivisión de De Casteljau: exacta, sin aproximación alguna. */
export function cubicSplitAt(c: CubicSeg, t: number): [CubicSeg, CubicSeg] {
  const p01 = lerpVec(c.p0, c.p1, t);
  const p12 = lerpVec(c.p1, c.p2, t);
  const p23 = lerpVec(c.p2, c.p3, t);
  const p012 = lerpVec(p01, p12, t);
  const p123 = lerpVec(p12, p23, t);
  const point = lerpVec(p012, p123, t);

  return [cubicSeg(c.p0, p01, p012, point), cubicSeg(point, p123, p23, c.p3)];
}

/** Trozo de curva entre dos parámetros, como cúbica independiente. */
export function cubicSubsegment(c: CubicSeg, t0: number, t1: number): CubicSeg {
  if (t0 > t1) return cubicReverse(cubicSubsegment(c, t1, t0));
  if (t0 <= 0 && t1 >= 1) return c;

  const [, tail] = cubicSplitAt(c, t0);
  if (t1 >= 1) return tail;

  // El parámetro t1 hay que reescalarlo al dominio de la cola.
  const rescaled = t0 >= 1 ? 0 : (t1 - t0) / (1 - t0);
  const [head] = cubicSplitAt(tail, rescaled);
  return head;
}

/**
 * Caja envolvente EXACTA.
 *
 * No la de los puntos de control —que es válida pero holgada, a veces mucho—
 * sino la de la curva real: los extremos de cada coordenada están en los
 * extremos del segmento o donde se anula la componente correspondiente de la
 * derivada, lo que reduce a resolver una cuadrática por eje.
 *
 * La holgura importa: estas cajas son el criterio de poda de las
 * intersecciones curva-curva y del test de acierto. Una caja holgada no da
 * resultados falsos, pero multiplica el trabajo.
 */
export function cubicBounds(c: CubicSeg): Rect {
  const candidates: Vec2[] = [c.p0, c.p3];

  for (const t of derivativeRoots(c)) candidates.push(cubicPointAt(c, t));

  return rectFromPoints(candidates) ?? { min: c.p0, max: c.p0 };
}

/**
 * Parámetros de (0, 1) donde se anula alguna componente de `B'(t)`.
 *
 * `B'` es cuadrática, así que cada componente aporta como mucho dos raíces y se
 * obtienen en forma cerrada. Sirven a dos usos distintos: son los extremos de
 * coordenada que ajustan la caja envolvente, y son los puntos donde la función
 * rapidez `|B'(t)|` deja de ser suave.
 */
function derivativeRoots(c: CubicSeg): number[] {
  const roots: number[] = [];

  for (const axis of ['x', 'y'] as const) {
    const p0 = c.p0[axis];
    const p1 = c.p1[axis];
    const p2 = c.p2[axis];
    const p3 = c.p3[axis];

    // B'(t)/3 = (p3−3p2+3p1−p0)·t² + 2(p2−2p1+p0)·t + (p1−p0)
    const a = p3 - 3 * p2 + 3 * p1 - p0;
    const b = 2 * (p2 - 2 * p1 + p0);
    const k = p1 - p0;

    for (const t of rootsInUnitInterval(solveQuadratic(a, b, k))) {
      if (t > EPS_PARAM && t < 1 - EPS_PARAM) roots.push(t);
    }
  }

  return [...new Set(roots)].sort((x, y) => x - y);
}

/** Profundidad máxima de subdivisión al aplanar. */
const MAX_FLATTEN_DEPTH = 24;

/**
 * ¿Está la curva lo bastante cerca de su cuerda?
 *
 * Cota de Sederberg: la distancia máxima entre la cúbica y la recta que une
 * sus extremos está acotada por los vectores `u = 3p₁ − 2p₀ − p₃` y
 * `v = 3p₂ − p₀ − 2p₃`, mediante
 *
 *     máx(uₓ², vₓ²) + máx(u_y², v_y²) ≤ 16·tol²
 *
 * Se trabaja con cuadrados para evitar raíces en el bucle caliente. Es una
 * cota conservadora: nunca declara plana una curva que no lo esté.
 */
function isFlatEnough(c: CubicSeg, tolerance: number): boolean {
  const ux = 3 * c.p1.x - 2 * c.p0.x - c.p3.x;
  const uy = 3 * c.p1.y - 2 * c.p0.y - c.p3.y;
  const vx = 3 * c.p2.x - c.p0.x - 2 * c.p3.x;
  const vy = 3 * c.p2.y - c.p0.y - 2 * c.p3.y;

  const worst = Math.max(ux * ux, vx * vx) + Math.max(uy * uy, vy * vy);
  return worst <= 16 * tolerance * tolerance;
}

/**
 * Aproxima la curva por una polilínea cuya desviación máxima no supera
 * `tolerance` milímetros.
 *
 * La subdivisión es ADAPTATIVA, no uniforme: los tramos casi rectos se
 * resuelven con dos puntos y los de curvatura fuerte reciben los que hagan
 * falta. Un muestreo uniforme obligaría a fijar el paso por el peor tramo de
 * toda la pieza, multiplicando los vértices donde no aportan nada — y esos
 * vértices son, más adelante, nodos de la malla de simulación.
 */
export function cubicToPolyline(c: CubicSeg, tolerance: number = CHORD_TOL_MM): Vec2[] {
  const points: Vec2[] = [c.p0];
  subdivide(c, tolerance, 0, points);
  points.push(c.p3);
  return points;
}

function subdivide(c: CubicSeg, tolerance: number, depth: number, out: Vec2[]): void {
  if (depth >= MAX_FLATTEN_DEPTH || isFlatEnough(c, tolerance)) return;

  const [left, right] = cubicSplitAt(c, 0.5);
  subdivide(left, tolerance, depth + 1, out);
  out.push(left.p3);
  subdivide(right, tolerance, depth + 1, out);
}

/** Rapidez escalar: módulo del vector velocidad. */
const speed = (c: CubicSeg) => (t: number): number => length(cubicDerivative(c, t));

/**
 * Longitud del tramo [0, t].
 *
 * Integra `|B'(t)|` por cuadratura de Gauss-Legendre adaptativa. No existe
 * primitiva elemental: bajo la raíz hay un polinomio de grado 4.
 *
 * ── Por qué se parte el dominio ─────────────────────────────────────────────
 *
 * El integrando `|B'(t)| = √(B'ₓ² + B'_y²)` es analítico salvo donde alguna
 * componente de la derivada se anula: ahí la raíz de un cuadrado tiene un pico
 * en V y deja de ser derivable. Gauss-Legendre converge de forma espectral en
 * funciones suaves, pero sólo linealmente en un punto anguloso — y, lo que es
 * peor, el estimador de error de la cuadratura adaptativa PUEDE ENGAÑARSE ahí:
 * las dos aproximaciones que compara coinciden estando ambas equivocadas, y la
 * recursión se detiene contenta con un resultado erróneo.
 *
 * Ocurrió de verdad: en una cúbica con cúspide, pedir tolerancia 1e-9 devolvía
 * un valor equivocado en 1e-6 mm, y pedir 1e-13 daba exactamente lo mismo. El
 * error era insensible a la tolerancia, que es la firma de un estimador
 * engañado y no de una tolerancia mal ajustada.
 *
 * La solución no es subdividir más a ciegas —eso sólo desplaza el problema—
 * sino QUITAR la no suavidad: se localizan en forma cerrada los puntos
 * problemáticos (raíces de una cuadrática) y se integra por tramos entre ellos.
 * Dentro de cada tramo el integrando es analítico y la cuadratura recupera toda
 * su precisión.
 */
export function cubicLengthUpTo(
  c: CubicSeg,
  t: number,
  tolerance: number = LENGTH_TOL_MM,
): number {
  const upper = clamp(t, 0, 1);
  if (upper <= 0) return 0;

  const f = speed(c);
  const cuts = [0, ...derivativeRoots(c).filter((root) => root < upper), upper];
  const pieces = cuts.length - 1;

  let total = 0;
  for (let i = 0; i < pieces; i++) {
    const from = cuts[i];
    const to = cuts[i + 1];
    if (from === undefined || to === undefined || to <= from) continue;
    total += adaptiveQuadrature(f, from, to, tolerance / pieces);
  }

  return total;
}

export function cubicLength(c: CubicSeg, tolerance: number = LENGTH_TOL_MM): number {
  return cubicLengthUpTo(c, 1, tolerance);
}

/**
 * Parámetro en el que se ha recorrido `arcLength` milímetros desde el origen.
 *
 * Es la INVERSA de `cubicLengthUpTo`, y la operación que hace posible situar
 * piquetes, repartir embebido y muestrear aristas de forma emparejable para la
 * malla 3D (§7 de docs/ARCHITECTURE.md).
 *
 * La parametrización de una Bézier no es proporcional a la longitud —t = 0.5
 * casi nunca está a mitad de recorrido—, así que hay que invertir
 * numéricamente. Se usa Newton con salvaguarda, con la rapidez como derivada
 * exacta: la longitud es monótona creciente, de modo que la raíz es única.
 */
export function cubicTAtLength(
  c: CubicSeg,
  arcLength: number,
  tolerance: number = LENGTH_TOL_MM,
): number {
  const total = cubicLength(c, tolerance);
  if (total <= 0) return 0;
  if (arcLength <= 0) return 0;
  if (arcLength >= total) return 1;

  const f = (t: number): number => cubicLengthUpTo(c, t, tolerance) - arcLength;
  const df = speed(c);

  return clamp(safeNewton(f, df, 0, 1, arcLength / total, { tolerance }), 0, 1);
}

export const cubicPointAtLength = (c: CubicSeg, arcLength: number): Vec2 =>
  cubicPointAt(c, cubicTAtLength(c, arcLength));

/**
 * Transforma la curva.
 *
 * Las Bézier son invariantes afines: transformar los cuatro puntos de control
 * y transformar la curva punto a punto dan exactamente el mismo resultado. Por
 * eso basta con mover los controles, sin muestrear ni reajustar nada.
 */
export const cubicTransform = (c: CubicSeg, m: Mat3): CubicSeg =>
  cubicSeg(
    applyToPoint(m, c.p0),
    applyToPoint(m, c.p1),
    applyToPoint(m, c.p2),
    applyToPoint(m, c.p3),
  );

/** ¿Se reduce la curva a un punto? */
export const cubicIsDegenerate = (c: CubicSeg): boolean =>
  isZero(length(sub(c.p1, c.p0))) &&
  isZero(length(sub(c.p2, c.p0))) &&
  isZero(length(sub(c.p3, c.p0)));

/** Cúbica que interpola dos extremos con tangentes dadas (forma de Hermite). */
export const cubicFromHermite = (
  p0: Vec2,
  tangent0: Vec2,
  p1: Vec2,
  tangent1: Vec2,
): CubicSeg =>
  cubicSeg(
    p0,
    add(p0, vec2(tangent0.x / 3, tangent0.y / 3)),
    sub(p1, vec2(tangent1.x / 3, tangent1.y / 3)),
    p1,
  );
