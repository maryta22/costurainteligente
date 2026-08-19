import { adaptiveQuadrature } from '@core/numeric/quadrature';
import { solveIncreasing } from '@core/numeric/solve';

/**
 * Perímetro de una elipse de semiejes `a` y `b`.
 *
 * No tiene forma cerrada: es una integral elíptica de segunda especie, que es
 * precisamente el ejemplo canónico de función sin primitiva elemental.
 *
 * Existe la aproximación de Ramanujan, exacta a 1e-5 relativo, y habría bastado.
 * Se integra numéricamente porque el núcleo ya tiene la cuadratura adaptativa
 * —construida en la Fase 2 para las longitudes de arco— y usarla cuesta una
 * línea, no introduce una constante mágica y da el resultado exacto.
 */
export function ellipsePerimeter(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;

  //  ∫₀^{2π} √(a²·sin²t + b²·cos²t) dt
  const integrand = (t: number): number =>
    Math.hypot(a * Math.sin(t), b * Math.cos(t));

  return adaptiveQuadrature(integrand, 0, 2 * Math.PI, 1e-6);
}

export interface EllipseAxes {
  /** Semieje transversal, de lado a lado del cuerpo. */
  readonly halfWidth: number;
  /** Semieje sagital, de delante atrás. */
  readonly halfDepth: number;
}

/**
 * Semiejes de la elipse que tiene el perímetro pedido, con una proporción dada.
 *
 * ── Por qué elipses y no circunferencias ───────────────────────────────────
 *
 * Un torso no es cilíndrico: es sensiblemente más ancho que profundo. Modelar
 * las secciones como circunferencias daría un cuerpo del contorno correcto pero
 * de forma equivocada, y sobre él una prenda caería mal —la manga chocaría con
 * un costado demasiado saliente— sin que la medida delatase el problema.
 *
 * La proporción entre profundidad y anchura varía por zona: la cintura es más
 * redonda que el pecho, y la cadera más aún.
 *
 * El perímetro crece de forma monótona con la anchura, así que la anchura se
 * despeja con una bisección — el mismo recurso que resuelve la cintura del
 * patrón y la altura de copa.
 */
export function axesForPerimeter(perimeter: number, depthRatio: number): EllipseAxes {
  if (perimeter <= 0) return { halfWidth: 0, halfDepth: 0 };

  const perimeterFor = (halfWidth: number): number =>
    ellipsePerimeter(halfWidth, halfWidth * depthRatio);

  // Cota superior generosa: una circunferencia de ese perímetro tiene radio
  // P/2π, y con `depthRatio < 1` la anchura necesaria es algo mayor.
  const upper = perimeter / Math.PI;

  const halfWidth = solveIncreasing(perimeterFor, perimeter, 0, upper, { tolerance: 1e-4 });

  return { halfWidth, halfDepth: halfWidth * depthRatio };
}

/**
 * Proporción profundidad/anchura por zona del cuerpo.
 *
 * Valores antropométricos aproximados. El pecho es el más aplanado —los hombros
 * ensanchan la sección— y la cadera la más redonda.
 */
export const DEPTH_RATIOS = {
  neck: 0.88,
  shoulder: 0.5,
  bust: 0.72,
  underbust: 0.7,
  waist: 0.74,
  hip: 0.78,
  thigh: 0.92,
  knee: 0.95,
  ankle: 0.85,
  arm: 0.95,
} as const;
