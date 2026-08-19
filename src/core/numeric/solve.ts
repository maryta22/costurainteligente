/**
 * Inversión numérica de funciones monótonas de una variable.
 *
 * Es la pieza que permite prescindir de un solver geométrico bidireccional
 * (decisión D2 de docs/ARCHITECTURE.md). Las preguntas que el patronaje
 * plantea al revés son casi siempre unidimensionales:
 *
 *   «¿en qué parámetro de esta curva he recorrido 137 mm?»       → piquetes
 *   «¿qué ancho de manga hace que la copa mida lo que la sisa?»  → casamiento
 *   «¿qué valor del parámetro lleva este punto bajo el cursor?»  → arrastre
 *
 * Todas se resuelven con esto, en microsegundos y de forma determinista.
 */

export interface SolveOptions {
  /** Tolerancia sobre el VALOR de la función, en sus propias unidades. */
  readonly tolerance?: number;
  readonly maxIterations?: number;
}

const DEFAULT_TOLERANCE = 1e-9;
const DEFAULT_MAX_ITERATIONS = 60;

/**
 * Busca `x ∈ [lo, hi]` tal que `f(x) = 0`, con `f` de signos opuestos en los
 * extremos. Devuelve `null` si el intervalo no encierra un cambio de signo.
 *
 * La bisección es lenta comparada con Newton, pero no puede divergir. Se usa
 * como red de seguridad de `safeNewton` y como método directo cuando no se
 * dispone de derivada.
 */
export function bisect(
  f: (x: number) => number,
  lo: number,
  hi: number,
  options: SolveOptions = {},
): number | null {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  let a = lo;
  let b = hi;
  let fa = f(a);
  const fb = f(b);

  if (Math.abs(fa) <= tolerance) return a;
  if (Math.abs(fb) <= tolerance) return b;
  if (fa * fb > 0) return null;

  for (let i = 0; i < maxIterations; i++) {
    const mid = (a + b) / 2;
    const fm = f(mid);

    if (Math.abs(fm) <= tolerance || (b - a) / 2 <= Number.EPSILON * Math.abs(mid)) return mid;

    if (fa * fm < 0) {
      b = mid;
    } else {
      a = mid;
      fa = fm;
    }
  }

  return (a + b) / 2;
}

/**
 * Newton-Raphson con salvaguarda de bisección.
 *
 * Newton puro converge cuadráticamente, pero se escapa del intervalo en cuanto
 * la derivada se hace pequeña — exactamente lo que ocurre en una curva con una
 * cúspide o un tramo casi recto. Aquí cada paso se comprueba: si el candidato
 * sale del intervalo acotado o no reduce el residuo, se sustituye por una
 * bisección. Se conserva así la velocidad de Newton sin su fragilidad.
 */
export function safeNewton(
  f: (x: number) => number,
  df: (x: number) => number,
  lo: number,
  hi: number,
  initial: number,
  options: SolveOptions = {},
): number {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  let a = lo;
  let b = hi;
  let x = Math.min(hi, Math.max(lo, initial));

  const fa = f(a);
  let fx = f(x);

  for (let i = 0; i < maxIterations; i++) {
    if (Math.abs(fx) <= tolerance) return x;

    // Mantener el intervalo encerrando la raíz.
    if (fa * fx < 0) b = x;
    else a = x;

    const slope = df(x);
    let next = slope === 0 ? Number.NaN : x - fx / slope;

    if (!Number.isFinite(next) || next <= a || next >= b) next = (a + b) / 2;

    if (Math.abs(next - x) <= Number.EPSILON * Math.abs(next)) return next;

    x = next;
    fx = f(x);
  }

  return x;
}

/**
 * Resuelve `f(x) = target` para una `f` CRECIENTE en [lo, hi].
 *
 * Envoltura de conveniencia sobre `bisect` que satura fuera del recorrido en
 * lugar de fallar. Es lo correcto para longitudes de arco: pedir el punto a
 * 500 mm de una curva que mide 300 debe devolver su extremo, no un error.
 */
export function solveIncreasing(
  f: (x: number) => number,
  target: number,
  lo: number,
  hi: number,
  options: SolveOptions = {},
): number {
  if (target <= f(lo)) return lo;
  if (target >= f(hi)) return hi;

  return bisect((x) => f(x) - target, lo, hi, options) ?? hi;
}
