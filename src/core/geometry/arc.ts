import type { CubicSeg } from './cubic';
import { cubicSeg } from './cubic';
import { CHORD_TOL_MM, EPS_ANGLE, isZero } from './epsilon';
import { TAU, clamp, normalizeAngle } from './math';
import type { Mat3 } from './mat3';
import { applyToPoint, isMirrored, uniformScale } from './mat3';
import type { Rect } from './rect';
import { rectFromPoints } from './rect';
import type { Vec2 } from './vec2';
import { add, angleOf, cross, distance, fromPolar, perpLeft, scale, sub, vec2 } from './vec2';

/**
 * Arco de circunferencia.
 *
 * El barrido se guarda como un ángulo CON SIGNO en lugar de un ángulo final
 * más una bandera de sentido. Con `(inicio, fin, sentidoAntihorario)` hay
 * estados que representan el mismo arco de dos formas y, peor, `inicio = fin`
 * es ambiguo entre «arco nulo» y «circunferencia completa». Con el barrido
 * firmado la representación es única y la evaluación queda en una línea.
 *
 * Los arcos se conservan como arcos y no se convierten a cúbicas al
 * almacenarse: la exportación a DXF tiene entidad ARC nativa (Fase 14) y una
 * curva de costura exacta vale más que una aproximada.
 */
export interface ArcSeg {
  readonly kind: 'arc';
  readonly center: Vec2;
  readonly radius: number;
  /** Ángulo inicial en radianes, medido desde el eje X positivo. */
  readonly startAngle: number;
  /** Barrido con signo: positivo antihorario. |barrido| ≤ 2π. */
  readonly sweepAngle: number;
}

export const arcSeg = (
  center: Vec2,
  radius: number,
  startAngle: number,
  sweepAngle: number,
): ArcSeg => ({
  kind: 'arc',
  center,
  radius,
  startAngle,
  sweepAngle: clamp(sweepAngle, -TAU, TAU),
});

const onCircle = (arc: ArcSeg, angle: number): Vec2 =>
  add(arc.center, fromPolar(arc.radius, angle));

export const arcEndAngle = (arc: ArcSeg): number => arc.startAngle + arc.sweepAngle;
export const arcAngleAt = (arc: ArcSeg, t: number): number =>
  arc.startAngle + arc.sweepAngle * t;

export const arcPointAt = (arc: ArcSeg, t: number): Vec2 => onCircle(arc, arcAngleAt(arc, t));
export const arcStart = (arc: ArcSeg): Vec2 => arcPointAt(arc, 0);
export const arcEnd = (arc: ArcSeg): Vec2 => arcPointAt(arc, 1);

/** Longitud EXACTA. Es la ventaja de conservar el arco como arco. */
export const arcLength = (arc: ArcSeg): number => Math.abs(arc.sweepAngle) * arc.radius;

/**
 * Tangente unitaria en el sentido de recorrido.
 *
 * La derivada de `C + R·(cos θ, sin θ)` respecto a `t` es `R·Δ·(−sin θ, cos θ)`.
 * El signo del barrido decide el sentido; el módulo `R·|Δ|` desaparece al
 * normalizar.
 */
export function arcTangent(arc: ArcSeg, t: number): Vec2 {
  const angle = arcAngleAt(arc, t);
  const direction = arc.sweepAngle >= 0 ? 1 : -1;
  return vec2(-Math.sin(angle) * direction, Math.cos(angle) * direction);
}

export const arcNormal = (arc: ArcSeg, t: number): Vec2 => perpLeft(arcTangent(arc, t));

export const arcReverse = (arc: ArcSeg): ArcSeg =>
  arcSeg(arc.center, arc.radius, arcEndAngle(arc), -arc.sweepAngle);

export function arcSplitAt(arc: ArcSeg, t: number): [ArcSeg, ArcSeg] {
  const cut = arcAngleAt(arc, t);
  return [
    arcSeg(arc.center, arc.radius, arc.startAngle, arc.sweepAngle * t),
    arcSeg(arc.center, arc.radius, cut, arc.sweepAngle * (1 - t)),
  ];
}

/** La parametrización de un arco es proporcional a su longitud. */
export function arcTAtLength(arc: ArcSeg, arcLengthMm: number): number {
  const total = arcLength(arc);
  return total === 0 ? 0 : clamp(arcLengthMm / total, 0, 1);
}

/** ¿Recorre el arco el ángulo dado? */
export function arcContainsAngle(arc: ArcSeg, angle: number): boolean {
  const direction = arc.sweepAngle >= 0 ? 1 : -1;
  const travelled = normalizeAngle((angle - arc.startAngle) * direction);
  return travelled <= Math.abs(arc.sweepAngle) + EPS_ANGLE;
}

/**
 * Caja envolvente exacta.
 *
 * Los extremos de cada coordenada de una circunferencia están en los cuatro
 * ángulos cardinales. Basta comprobar cuáles caen dentro del barrido y
 * añadirlos a los dos extremos del arco: no hace falta muestrear.
 */
export function arcBounds(arc: ArcSeg): Rect {
  const candidates: Vec2[] = [arcStart(arc), arcEnd(arc)];

  for (let quadrant = 0; quadrant < 4; quadrant++) {
    const angle = (quadrant * Math.PI) / 2;
    if (arcContainsAngle(arc, angle)) candidates.push(onCircle(arc, angle));
  }

  return rectFromPoints(candidates) ?? { min: arc.center, max: arc.center };
}

/** Barrido máximo por cúbica al aproximar. Más de 90° degrada la precisión. */
const MAX_CUBIC_SWEEP = Math.PI / 2;

/**
 * Aproxima el arco por cúbicas de Bézier.
 *
 * Se emplea la constante clásica `κ = (4/3)·tan(Δ/4)`, que sitúa los tiradores
 * de modo que la cúbica coincide con el arco en extremos, tangentes y punto
 * medio. Para tramos de 90° el error máximo es del orden de 2.7·10⁻⁴·R
 * —2.7 µm en un radio de 10 mm—, muy por debajo de cualquier tolerancia de
 * confección.
 *
 * `tan(Δ/4)` es negativo cuando el barrido lo es, así que la fórmula invierte
 * los tiradores por sí sola y no hace falta tratar el sentido aparte.
 *
 * Se necesita en dos sitios: al transformar un arco con una aplicación que no
 * es semejanza (deja de ser un arco) y al exportar a formatos sin arcos.
 */
export function arcToCubics(arc: ArcSeg, maxSweep: number = MAX_CUBIC_SWEEP): CubicSeg[] {
  const count = Math.max(1, Math.ceil(Math.abs(arc.sweepAngle) / maxSweep));
  const step = arc.sweepAngle / count;
  const handle = ((4 / 3) * Math.tan(step / 4)) * arc.radius;

  const out: CubicSeg[] = [];

  for (let i = 0; i < count; i++) {
    const a0 = arc.startAngle + i * step;
    const a1 = a0 + step;

    const p0 = onCircle(arc, a0);
    const p3 = onCircle(arc, a1);
    const t0 = vec2(-Math.sin(a0), Math.cos(a0));
    const t1 = vec2(-Math.sin(a1), Math.cos(a1));

    out.push(cubicSeg(p0, add(p0, scale(t0, handle)), sub(p3, scale(t1, handle)), p3));
  }

  return out;
}

/**
 * Aproxima el arco por una polilínea con desviación máxima `tolerance`.
 *
 * A diferencia de la cúbica, aquí el paso angular se despeja de forma exacta.
 * La flecha de una cuerda que subtiende un ángulo δ es `R·(1 − cos(δ/2))`;
 * igualarla a la tolerancia da `δ = 2·arccos(1 − tol/R)`. Ni subdivisión
 * adaptativa ni estimación de error: una fórmula.
 */
export function arcToPolyline(arc: ArcSeg, tolerance: number = CHORD_TOL_MM): Vec2[] {
  if (arc.radius <= 0) return [arcStart(arc), arcEnd(arc)];

  const ratio = clamp(1 - tolerance / arc.radius, -1, 1);
  const maxStep = Math.max(2 * Math.acos(ratio), 1e-4);
  const count = Math.max(1, Math.ceil(Math.abs(arc.sweepAngle) / maxStep));

  const points: Vec2[] = [];
  for (let i = 0; i <= count; i++) points.push(arcPointAt(arc, i / count));
  return points;
}

/**
 * Transforma el arco bajo una SEMEJANZA.
 *
 * Devuelve `null` si la transformación no lo es: bajo escalado no uniforme o
 * cizalla, la imagen de una circunferencia es una elipse y ya no cabe en este
 * tipo. Quien llame debe convertir a cúbicas en ese caso — de eso se encarga
 * `transformSegment` en `segment.ts`.
 *
 * Una reflexión invierte el sentido de giro, de ahí el cambio de signo del
 * barrido.
 */
export function arcTransform(arc: ArcSeg, m: Mat3): ArcSeg | null {
  if (!isSimilarityMatrix(m)) return null;

  const center = applyToPoint(m, arc.center);
  const radius = arc.radius * uniformScale(m);
  const mirrored = isMirrored(m);

  // El ángulo inicial se obtiene transformando el punto inicial: evita razonar
  // sobre cómo la matriz compone rotación y reflexión.
  const startAngle = angleOf(sub(applyToPoint(m, arcStart(arc)), center));

  return arcSeg(center, radius, startAngle, mirrored ? -arc.sweepAngle : arc.sweepAngle);
}

function isSimilarityMatrix(m: Mat3, tolerance = 1e-9): boolean {
  const equalLengths = Math.abs(m.a * m.a + m.b * m.b - (m.c * m.c + m.d * m.d));
  const orthogonal = Math.abs(m.a * m.c + m.b * m.d);
  return equalLengths <= tolerance && orthogonal <= tolerance;
}

/**
 * Arco que pasa por tres puntos, de `a` a `c` pasando por `b`.
 *
 * Es una construcción de trazado habitual: se conocen tres puntos por los que
 * debe pasar una curva de radio constante y se busca el arco correspondiente.
 * Devuelve `null` si los tres puntos son colineales, en cuyo caso el «arco»
 * de radio infinito es en realidad una recta y quien llama debe usar una.
 *
 * El centro es el circuncentro; el sentido lo dicta la orientación de `a→b→c`.
 */
export function arcThroughPoints(a: Vec2, b: Vec2, c: Vec2): ArcSeg | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (isZero(d, 1e-12)) return null;

  const sa = a.x * a.x + a.y * a.y;
  const sb = b.x * b.x + b.y * b.y;
  const sc = c.x * c.x + c.y * c.y;

  const center = vec2(
    (sa * (b.y - c.y) + sb * (c.y - a.y) + sc * (a.y - b.y)) / d,
    (sa * (c.x - b.x) + sb * (a.x - c.x) + sc * (b.x - a.x)) / d,
  );

  const radius = distance(a, center);
  const startAngle = angleOf(sub(a, center));
  const endAngle = angleOf(sub(c, center));

  const counterClockwise = cross(sub(b, a), sub(c, a)) > 0;
  let sweep = endAngle - startAngle;
  if (counterClockwise && sweep < 0) sweep += TAU;
  if (!counterClockwise && sweep > 0) sweep -= TAU;

  return arcSeg(center, radius, startAngle, sweep);
}

/** Desplaza el arco `distanceMm` hacia su normal izquierda: otro arco, concéntrico. */
export function offsetArc(arc: ArcSeg, distanceMm: number): ArcSeg {
  // La normal izquierda apunta hacia fuera si el barrido es horario.
  const outward = arc.sweepAngle >= 0 ? -1 : 1;
  const radius = Math.max(0, arc.radius + distanceMm * outward);
  return arcSeg(arc.center, radius, arc.startAngle, arc.sweepAngle);
}
