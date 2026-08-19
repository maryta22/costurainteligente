/**
 * Raíces reales de polinomios de grado ≤ 3.
 *
 * Es la base de dos operaciones geométricas: la caja envolvente EXACTA de una
 * cúbica (raíces de su derivada, una cuadrática por eje) y la intersección de
 * una recta con una cúbica (una cúbica en el parámetro).
 *
 * Ambas fórmulas tienen trampas numéricas conocidas y son un origen clásico de
 * errores intermitentes; las mitigaciones están comentadas en su sitio.
 */

/** Umbral para considerar nulo un coeficiente director y degradar de grado. */
const COEFFICIENT_EPS = 1e-12;

const TAU_THIRD = (2 * Math.PI) / 3;

/** Raíces reales de `a·x + b`. */
export function solveLinear(a: number, b: number): number[] {
  return Math.abs(a) < COEFFICIENT_EPS ? [] : [-b / a];
}

/**
 * Raíces reales de `a·x² + b·x + c`.
 *
 * No usa la fórmula escolar. Cuando `b² ≫ 4ac`, uno de los dos numeradores
 * `-b ± √Δ` es una resta de cantidades casi iguales y pierde casi toda su
 * precisión por cancelación catastrófica. La formulación de Numerical Recipes
 * calcula el término estable y obtiene el otro por la relación entre raíces y
 * coeficientes (`x₁·x₂ = c/a`), que no cancela nunca.
 */
export function solveQuadratic(a: number, b: number, c: number): number[] {
  if (Math.abs(a) < COEFFICIENT_EPS) return solveLinear(b, c);

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];

  if (discriminant === 0) return [-b / (2 * a)];

  const root = Math.sqrt(discriminant);
  const q = -0.5 * (b + Math.sign(b || 1) * root);

  const x1 = q / a;
  const x2 = Math.abs(q) < COEFFICIENT_EPS ? x1 : c / q;

  return x1 <= x2 ? [x1, x2] : [x2, x1];
}

/**
 * Raíces reales de `a·x³ + b·x² + c·x + d`.
 *
 * Se reduce a la cúbica deprimida `t³ + p·t + q` mediante `x = t − b/3a` y se
 * resuelve según el signo del discriminante. Para el caso de tres raíces
 * reales se emplea la forma TRIGONOMÉTRICA y no la de Cardano: esta última
 * exige raíces cúbicas de números complejos que, evaluadas en coma flotante,
 * dejan una parte imaginaria residual — el «casus irreducibilis».
 *
 * Las raíces se pulen con un paso de Newton. Cerca de una raíz múltiple la
 * fórmula cerrada pierde varios dígitos, y el pulido los recupera casi
 * gratis.
 */
export function solveCubic(a: number, b: number, c: number, d: number): number[] {
  if (Math.abs(a) < COEFFICIENT_EPS) return solveQuadratic(b, c, d);

  const b1 = b / a;
  const c1 = c / a;
  const d1 = d / a;

  const shift = -b1 / 3;
  const p = c1 - (b1 * b1) / 3;
  const q = (2 * b1 * b1 * b1) / 27 - (b1 * c1) / 3 + d1;

  const discriminant = (q * q) / 4 + (p * p * p) / 27;
  const roots: number[] = [];

  if (discriminant > COEFFICIENT_EPS) {
    // Una raíz real.
    const root = Math.sqrt(discriminant);
    roots.push(Math.cbrt(-q / 2 + root) + Math.cbrt(-q / 2 - root) + shift);
  } else if (discriminant >= -COEFFICIENT_EPS) {
    // Raíz doble o triple.
    const u = Math.cbrt(-q / 2);
    roots.push(2 * u + shift, -u + shift);
  } else {
    // Tres raíces reales distintas — forma trigonométrica.
    const radius = Math.sqrt(-(p * p * p) / 27);
    const cosine = Math.min(1, Math.max(-1, -q / (2 * radius)));
    const phi = Math.acos(cosine);
    const magnitude = 2 * Math.sqrt(-p / 3);

    roots.push(
      magnitude * Math.cos(phi / 3) + shift,
      magnitude * Math.cos(phi / 3 - TAU_THIRD) + shift,
      magnitude * Math.cos(phi / 3 + TAU_THIRD) + shift,
    );
  }

  return roots.map((x) => polishCubicRoot(a, b, c, d, x)).sort((x, y) => x - y);
}

/** Número de pasos de pulido. Más de tres no aporta con `double`. */
const POLISH_STEPS = 3;

const evaluateCubicAt = (a: number, b: number, c: number, d: number, x: number): number =>
  ((a * x + b) * x + c) * x + d;

/**
 * Pulido de Newton CON SALVAGUARDA: sólo se acepta el paso si reduce el
 * residuo.
 *
 * La comprobación no es una precaución de manual, resuelve un fallo real. Cerca
 * de una raíz doble la pendiente es diminuta —del orden de 1e-12— y el paso
 * `−p(x)/p′(x)` se dispara: en un caso encontrado por los tests de propiedades,
 * una raíz correcta situada en 6.5e-12 salía catapultada a 0.0368, con un
 * residuo de 1e-4 donde antes había 5e-14. El «pulido» EMPEORABA la respuesta.
 *
 * Un umbral absoluto sobre la pendiente no puede arreglarlo: no existe un valor
 * válido para todas las escalas de coeficientes. Comparar residuos, en cambio,
 * es adimensional y siempre correcto.
 */
function polishCubicRoot(a: number, b: number, c: number, d: number, x: number): number {
  let best = x;
  let bestResidual = Math.abs(evaluateCubicAt(a, b, c, d, best));

  for (let step = 0; step < POLISH_STEPS; step++) {
    const value = evaluateCubicAt(a, b, c, d, best);
    const slope = (3 * a * best + 2 * b) * best + c;
    if (slope === 0) break;

    const next = best - value / slope;
    if (!Number.isFinite(next)) break;

    const residual = Math.abs(evaluateCubicAt(a, b, c, d, next));
    if (residual >= bestResidual) break;

    best = next;
    bestResidual = residual;
  }

  return best;
}

/**
 * Filtra las raíces contenidas en [0, 1] y elimina duplicados.
 *
 * Los parámetros de curva viven en ese intervalo. La tolerancia hacia fuera
 * recupera las raíces que caen justo en un extremo y que el error de redondeo
 * ha desplazado a 1 + 1e-13, un caso muy frecuente en tangencias.
 */
export function rootsInUnitInterval(roots: readonly number[], tolerance = 1e-9): number[] {
  const inside: number[] = [];

  for (const root of roots) {
    if (!Number.isFinite(root)) continue;
    if (root < -tolerance || root > 1 + tolerance) continue;

    const clamped = Math.min(1, Math.max(0, root));
    if (!inside.some((existing) => Math.abs(existing - clamped) <= tolerance)) {
      inside.push(clamped);
    }
  }

  return inside.sort((x, y) => x - y);
}
