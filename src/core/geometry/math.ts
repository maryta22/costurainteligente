/** Utilidades numéricas de propósito general del núcleo. */

export const TAU = Math.PI * 2;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Inversa de `lerp`. Devuelve 0 si el intervalo es degenerado. */
export function inverseLerp(a: number, b: number, value: number): number {
  return a === b ? 0 : (value - a) / (b - a);
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Normaliza un ángulo al intervalo semiabierto [0, 2π).
 *
 * El caso límite no es teórico: para un ángulo negativo diminuto, `rad % TAU`
 * devuelve un negativo del orden de 1e-16 y la suma de `TAU` se redondea a
 * exactamente `TAU`, que queda FUERA del intervalo. Sin el ajuste final, una
 * comparación de igualdad angular fallaría de forma intermitente según el
 * signo del ángulo de entrada.
 */
export function normalizeAngle(rad: number): number {
  const r = rad % TAU;
  if (r >= 0) return r;
  const shifted = r + TAU;
  return shifted >= TAU ? 0 : shifted;
}

/** Redondea al múltiplo de `step` más próximo. `step <= 0` devuelve el valor. */
export function roundToStep(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value;
}

/**
 * Menor paso «bonito» (1, 2, 5 × 10ⁿ) mayor o igual que `minStep`.
 *
 * Se usa para la densidad adaptativa de la rejilla y de las reglas: la escala
 * cambia de forma continua con el zoom, pero las divisiones visibles deben
 * caer siempre en valores legibles.
 */
export function niceStep(minStep: number): number {
  if (!Number.isFinite(minStep) || minStep <= 0) return 1;
  const exponent = Math.floor(Math.log10(minStep));
  const magnitude = Math.pow(10, exponent);
  const normalized = minStep / magnitude; // ∈ [1, 10)
  const mantissa = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return mantissa * magnitude;
}
