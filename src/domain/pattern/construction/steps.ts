import type { CubicSeg } from '@core/geometry/cubic';
import { cubicLength, cubicSeg, cubicSubsegment, cubicTAtLength } from '@core/geometry/cubic';
import { intersectInfiniteLines } from '@core/geometry/intersect';
import type { LineSeg } from '@core/geometry/line';
import { lineSeg, perpendicularFoot as footOnLine } from '@core/geometry/line';
import { degToRad } from '@core/geometry/math';
import { solveIncreasing } from '@core/numeric/solve';
import type { Vec2 } from '@core/geometry/vec2';
import {
  add,
  distance,
  fromPolar,
  lerpVec,
  mirror,
  normalize,
  perpLeft,
  perpRight,
  scale,
  sub,
  vec2,
} from '@core/geometry/vec2';

/**
 * Vocabulario de construcción — nivel B del DAG (§3.4 de docs/ARCHITECTURE.md).
 *
 * Son las operaciones con las que un patronista describe un trazado: «desde
 * este punto, a tantos milímetros, en tal dirección», «donde se cortan estas
 * dos líneas», «el simétrico de aquel respecto al centro». Cada generador se
 * escribe con este vocabulario y no con aritmética suelta sobre coordenadas.
 *
 * La diferencia no es estética. Un trazado escrito así se LEE como el manual
 * del que procede, y cada paso es una función pura verificable por separado;
 * el mismo trazado escrito con sumas y restas de coordenadas es imposible de
 * revisar contra la fuente de la que salió.
 */

/** Desde `from`, a `distance` milímetros, en dirección `angleDegrees`. */
export const pointAtDistanceAngle = (from: Vec2, distanceMm: number, angleDegrees: number): Vec2 =>
  add(from, fromPolar(distanceMm, degToRad(angleDegrees)));

/** Desplazamiento en coordenadas locales. */
export const pointOffset = (from: Vec2, dx: number, dy: number): Vec2 =>
  vec2(from.x + dx, from.y + dy);

/** Punto que divide el segmento `a→b` en la fracción `t`. */
export const pointBetween = (a: Vec2, b: Vec2, t: number): Vec2 => lerpVec(a, b, t);

/** Punto a `distanceMm` de `a` en dirección a `b`. */
export function pointTowards(a: Vec2, b: Vec2, distanceMm: number): Vec2 {
  return add(a, scale(normalize(sub(b, a)), distanceMm));
}

/** Corte de las rectas infinitas que soportan dos segmentos. */
export const intersection = (a: LineSeg, b: LineSeg): Vec2 | null => intersectInfiniteLines(a, b);

/** Pie de la perpendicular desde un punto a una recta. */
export const perpendicularFoot = (point: Vec2, line: LineSeg): Vec2 => footOnLine(line, point);

/** Simétrico respecto al eje que pasa por `a` y `b`. */
export const mirrorPoint = (point: Vec2, a: Vec2, b: Vec2): Vec2 => mirror(point, a, b);

/**
 * Curva de cintura: sale HORIZONTAL del centro y llega HORIZONTAL al costado,
 * subiendo `rise` milímetros por el camino.
 *
 * Las dos tangentes horizontales no son una elección estética. La cintura debe
 * cortar el centro delantero en ángulo recto —si no, al abrir la pieza por el
 * doblez aparecería un pico— y debe llegar al costado también perpendicular a
 * la costura, que ahí es casi vertical. Es el mismo requisito por los dos
 * extremos.
 */
export const waistCurve = (from: Vec2, run: number, rise: number): CubicSeg =>
  cubicSeg(
    from,
    pointOffset(from, run / 3, 0),
    pointOffset(from, (run * 2) / 3, rise),
    pointOffset(from, run, rise),
  );

/**
 * Resuelve qué anchura da a la curva de cintura la LONGITUD pedida.
 *
 * ── Por qué hace falta resolver ────────────────────────────────────────────
 *
 * La cintura del patrón tiene que medir exactamente lo que la cintura del
 * cuerpo más la holgura más las pinzas. Pero la línea SUBE hacia el costado,
 * así que su longitud es mayor que su proyección horizontal, y no en una
 * cantidad que se pueda despejar: la longitud de una Bézier no tiene forma
 * cerrada.
 *
 * El trazado clásico resuelve esto dibujando y «afinando» a ojo con la cinta
 * métrica. Aquí se hace con la inversión numérica que existe desde la Fase 2
 * (§3.3): la longitud crece de forma monótona con la anchura, así que una
 * bisección la encuentra en microsegundos y con precisión exacta.
 *
 * Es el ejemplo de por qué no hace falta un solver de restricciones completo
 * (decisión D2): las preguntas inversas del patronaje son de una variable.
 */
export function solveWaistRun(targetLength: number, rise: number): number {
  if (targetLength <= 0) return 0;

  const lengthFor = (run: number): number => cubicLength(waistCurve(vec2(0, 0), run, rise), 1e-6);

  // La longitud nunca baja de la anchura, así que el objetivo acota la búsqueda.
  return solveIncreasing(lengthFor, targetLength, 0, targetLength, { tolerance: 1e-6 });
}

export interface DartOnCurve {
  /** Tramo de curva anterior a la pinza. */
  readonly before: CubicSeg;
  /** Tramo posterior. */
  readonly after: CubicSeg;
  /** Extremo de la pinza en el tramo anterior. */
  readonly legStart: Vec2;
  /** Extremo en el tramo posterior. */
  readonly legEnd: Vec2;
  readonly apex: Vec2;
}

/**
 * Abre una pinza sobre una curva, en una posición dada por LONGITUD DE ARCO.
 *
 * La posición y la anchura se miden sobre la curva y no en horizontal: es como
 * se marca con la cinta sobre el papel, y es lo que hace que la pinza siga
 * valiendo lo mismo cuando la curva cambia de forma al cambiar de talla.
 *
 * Cerrar la pinza junta las dos patas y hace desaparecer el trozo de curva que
 * hay entre ellas: por eso su anchura es exactamente lo que se recoge.
 *
 * ── El lado del vértice es EXPLÍCITO ───────────────────────────────────────
 *
 * Una pinza debe QUITAR material, no añadirlo, y de qué lado está el interior
 * de la pieza depende del sentido en que se trace la curva: en una falda la
 * cintura se recorre hacia el costado y el interior queda abajo; en un cuerpo,
 * la misma cintura tiene el interior arriba.
 *
 * Se pide el lado en vez de deducirlo porque lo insidioso de equivocarse es que
 * casi ninguna comprobación lo detecta: la abertura mide lo mismo en un sentido
 * que en otro, así que el contorno de cintura sigue casando con la medida, el
 * polígono sigue siendo simple y el validador no protesta. Sólo se ve
 * dibujándolo — y así se encontró la primera vez.
 */
export function dartOnCurve(
  curve: CubicSeg,
  centerAtLength: number,
  intake: number,
  depth: number,
  side: 'left' | 'right' = 'right',
): DartOnCurve {
  const total = cubicLength(curve);
  const half = intake / 2;

  const startLength = Math.max(0, Math.min(total, centerAtLength - half));
  const endLength = Math.max(0, Math.min(total, centerAtLength + half));

  const tStart = cubicTAtLength(curve, startLength);
  const tEnd = cubicTAtLength(curve, endLength);

  const before = cubicSubsegment(curve, 0, tStart);
  const after = cubicSubsegment(curve, tEnd, 1);

  const legStart = before.p3;
  const legEnd = after.p0;

  // Perpendicular a la cuerda de la abertura, al lado pedido.
  const opening = sub(legEnd, legStart);
  const normal = side === 'right' ? perpRight(opening) : perpLeft(opening);
  const apex = add(lerpVec(legStart, legEnd, 0.5), scale(normalize(normal), depth));

  return { before, after, legStart, legEnd, apex };
}

/** Segmento recto entre dos puntos. Reexportado para el vocabulario. */
export const line = (a: Vec2, b: Vec2): LineSeg => lineSeg(a, b);

/** Distancia entre dos puntos, para las aserciones de los generadores. */
export const measure = (a: Vec2, b: Vec2): number => distance(a, b);
