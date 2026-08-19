import { isZero } from './epsilon';
import { intersectInfiniteLines } from './intersect';
import { lineThrough } from './line';
import { TAU, clamp } from './math';
import type { Polygon } from './polygon';
import { polygonOrientation, signedArea } from './polygon';
import type { Vec2 } from './vec2';
import { add, angleOf, cross, distance, fromPolar, normalize, perpRight, scale, sub } from './vec2';

/**
 * Tratamiento de las esquinas al desplazar un contorno.
 *
 * `miter` prolonga las dos líneas desplazadas hasta cortarse. Es el que quiere
 * el patronaje: la esquina del margen debe ser un pico limpio para que la
 * pieza doble bien al coser. `round` y `bevel` existen para los casos en que
 * el pico se dispara —esquinas muy agudas— y como opción explícita.
 */
export type JoinStyle = 'miter' | 'round' | 'bevel';

export interface OffsetOptions {
  readonly join?: JoinStyle;
  /**
   * Longitud máxima del pico, en múltiplos de la anchura. Superado el límite se
   * recorta a bisel. Sin límite, una esquina de 1° produciría un pico de metros.
   */
  readonly miterLimit?: number;
  /** Tolerancia de cuerda de las juntas redondeadas, en mm. */
  readonly arcTolerance?: number;
}

const DEFAULT_MITER_LIMIT = 4;
const DEFAULT_ARC_TOLERANCE = 0.05;

/** Iteraciones máximas de limpieza. Cada una elimina al menos un lazo. */
const MAX_CLEANUP_ITERATIONS = 256;

/**
 * Desplaza un polígono CERRADO hacia fuera, con anchura propia por arista.
 *
 * ── Requisito de orientación ────────────────────────────────────────────────
 *
 * El polígono debe recorrerse en sentido ANTIHORARIO. Con ese convenio el
 * interior queda a la izquierda y «hacia fuera» es la normal derecha, de modo
 * que una anchura positiva siempre añade material. Es el mismo convenio que
 * usa `segmentNormal` en `segment.ts`; romperlo aquí haría que los márgenes se
 * dibujaran hacia dentro de la pieza.
 *
 * ── Anchura variable ────────────────────────────────────────────────────────
 *
 * Cada arista lleva su propio margen porque así son los patrones reales: 6 mm
 * en un escote curvo, 12 en un costado, 30 o 40 en un bajo. Es también la razón
 * de que no sirva una biblioteca de inflado de polígonos genérica, que trabaja
 * con un único delta.
 *
 * ── Limitación conocida ─────────────────────────────────────────────────────
 *
 * La limpieza de auto-intersecciones (`removeSelfIntersections`) resuelve los
 * lazos aislados, que son los que aparecen en piezas normales. No resuelve el
 * caso en que el desplazamiento parte la figura en varias regiones inconexas
 * —posible con márgenes mayores que el ancho local de la pieza— porque el tipo
 * de retorno es un único polígono. Ver la nota de la Fase 3 en el README.
 */
export function offsetPolygon(
  polygon: Polygon,
  widths: readonly number[],
  options: OffsetOptions = {},
): Polygon {
  const n = polygon.length;
  if (n < 3) return polygon;

  const join = options.join ?? 'miter';
  const miterLimit = options.miterLimit ?? DEFAULT_MITER_LIMIT;
  const arcTolerance = options.arcTolerance ?? DEFAULT_ARC_TOLERANCE;

  const raw: Vec2[] = [];

  for (let i = 0; i < n; i++) {
    const previousIndex = (i - 1 + n) % n;
    const nextIndex = (i + 1) % n;

    const vertex = polygon[i];
    const before = polygon[previousIndex];
    const after = polygon[nextIndex];
    if (vertex === undefined || before === undefined || after === undefined) continue;

    const incoming = normalize(sub(vertex, before));
    const outgoing = normalize(sub(after, vertex));
    if (isZero(incoming.x) && isZero(incoming.y)) continue;
    if (isZero(outgoing.x) && isZero(outgoing.y)) continue;

    const widthIn = widths[previousIndex] ?? 0;
    const widthOut = widths[i] ?? 0;

    // Normal derecha = hacia fuera en un recorrido antihorario.
    const normalIn = perpRight(incoming);
    const normalOut = perpRight(outgoing);

    const arrival = add(vertex, scale(normalIn, widthIn));
    const departure = add(vertex, scale(normalOut, widthOut));

    const turn = cross(incoming, outgoing);

    // Aristas colineales: sin esquina que resolver.
    if (isZero(turn, 1e-12)) {
      raw.push(arrival);
      // Si el margen cambia, la línea de corte da un escalón perpendicular.
      if (!isZero(widthIn - widthOut)) raw.push(departure);
      continue;
    }

    const miter = intersectInfiniteLines(
      lineThrough(arrival, incoming),
      lineThrough(departure, outgoing),
    );

    /*
     * Vértice REFLEXIVO (giro a la derecha en recorrido antihorario): las dos
     * líneas desplazadas se solapan y el punto de corte cae «por detrás». Es
     * geométricamente el punto correcto, pero deja un lazo que la limpieza
     * posterior eliminará.
     */
    if (turn < 0) {
      raw.push(miter ?? arrival, ...(miter === null ? [departure] : []));
      continue;
    }

    // Vértice CONVEXO: el desplazamiento abre un hueco que hay que rellenar.
    const widest = Math.max(widthIn, widthOut);
    const withinLimit =
      miter !== null && (widest === 0 || distance(miter, vertex) <= miterLimit * widest);

    if (join === 'miter' && withinLimit && miter !== null) {
      raw.push(miter);
    } else if (join === 'round') {
      raw.push(...roundJoin(vertex, arrival, departure, widthIn, widthOut, arcTolerance));
    } else {
      raw.push(arrival, departure);
    }
  }

  return removeSelfIntersections(dedupeConsecutive(raw), polygonOrientation(polygon));
}

/** Desplazamiento uniforme: azúcar sobre el caso general. */
export function offsetPolygonUniform(
  polygon: Polygon,
  width: number,
  options?: OffsetOptions,
): Polygon {
  return offsetPolygon(polygon, new Array<number>(polygon.length).fill(width), options);
}

/**
 * Junta redondeada entre dos anchuras distintas.
 *
 * Con anchuras iguales es un arco exacto centrado en el vértice. Con anchuras
 * distintas el lugar geométrico correcto es una espiral, que se aproxima
 * interpolando el radio linealmente con el ángulo: la diferencia es
 * inapreciable para las magnitudes de un margen de costura, y evita introducir
 * un tipo de curva nuevo en el modelo.
 */
function roundJoin(
  vertex: Vec2,
  arrival: Vec2,
  departure: Vec2,
  widthIn: number,
  widthOut: number,
  arcTolerance: number,
): Vec2[] {
  const startAngle = angleOf(sub(arrival, vertex));
  const endAngle = angleOf(sub(departure, vertex));

  let sweep = endAngle - startAngle;
  while (sweep <= -Math.PI) sweep += TAU;
  while (sweep > Math.PI) sweep -= TAU;

  const radius = Math.max(widthIn, widthOut);
  if (radius <= 0) return [arrival, departure];

  const ratio = clamp(1 - arcTolerance / radius, -1, 1);
  const step = Math.max(2 * Math.acos(ratio), 1e-3);
  const count = Math.max(1, Math.ceil(Math.abs(sweep) / step));

  const points: Vec2[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    points.push(add(vertex, fromPolar(widthIn + (widthOut - widthIn) * t, startAngle + sweep * t)));
  }

  return points;
}

function dedupeConsecutive(points: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];

  for (const point of points) {
    const previous = out.at(-1);
    if (previous !== undefined && distance(previous, point) <= 1e-9) continue;
    out.push(point);
  }

  const first = out[0];
  const last = out.at(-1);
  if (out.length > 1 && first !== undefined && last !== undefined && distance(first, last) <= 1e-9) {
    out.pop();
  }

  return out;
}

/**
 * Elimina los lazos que deja un desplazamiento en las esquinas reflexivas.
 *
 * Al desplazar hacia fuera, cada vértice cóncavo produce un cruce del contorno
 * consigo mismo y un pequeño lazo sobrante. El procedimiento es directo:
 * localizar el primer cruce, partir el contorno en los dos ciclos que genera y
 * quedarse con el de MAYOR ÁREA.
 *
 * El criterio del área no es arbitrario: el resultado correcto de un
 * desplazamiento hacia fuera es la frontera exterior, y los lazos espurios son
 * siempre bolsas pequeñas y de orientación invertida respecto al contorno.
 *
 * La búsqueda de cruces es O(n²) por iteración. Con las decenas o cientos de
 * vértices de una pieza aplanada es irrelevante; sustituirla por un barrido de
 * Bentley-Ottmann sólo se justificará si el perfilado lo pide.
 */
export function removeSelfIntersections(
  polygon: Polygon,
  expected: ReturnType<typeof polygonOrientation> = 'ccw',
  maxIterations: number = MAX_CLEANUP_ITERATIONS,
): Polygon {
  let current: Vec2[] = [...polygon];

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const crossing = findFirstCrossing(current);
    if (crossing === null) break;

    const { i, j, point } = crossing;

    const outer = [...current.slice(0, i + 1), point, ...current.slice(j + 1)];
    const inner = [point, ...current.slice(i + 1, j + 1)];

    const outerArea = Math.abs(signedArea(outer));
    const innerArea = Math.abs(signedArea(inner));

    const candidate = outerArea >= innerArea ? outer : inner;
    if (candidate.length < 3) break;

    current = dedupeConsecutive(candidate);
  }

  // El recorte puede haber invertido el sentido; se restituye el esperado.
  if (expected !== 'degenerate' && polygonOrientation(current) !== expected) {
    current.reverse();
  }

  return current;
}

interface Crossing {
  readonly i: number;
  readonly j: number;
  readonly point: Vec2;
}

function findFirstCrossing(polygon: readonly Vec2[]): Crossing | null {
  const n = polygon.length;
  if (n < 4) return null;

  for (let i = 0; i < n; i++) {
    const a0 = polygon[i];
    const a1 = polygon[(i + 1) % n];
    if (a0 === undefined || a1 === undefined) continue;

    for (let j = i + 2; j < n; j++) {
      // Las aristas contiguas comparten un vértice: su contacto no es un cruce.
      if (i === 0 && j === n - 1) continue;

      const b0 = polygon[j];
      const b1 = polygon[(j + 1) % n];
      if (b0 === undefined || b1 === undefined) continue;

      const hits = intersectSegmentsStrict(a0, a1, b0, b1);
      if (hits !== null) return { i, j, point: hits };
    }
  }

  return null;
}

/**
 * Cruce ESTRICTO de dos segmentos: descarta los contactos en los extremos.
 *
 * La exigencia de estricto no es un detalle. Sin ella, el vértice que comparten
 * dos aristas contiguas se detectaría como un cruce y la limpieza entraría en
 * un bucle recortándose a sí misma hasta agotar las iteraciones.
 */
function intersectSegmentsStrict(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): Vec2 | null {
  const point = intersectInfiniteLines(
    lineThrough(a0, sub(a1, a0)),
    lineThrough(b0, sub(b1, b0)),
  );
  if (point === null) return null;

  const strictlyInside = (a: Vec2, b: Vec2): boolean => {
    const t = parameterOnSegment(a, b, point);
    return t > 1e-9 && t < 1 - 1e-9;
  };

  return strictlyInside(a0, a1) && strictlyInside(b0, b1) ? point : null;
}

function parameterOnSegment(a: Vec2, b: Vec2, p: Vec2): number {
  const direction = sub(b, a);
  const lengthSq = direction.x * direction.x + direction.y * direction.y;
  if (lengthSq === 0) return 0;
  return ((p.x - a.x) * direction.x + (p.y - a.y) * direction.y) / lengthSq;
}
