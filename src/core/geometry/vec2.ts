import { EPS_MM, isZero, isZeroLengthSq } from './epsilon';

/**
 * Punto o vector en COORDENADAS DE MUNDO: milímetros, X hacia la derecha,
 * Y HACIA ARRIBA (decisión D4 de docs/ARCHITECTURE.md).
 *
 * La propiedad `space` es una marca fantasma opcional. No se asigna nunca en
 * tiempo de ejecución; existe sólo para que el compilador rechace un
 * `ScreenPoint` (que declara `space: 'screen'`) allí donde se espera mundo.
 * Es la mitigación de tipos del riesgo R8 (deriva de unidades y ejes).
 */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
  readonly space?: 'world';
}

export const vec2 = (x: number, y: number): Vec2 => ({ x, y });

export const ORIGIN: Vec2 = Object.freeze({ x: 0, y: 0 });
export const UNIT_X: Vec2 = Object.freeze({ x: 1, y: 0 });
export const UNIT_Y: Vec2 = Object.freeze({ x: 0, y: 1 });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (v: Vec2, k: number): Vec2 => ({ x: v.x * k, y: v.y * k });
export const negate = (v: Vec2): Vec2 => ({ x: -v.x, y: -v.y });

export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

/**
 * Producto vectorial 2D (componente z del producto en 3D).
 *
 * Signo positivo ⇒ `b` queda a la izquierda de `a`. Es la primitiva de
 * orientación de la que dependen el sentido de recorrido de un contorno, el
 * lado hacia el que se aplica un margen de costura y los tests de convexidad.
 */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

export const lengthSq = (v: Vec2): number => v.x * v.x + v.y * v.y;
export const length = (v: Vec2): number => Math.hypot(v.x, v.y);

export const distanceSq = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Devuelve el vector unitario. Un vector nulo devuelve el vector nulo. */
export function normalize(v: Vec2): Vec2 {
  const len = length(v);
  return isZero(len) ? ORIGIN : { x: v.x / len, y: v.y / len };
}

/** Perpendicular a la izquierda: rotación de +90°. */
export const perpLeft = (v: Vec2): Vec2 => ({ x: -v.y, y: v.x });

/** Perpendicular a la derecha: rotación de -90°. */
export const perpRight = (v: Vec2): Vec2 => ({ x: v.y, y: -v.x });

export function rotate(v: Vec2, radians: number): Vec2 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

export function rotateAround(v: Vec2, pivot: Vec2, radians: number): Vec2 {
  return add(pivot, rotate(sub(v, pivot), radians));
}

export const lerpVec = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export const midpoint = (a: Vec2, b: Vec2): Vec2 => lerpVec(a, b, 0.5);

/** Ángulo del vector respecto al eje X positivo, en radianes, ∈ (-π, π]. */
export const angleOf = (v: Vec2): number => Math.atan2(v.y, v.x);

/** Ángulo del segmento dirigido `a → b`, en radianes. */
export const angleBetweenPoints = (a: Vec2, b: Vec2): number => angleOf(sub(b, a));

/**
 * Construye un vector a partir de módulo y ángulo.
 *
 * Es la primitiva de trazado por excelencia: casi todo paso de construcción de
 * un patrón es «desde este punto, a tantos milímetros, en tal dirección».
 */
export const fromPolar = (distanceMm: number, radians: number): Vec2 => ({
  x: distanceMm * Math.cos(radians),
  y: distanceMm * Math.sin(radians),
});

export function equals(a: Vec2, b: Vec2, eps: number = EPS_MM): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

/**
 * Reflexión de `v` respecto a la recta que pasa por `a` y `b`.
 *
 * El umbral se compara con `EPS_MM²` porque `lenSq` es un área; véase la nota
 * equivalente en `closestPointOnSegment`.
 */
export function mirror(v: Vec2, a: Vec2, b: Vec2): Vec2 {
  const axis = sub(b, a);
  const lenSq = lengthSq(axis);
  if (isZeroLengthSq(lenSq)) return v;
  const rel = sub(v, a);
  const t = dot(rel, axis) / lenSq;
  const foot = add(a, scale(axis, t));
  return add(foot, sub(foot, v));
}
