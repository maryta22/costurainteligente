import { isZero } from './epsilon';
import type { Vec2 } from './vec2';
import { normalize, sub, vec2 } from './vec2';

/**
 * Transformación afín 2D.
 *
 * Se guardan sólo las seis componentes útiles, en el orden y con los nombres
 * del convenio de SVG y Canvas:
 *
 *     ⎡ a  c  e ⎤        x' = a·x + c·y + e
 *     ⎢ b  d  f ⎥        y' = b·x + d·y + f
 *     ⎣ 0  0  1 ⎦
 *
 * Adoptar ese convenio no es cosmético: al exportar a SVG o a PDF la matriz se
 * escribe tal cual, sin reordenar componentes, que es justo donde se cuelan
 * los errores de transposición.
 */
export interface Mat3 {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const IDENTITY: Mat3 = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

export const mat3 = (a: number, b: number, c: number, d: number, e: number, f: number): Mat3 => ({
  a, b, c, d, e, f,
});

export const translation = (dx: number, dy: number): Mat3 => mat3(1, 0, 0, 1, dx, dy);

export const scaling = (sx: number, sy: number = sx): Mat3 => mat3(sx, 0, 0, sy, 0, 0);

export function rotation(radians: number): Mat3 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return mat3(cos, sin, -sin, cos, 0, 0);
}

/**
 * Composición: aplicar `multiply(m, n)` equivale a aplicar primero `n` y luego
 * `m`, igual que el producto de matrices.
 */
export function multiply(m: Mat3, n: Mat3): Mat3 {
  return mat3(
    m.a * n.a + m.c * n.b,
    m.b * n.a + m.d * n.b,
    m.a * n.c + m.c * n.d,
    m.b * n.c + m.d * n.d,
    m.a * n.e + m.c * n.f + m.e,
    m.b * n.e + m.d * n.f + m.f,
  );
}

/** Composición de una lista, aplicada de izquierda a derecha. */
export function compose(...matrices: readonly Mat3[]): Mat3 {
  return matrices.reduce((acc, m) => multiply(acc, m), IDENTITY);
}

/** Rotación alrededor de un punto arbitrario. */
export function rotationAround(pivot: Vec2, radians: number): Mat3 {
  return compose(translation(pivot.x, pivot.y), rotation(radians), translation(-pivot.x, -pivot.y));
}

/** Escalado respecto a un punto arbitrario. */
export function scalingAround(pivot: Vec2, sx: number, sy: number = sx): Mat3 {
  return compose(translation(pivot.x, pivot.y), scaling(sx, sy), translation(-pivot.x, -pivot.y));
}

/**
 * Reflexión respecto a la recta que pasa por `a` y `b`.
 *
 * Es la operación de «simetría de pieza», omnipresente en patronaje: media
 * espalda al doblez, mangas izquierda y derecha, delanteros cruzados.
 *
 * Con el eje unitario `(ux, uy)`, la matriz de reflexión en el origen es
 * `[[ux²−uy², 2·ux·uy], [2·ux·uy, uy²−ux²]]`.
 */
export function reflection(a: Vec2, b: Vec2): Mat3 {
  const axis = normalize(sub(b, a));
  if (isZero(axis.x) && isZero(axis.y)) return IDENTITY;

  const { x: ux, y: uy } = axis;
  const linear = mat3(ux * ux - uy * uy, 2 * ux * uy, 2 * ux * uy, uy * uy - ux * ux, 0, 0);

  return compose(translation(a.x, a.y), linear, translation(-a.x, -a.y));
}

export const determinant = (m: Mat3): number => m.a * m.d - m.b * m.c;

/**
 * ¿Invierte la transformación el sentido de giro?
 *
 * Determinante negativo ⇒ hay una reflexión. Importa en el dominio: al
 * reflejar una pieza se invierte el sentido de recorrido de su contorno, y con
 * él el lado hacia el que se aplica el margen de costura y cuál es el derecho
 * de la tela.
 */
export const isMirrored = (m: Mat3): boolean => determinant(m) < 0;

/**
 * ¿Es una semejanza (rotación, escalado uniforme y reflexión opcional)?
 *
 * La pregunta tiene una consecuencia concreta: sólo bajo una semejanza la
 * imagen de un arco de circunferencia sigue siendo un arco. Con escalado no
 * uniforme o cizalla se convierte en una elipse, y hay que aproximarla por
 * cúbicas antes de transformarla.
 */
export function isSimilarity(m: Mat3, tolerance = 1e-9): boolean {
  const columnsEqualLength = Math.abs(m.a * m.a + m.b * m.b - (m.c * m.c + m.d * m.d));
  const columnsOrthogonal = Math.abs(m.a * m.c + m.b * m.d);
  return columnsEqualLength <= tolerance && columnsOrthogonal <= tolerance;
}

/** Factor de escala uniforme. Sólo tiene sentido si `isSimilarity(m)`. */
export const uniformScale = (m: Mat3): number => Math.hypot(m.a, m.b);

export function invert(m: Mat3): Mat3 | null {
  const det = determinant(m);
  if (isZero(det, 1e-14)) return null;

  return mat3(
    m.d / det,
    -m.b / det,
    -m.c / det,
    m.a / det,
    (m.c * m.f - m.d * m.e) / det,
    (m.b * m.e - m.a * m.f) / det,
  );
}

/** Aplica la transformación a un PUNTO — incluye la traslación. */
export const applyToPoint = (m: Mat3, p: Vec2): Vec2 =>
  vec2(m.a * p.x + m.c * p.y + m.e, m.b * p.x + m.d * p.y + m.f);

/**
 * Aplica la transformación a un VECTOR — ignora la traslación.
 *
 * La distinción es real y su olvido es un error clásico: una dirección de hilo
 * o una tangente deben rotarse y escalarse, pero jamás desplazarse.
 */
export const applyToVector = (m: Mat3, v: Vec2): Vec2 =>
  vec2(m.a * v.x + m.c * v.y, m.b * v.x + m.d * v.y);

/** Serialización al atributo `transform` de SVG. */
export const toSvgMatrix = (m: Mat3): string =>
  `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`;
