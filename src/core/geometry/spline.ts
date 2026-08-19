import type { Contour } from './contour';
import { contour } from './contour';
import type { CubicSeg } from './cubic';
import { cubicSeg } from './cubic';
import type { Vec2 } from './vec2';
import { add, distance, equals, scale, sub } from './vec2';

/** Parametrización uniforme. Produce sobreoscilación con puntos desiguales. */
export const UNIFORM = 0;
/** Parametrización CENTRÍPETA. La correcta para patronaje; ver más abajo. */
export const CENTRIPETAL = 0.5;
/** Parametrización de cuerda. Suave, pero puede alejarse mucho de los puntos. */
export const CHORDAL = 1;

/** Suelo del espaciado de nudos: evita dividir por cero con puntos muy juntos. */
const MIN_KNOT = 1e-9;

export interface SplineOptions {
  /** Exponente de la parametrización. Por defecto, centrípeta (0.5). */
  readonly alpha?: number;
  readonly closed?: boolean;
  /** Velocidad impuesta al inicio, en unidades del primer tramo. */
  readonly startTangent?: Vec2;
  /** Velocidad impuesta al final, en unidades del último tramo. */
  readonly endTangent?: Vec2;
}

/**
 * Curva suave que pasa POR los puntos dados, como cúbicas de Bézier.
 *
 * ── Por qué centrípeta ──────────────────────────────────────────────────────
 *
 * Catmull-Rom es un spline interpolante: la curva atraviesa todos los puntos,
 * que es exactamente lo que pide el patronaje —el escote pasa por el hombro y
 * por el centro delantero, no «cerca»—. Pero su parametrización decide el
 * resultado:
 *
 *   · UNIFORME (α = 0): supone todos los tramos iguales. Cuando no lo son
 *     —y en una sisa nunca lo son— la curva SOBREOSCILA: se sale hacia fuera
 *     entre dos puntos muy juntos y puede formar un bucle.
 *   · CUERDA (α = 1): elimina los bucles pero se aleja mucho de los puntos
 *     en los tramos largos.
 *   · CENTRÍPETA (α = 0.5): Yuksel, Schaefer y Keyser demostraron que es el
 *     único exponente que garantiza AUSENCIA DE CÚSPIDES Y DE
 *     AUTOINTERSECCIONES dentro de cada tramo, sea cual sea la distribución
 *     de los puntos.
 *
 * Es un caso en el que la opción por defecto correcta no es la obvia. Una sisa
 * trazada con parametrización uniforme presenta un bulto hacia fuera cerca del
 * hombro que ninguna patronista aceptaría, y el origen del defecto está en un
 * exponente, no en los puntos.
 *
 * ── Construcción ────────────────────────────────────────────────────────────
 *
 * Se calcula la tangente en cada nodo con la fórmula de Catmull-Rom no
 * uniforme y se convierte cada tramo a Bézier por la relación de Hermite:
 * `b₁ = P + m/3`, `b₂ = Q − n/3`.
 */
export function catmullRomToCubics(
  points: readonly Vec2[],
  options: SplineOptions = {},
): CubicSeg[] {
  const alpha = options.alpha ?? CENTRIPETAL;
  const closed = options.closed ?? false;

  const nodes = dedupe(points, closed);
  const n = nodes.length;
  if (n < 2) return [];

  const at = (index: number): Vec2 => {
    const wrapped = closed ? ((index % n) + n) % n : Math.min(n - 1, Math.max(0, index));
    const point = nodes[wrapped];
    if (point === undefined) throw new Error('índice de nodo fuera de rango');
    return point;
  };

  const knot = (i: number, j: number): number =>
    Math.max(Math.pow(distance(at(i), at(j)), alpha), MIN_KNOT);

  /**
   * Tangente en el nodo `j` respecto al parámetro global de nudos.
   *
   *   T_j = (P_j − P_{j−1})/d₋ − (P_{j+1} − P_{j−1})/(d₋ + d₊) + (P_{j+1} − P_j)/d₊
   *
   * Con espaciados iguales se reduce a la clásica `(P_{j+1} − P_{j−1})/2`.
   */
  const tangentAt = (j: number): Vec2 => {
    if (!closed && j === 0) {
      const span = knot(0, 1);
      const chord = sub(at(1), at(0));
      return options.startTangent !== undefined
        ? scale(options.startTangent, 1 / span)
        : scale(chord, 1 / span);
    }

    if (!closed && j === n - 1) {
      const span = knot(n - 2, n - 1);
      const chord = sub(at(n - 1), at(n - 2));
      return options.endTangent !== undefined
        ? scale(options.endTangent, 1 / span)
        : scale(chord, 1 / span);
    }

    const before = knot(j - 1, j);
    const after = knot(j, j + 1);

    return add(
      sub(
        scale(sub(at(j), at(j - 1)), 1 / before),
        scale(sub(at(j + 1), at(j - 1)), 1 / (before + after)),
      ),
      scale(sub(at(j + 1), at(j)), 1 / after),
    );
  };

  const tangents: Vec2[] = [];
  for (let j = 0; j < n; j++) tangents.push(tangentAt(j));

  const segmentCount = closed ? n : n - 1;
  const out: CubicSeg[] = [];

  for (let i = 0; i < segmentCount; i++) {
    const start = at(i);
    const end = at(i + 1);
    const span = knot(i, i + 1);

    const startTangent = tangents[closed ? i % n : i];
    const endTangent = tangents[closed ? (i + 1) % n : i + 1];
    if (startTangent === undefined || endTangent === undefined) continue;

    // Reescalado del parámetro global de nudos al parámetro local [0, 1].
    const m0 = scale(startTangent, span);
    const m1 = scale(endTangent, span);

    out.push(
      cubicSeg(start, add(start, scale(m0, 1 / 3)), sub(end, scale(m1, 1 / 3)), end),
    );
  }

  return out;
}

export function splineThrough(
  points: readonly Vec2[],
  options: SplineOptions = {},
): Contour {
  return contour(catmullRomToCubics(points, options), options.closed ?? false);
}

/**
 * Elimina puntos consecutivos coincidentes.
 *
 * Dos puntos idénticos dan un espaciado de nudo nulo. Aunque `MIN_KNOT` evita
 * la división por cero, la tangente resultante sería enorme y arbitraria, y la
 * curva daría un latigazo. Es preferible ignorar el punto repetido.
 */
function dedupe(points: readonly Vec2[], closed: boolean): Vec2[] {
  const out: Vec2[] = [];

  for (const point of points) {
    const previous = out.at(-1);
    if (previous !== undefined && equals(previous, point)) continue;
    out.push(point);
  }

  // En un contorno cerrado, el último punto no debe repetir el primero.
  if (closed && out.length > 1) {
    const first = out[0];
    const last = out.at(-1);
    if (first !== undefined && last !== undefined && equals(first, last)) out.pop();
  }

  return out;
}
