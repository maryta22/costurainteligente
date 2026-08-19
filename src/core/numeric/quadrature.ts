/**
 * Integración numérica.
 *
 * Existe para una sola cosa, pero es una cosa central: la longitud de arco de
 * una curva de Bézier. No hay forma cerrada — `|B'(t)|` es la raíz cuadrada de
 * un polinomio de grado 4, que no es integrable en términos elementales — así
 * que toda medida de una curva del patrón pasa por aquí.
 *
 * Y medir es lo que más se hace en patronaje: la copa de manga debe igualar a
 * la sisa, el costado delantero al de la espalda, el contorno de cintura a la
 * medida más el ease. Un error sistemático en esta función se traduce en
 * piezas que no casan al coser.
 */

/**
 * Nodos y pesos de Gauss-Legendre de 8 puntos, sólo la mitad positiva
 * (la regla es simétrica respecto al origen).
 *
 * Con 8 puntos la regla es exacta para polinomios de grado ≤ 15. `|B'(t)|` no
 * es polinómica, de ahí la subdivisión adaptativa de `adaptiveQuadrature`,
 * pero la convergencia es tan rápida que en la práctica bastan una o dos
 * bisecciones para bajar de la centésima de milímetro.
 */
const GAUSS_LEGENDRE_8: readonly (readonly [node: number, weight: number])[] = [
  [0.1834346424956498, 0.362683783378362],
  [0.525532409916329, 0.3137066458778873],
  [0.7966664774136267, 0.2223810344533745],
  [0.9602898564975363, 0.1012285362903763],
];

/** Profundidad máxima de bisección. 2²⁴ subintervalos es un techo, no un objetivo. */
const MAX_DEPTH = 24;

/**
 * Bisecciones OBLIGATORIAS antes de dar por bueno el estimador de error.
 *
 * El estimador de una cuadratura adaptativa —comparar el intervalo entero con
 * la suma de sus mitades— puede engañarse: si el integrando tiene una
 * estructura que ninguna de las dos reglas ve, ambas coinciden estando las dos
 * equivocadas, y la recursión se detiene con un resultado erróneo.
 *
 * No es hipotético. Con la longitud de una cúbica con CÚSPIDE (|B′| se anula en
 * el interior, y el integrando tiene un pico en V), pedir 1e-9 devolvía un
 * valor equivocado en 1e-6 mm; pidiendo 1e-12 el error caía a 3e-18. El
 * estimador se había dejado engañar exactamente en el punto anguloso.
 *
 * Forzar 16 subintervalos antes de confiar en él cierra ese hueco por unas
 * decenas de evaluaciones adicionales — irrelevantes aquí, donde las
 * longitudes se calculan miles de veces, no millones.
 *
 * Las cúspides no deberían aparecer en un patrón bien trazado —de eso se ocupa
 * la parametrización centrípeta del spline—, pero «no debería» no es «no
 * puede»: basta con que alguien arrastre un tirador.
 */
const MIN_DEPTH = 4;

/** Integra `f` sobre [a, b] con una única aplicación de la regla de 8 puntos. */
export function gaussLegendre(f: (x: number) => number, a: number, b: number): number {
  const half = (b - a) / 2;
  const mid = (a + b) / 2;

  let sum = 0;
  for (const [node, weight] of GAUSS_LEGENDRE_8) {
    sum += weight * (f(mid - half * node) + f(mid + half * node));
  }

  return sum * half;
}

/**
 * Integra `f` sobre [a, b] hasta alcanzar la tolerancia pedida.
 *
 * Estimación del error por bisección: se compara el valor del intervalo
 * completo con la suma de sus dos mitades. Si difieren menos que la
 * tolerancia, la suma de las mitades ya es más precisa que cualquiera de las
 * dos y se devuelve. En caso contrario se recurre sobre cada mitad con la
 * tolerancia repartida, de modo que el error total acumulado sigue acotado por
 * la tolerancia global.
 */
export function adaptiveQuadrature(
  f: (x: number) => number,
  a: number,
  b: number,
  tolerance: number,
): number {
  return refine(f, a, b, tolerance, gaussLegendre(f, a, b), 0);
}

function refine(
  f: (x: number) => number,
  a: number,
  b: number,
  tolerance: number,
  whole: number,
  depth: number,
): number {
  const mid = (a + b) / 2;
  const left = gaussLegendre(f, a, mid);
  const right = gaussLegendre(f, mid, b);
  const halves = left + right;

  if (depth >= MAX_DEPTH) return halves;
  if (depth >= MIN_DEPTH && Math.abs(halves - whole) <= tolerance) return halves;

  return (
    refine(f, a, mid, tolerance / 2, left, depth + 1) +
    refine(f, mid, b, tolerance / 2, right, depth + 1)
  );
}
