import poly2tri from 'poly2tri';

import type { Rect } from '@core/geometry/rect';
import { rectFromPoints } from '@core/geometry/rect';
import type { Polygon } from '@core/geometry/polygon';
import { distanceToPolygonBoundary, polygonContains, signedArea } from '@core/geometry/polygon';
import type { Vec2 } from '@core/geometry/vec2';
import { vec2 } from '@core/geometry/vec2';

export interface Triangulation {
  /** Vértices: los del contorno primero, luego los interiores. */
  readonly points: readonly Vec2[];
  /** Tres índices por triángulo. */
  readonly triangles: readonly number[];
  /** Cuántos de `points` son del contorno. */
  readonly boundaryCount: number;
}

/**
 * Distancia mínima de un punto interior al contorno, en fracción del paso.
 *
 * Un punto de Steiner demasiado pegado al borde produce un triángulo alargado y
 * muy agudo entre él y la arista del contorno — justo lo que hay que evitar.
 * Medio paso deja sitio para un triángulo bien formado.
 */
const BOUNDARY_CLEARANCE = 0.55;

/**
 * Genera puntos interiores en una RETÍCULA TRIANGULAR.
 *
 * ── Por qué triangular y no cuadrada ───────────────────────────────────────
 *
 * Una retícula cuadrada triangulada da triángulos rectángulos de 45-45-90: el
 * ángulo mínimo se queda en 45° y las diagonales son un 41 % más largas que los
 * lados, con lo que la malla tiene direcciones privilegiadas. Una retícula
 * triangular —filas alternas desplazadas medio paso— produce triángulos casi
 * equiláteros, de 60°, y sin dirección preferente.
 *
 * Importa más de lo que parece: el solver de tela de la Fase 13 reparte las
 * fuerzas por las aristas de la malla, y una malla con direcciones
 * privilegiadas hace que la tela se estire distinto según hacia dónde tire —un
 * artefacto que no existe en el tejido real.
 */
export function triangularLattice(bounds: Rect, spacing: number): Vec2[] {
  if (spacing <= 0) return [];

  const rowHeight = (spacing * Math.sqrt(3)) / 2;
  const points: Vec2[] = [];

  let row = 0;
  for (let y = bounds.min.y; y <= bounds.max.y + rowHeight; y += rowHeight) {
    const offset = row % 2 === 0 ? 0 : spacing / 2;

    for (let x = bounds.min.x + offset; x <= bounds.max.x + spacing; x += spacing) {
      points.push(vec2(x, y));
    }
    row++;
  }

  return points;
}

/**
 * Trianguliza un polígono con calidad controlada.
 *
 * ── Por qué CDT y no recorte de orejas ─────────────────────────────────────
 *
 * El «ear clipping» —el algoritmo de `earcut` y compañía— produce una
 * triangulación válida en tiempo récord, pero no controla la FORMA de los
 * triángulos: genera astillas de ángulos de un grado sin inmutarse. Para
 * dibujar da igual; para simular tela es fatal, porque el paso de tiempo
 * estable de un solver depende del triángulo peor formado de toda la malla, y
 * una sola astilla obliga a bajarlo para todos.
 *
 * La triangulación de Delaunay con restricciones MAXIMIZA el ángulo mínimo para
 * un conjunto de puntos dado. Combinada con una retícula interior uniforme, da
 * triángulos casi equiláteros a coste bajo — sin necesidad del refinamiento de
 * Ruppert completo.
 *
 * ── PRECONDICIÓN: el contorno ya viene muestreado ──────────────────────────
 *
 * Los lados de `polygon` deben medir aproximadamente `spacing`. Es lo que
 * garantiza `chainBoundary`, y no es un detalle: «para un conjunto de puntos
 * dado» es la letra pequeña de la propiedad de Delaunay. Un lado de contorno
 * mucho más largo que el paso obliga a triángulos alargados contra ese lado y
 * ninguna triangulación puede evitarlo, porque el lado hay que respetarlo.
 *
 * No se remuestrea aquí a propósito: los índices del contorno son la referencia
 * con la que el llamador localiza sus aristas y sus costuras. Añadir vértices
 * los desplazaría en silencio.
 */
export function triangulatePolygon(polygon: Polygon, spacing: number): Triangulation {
  if (polygon.length < 3) return { points: [], triangles: [], boundaryCount: 0 };

  /*
   * poly2tri exige el contorno en sentido antihorario. Las piezas del patrón ya
   * lo cumplen por invariante, pero comprobarlo aquí evita que un cambio
   * aguas arriba produzca una malla con las caras del revés — un fallo que sólo
   * se ve como una prenda invisible desde fuera.
   */
  const contour = signedArea(polygon) >= 0 ? [...polygon] : [...polygon].reverse();

  const bounds = rectFromPoints(contour);
  if (bounds === null) return { points: [], triangles: [], boundaryCount: 0 };

  const clearance = spacing * BOUNDARY_CLEARANCE;

  const interior = triangularLattice(bounds, spacing).filter(
    (point) =>
      polygonContains(contour, point) && distanceToPolygonBoundary(contour, point) > clearance,
  );

  const points: Vec2[] = [...contour, ...interior];

  // poly2tri identifica los puntos por referencia: hay que darle los MISMOS
  // objetos para poder recuperar el índice después.
  const indexOf = new Map<Vec2, number>();
  points.forEach((point, index) => indexOf.set(point, index));

  const context = new poly2tri.SweepContext(contour as poly2tri.IPointLike[]);
  if (interior.length > 0) context.addPoints(interior as poly2tri.IPointLike[]);
  context.triangulate();

  const triangles: number[] = [];

  for (const triangle of context.getTriangles()) {
    const a = indexOf.get(triangle.getPoint(0) as unknown as Vec2);
    const b = indexOf.get(triangle.getPoint(1) as unknown as Vec2);
    const c = indexOf.get(triangle.getPoint(2) as unknown as Vec2);

    if (a === undefined || b === undefined || c === undefined) continue;
    triangles.push(a, b, c);
  }

  return { points, triangles, boundaryCount: contour.length };
}

export interface AngleStats {
  readonly minDeg: number;
  readonly maxDeg: number;
  /** Mínimo sin contar los triángulos apoyados en una esquina aguda. */
  readonly minInteriorDeg: number;
  readonly degenerateCount: number;
}

/**
 * Estadísticas de los ángulos de una triangulación.
 *
 * ── Por qué se distingue el mínimo «interior» ──────────────────────────────
 *
 * El vértice de una pinza es un pico de cinco o diez grados EN EL PATRÓN. El
 * triángulo que lo ocupa tendrá forzosamente ese ángulo: ninguna triangulación
 * puede mejorarlo sin dejar de respetar el contorno, que es precisamente lo que
 * hay que cortar en la tela.
 *
 * Exigir un ángulo mínimo global sería, por tanto, exigir un imposible. Lo que
 * sí se puede —y se debe— exigir es que el RESTO de la malla esté bien formado,
 * y eso es lo que mide `minInteriorDeg`: el mínimo excluyendo los triángulos
 * que tocan una esquina aguda del contorno.
 */
export function angleStats(
  triangulation: Triangulation,
  sharpCornerThresholdDeg = 30,
): AngleStats {
  const sharp = sharpBoundaryCorners(triangulation, sharpCornerThresholdDeg);

  let minDeg = 180;
  let maxDeg = 0;
  let minInteriorDeg = 180;
  let degenerateCount = 0;

  for (let i = 0; i + 2 < triangulation.triangles.length; i += 3) {
    const ia = triangulation.triangles[i] ?? 0;
    const ib = triangulation.triangles[i + 1] ?? 0;
    const ic = triangulation.triangles[i + 2] ?? 0;

    const a = triangulation.points[ia];
    const b = triangulation.points[ib];
    const c = triangulation.points[ic];
    if (a === undefined || b === undefined || c === undefined) continue;

    const angles = triangleAngles(a, b, c);
    if (angles === null) {
      degenerateCount++;
      continue;
    }

    const smallest = Math.min(...angles);
    const largest = Math.max(...angles);

    minDeg = Math.min(minDeg, smallest);
    maxDeg = Math.max(maxDeg, largest);

    const touchesSharp = sharp.has(ia) || sharp.has(ib) || sharp.has(ic);
    if (!touchesSharp) minInteriorDeg = Math.min(minInteriorDeg, smallest);
  }

  return { minDeg, maxDeg, minInteriorDeg, degenerateCount };
}

/** Vértices del contorno cuyo ángulo interior es más agudo que el umbral. */
function sharpBoundaryCorners(
  triangulation: Triangulation,
  thresholdDeg: number,
): Set<number> {
  const sharp = new Set<number>();
  const n = triangulation.boundaryCount;
  if (n < 3) return sharp;

  for (let i = 0; i < n; i++) {
    const previous = triangulation.points[(i - 1 + n) % n];
    const current = triangulation.points[i];
    const next = triangulation.points[(i + 1) % n];
    if (previous === undefined || current === undefined || next === undefined) continue;

    const ax = previous.x - current.x;
    const ay = previous.y - current.y;
    const bx = next.x - current.x;
    const by = next.y - current.y;

    const lengthA = Math.hypot(ax, ay);
    const lengthB = Math.hypot(bx, by);
    if (lengthA === 0 || lengthB === 0) {
      sharp.add(i);
      continue;
    }

    const cosine = Math.min(1, Math.max(-1, (ax * bx + ay * by) / (lengthA * lengthB)));
    const angle = (Math.acos(cosine) * 180) / Math.PI;

    if (angle < thresholdDeg) sharp.add(i);
  }

  return sharp;
}

/** Los tres ángulos de un triángulo, en grados. `null` si es degenerado. */
function triangleAngles(a: Vec2, b: Vec2, c: Vec2): [number, number, number] | null {
  const ab = Math.hypot(b.x - a.x, b.y - a.y);
  const bc = Math.hypot(c.x - b.x, c.y - b.y);
  const ca = Math.hypot(a.x - c.x, a.y - c.y);

  if (ab < 1e-9 || bc < 1e-9 || ca < 1e-9) return null;

  const angle = (opposite: number, side1: number, side2: number): number => {
    const cosine = Math.min(
      1,
      Math.max(-1, (side1 * side1 + side2 * side2 - opposite * opposite) / (2 * side1 * side2)),
    );
    return (Math.acos(cosine) * 180) / Math.PI;
  };

  return [angle(bc, ab, ca), angle(ca, ab, bc), angle(ab, bc, ca)];
}

/** Longitud media de las aristas de la malla. */
export function meanEdgeLength(triangulation: Triangulation): number {
  let total = 0;
  let count = 0;

  for (let i = 0; i + 2 < triangulation.triangles.length; i += 3) {
    const indices = [
      triangulation.triangles[i] ?? 0,
      triangulation.triangles[i + 1] ?? 0,
      triangulation.triangles[i + 2] ?? 0,
    ];

    for (let k = 0; k < 3; k++) {
      const a = triangulation.points[indices[k] ?? 0];
      const b = triangulation.points[indices[(k + 1) % 3] ?? 0];
      if (a === undefined || b === undefined) continue;

      total += Math.hypot(b.x - a.x, b.y - a.y);
      count++;
    }
  }

  return count === 0 ? 0 : total / count;
}
