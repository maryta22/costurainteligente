/**
 * Política única de tolerancias — mitigación del riesgo R10.
 *
 * Todas las comparaciones geométricas del sistema pasan por aquí. Ningún módulo
 * define su propio epsilon: un epsilon disperso es indistinguible de un bug.
 *
 * Los valores están expresados en las unidades del modelo (milímetros) o en
 * espacio paramétrico adimensional, según el sufijo.
 */

/**
 * Igualdad de longitudes y coordenadas, en mm.
 *
 * 1e-6 mm = 1 nanómetro. Muy por debajo de cualquier magnitud física relevante
 * en confección, y muy por encima del error de redondeo de float64 acumulado en
 * las cadenas de operaciones típicas del motor (~1e-12 para valores del orden
 * de 1e3 mm).
 */
export const EPS_MM = 1e-6;

/** Igualdad en espacio paramétrico de curva, t ∈ [0,1]. */
export const EPS_PARAM = 1e-9;

/** Igualdad angular, en radianes. ≈ 5.7e-5 grados. */
export const EPS_ANGLE = 1e-9;

/**
 * Tolerancia de cuerda por defecto al convertir curvas en polilíneas para
 * render y para el cálculo de offsets (§3.6 de docs/ARCHITECTURE.md).
 * 0.05 mm está por debajo del grosor de una línea de trazado.
 */
export const CHORD_TOL_MM = 0.05;

/**
 * Tolerancia por defecto del cálculo de longitudes de arco, en mm.
 *
 * Un orden de magnitud por debajo del criterio de aceptación de la Fase 2
 * (0.01 mm), para que el error acumulado al sumar las decenas de segmentos de
 * un contorno siga cómodamente dentro del objetivo.
 */
export const LENGTH_TOL_MM = 0.001;

export function nearlyEqual(a: number, b: number, eps: number = EPS_MM): boolean {
  return Math.abs(a - b) <= eps;
}

export function isZero(value: number, eps: number = EPS_MM): boolean {
  return Math.abs(value) <= eps;
}

/**
 * ¿Es nulo un vector del que sólo se conoce su longitud AL CUADRADO?
 *
 * Existe para cerrar un error de análisis dimensional que ya se ha cometido una
 * vez en este código: comparar `lenSq` directamente con `EPS_MM` desplaza el
 * umbral efectivo a √EPS_MM = 0.001 mm, mil veces por encima de la tolerancia
 * declarada, y hace que segmentos válidos se traten como degenerados.
 *
 * Comparar el cuadrado con el cuadrado evita además la raíz, que es justo el
 * motivo por el que se trabaja con `lengthSq` en los caminos calientes.
 */
export function isZeroLengthSq(lengthSquared: number): boolean {
  return lengthSquared <= EPS_MM * EPS_MM;
}

/**
 * Comparación relativa, para magnitudes cuyo orden de a magnitud es desconocido
 * (áreas, longitudes acumuladas). Usa tolerancia absoluta cerca de cero.
 */
export function nearlyEqualRelative(a: number, b: number, relEps = 1e-9): boolean {
  const diff = Math.abs(a - b);
  if (diff <= EPS_MM) return true;
  return diff <= relEps * Math.max(Math.abs(a), Math.abs(b));
}
