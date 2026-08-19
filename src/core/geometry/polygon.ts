import { isZero } from './epsilon';
import type { Rect } from './rect';
import { rectFromPoints } from './rect';
import type { LineSeg } from './line';
import { lineSeg } from './line';
import type { Vec2 } from './vec2';
import { distance, vec2 } from './vec2';

/**
 * Polígono simple, dado por sus vértices en orden.
 *
 * El cierre es IMPLÍCITO: el último vértice se une al primero y no se repite.
 * Repetirlo es una fuente inagotable de errores de índice, de aristas de
 * longitud cero y de áreas mal calculadas, así que la representación lo
 * prohíbe por construcción.
 *
 * Es la forma aplanada de un `Contour` cerrado, y el formato que consumen el
 * cálculo de márgenes de costura (Fase 3) y la triangulación (Fase 11).
 */
export type Polygon = readonly Vec2[];

export type Orientation = 'ccw' | 'cw' | 'degenerate';

/**
 * Área con signo (fórmula del cordón de zapato).
 *
 *     2A = Σ (xᵢ·y_{i+1} − x_{i+1}·yᵢ)
 *
 * El SIGNO es tan útil como el valor: positivo indica recorrido antihorario.
 * De él dependen tres cosas del dominio — hacia qué lado se añade el margen de
 * costura, qué cara de la tela queda al derecho, y si una pieza reflejada ha
 * invertido su orientación y hay que corregirla.
 */
export function signedArea(polygon: Polygon): number {
  const n = polygon.length;
  if (n < 3) return 0;

  let total = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const current = polygon[i];
    const previous = polygon[j];
    if (current === undefined || previous === undefined) continue;
    total += previous.x * current.y - current.x * previous.y;
  }

  return total / 2;
}

export const polygonArea = (polygon: Polygon): number => Math.abs(signedArea(polygon));

export function polygonOrientation(polygon: Polygon, tolerance = 1e-9): Orientation {
  const area = signedArea(polygon);
  if (Math.abs(area) <= tolerance) return 'degenerate';
  return area > 0 ? 'ccw' : 'cw';
}

/** Devuelve el polígono con la orientación pedida, invirtiéndolo si hace falta. */
export function withOrientation(polygon: Polygon, orientation: 'ccw' | 'cw'): Polygon {
  const current = polygonOrientation(polygon);
  if (current === 'degenerate' || current === orientation) return polygon;
  return [...polygon].reverse();
}

export function polygonPerimeter(polygon: Polygon): number {
  const n = polygon.length;
  if (n < 2) return 0;

  let total = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const current = polygon[i];
    const previous = polygon[j];
    if (current === undefined || previous === undefined) continue;
    total += distance(previous, current);
  }

  return total;
}

export const polygonBounds = (polygon: Polygon): Rect | null => rectFromPoints(polygon);

/** Aristas del polígono, en orden de recorrido. */
export function polygonEdges(polygon: Polygon): LineSeg[] {
  const n = polygon.length;
  if (n < 2) return [];

  const edges: LineSeg[] = [];
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    if (a === undefined || b === undefined) continue;
    edges.push(lineSeg(a, b));
  }

  return edges;
}

/**
 * Centroide del área (no la media de los vértices).
 *
 * La media aritmética de los vértices se desplaza hacia las zonas donde hay
 * más vértices, que en un contorno aplanado es justo donde más curvatura
 * había. Como el aplanado reparte vértices según la tolerancia de cuerda, ese
 * error dependería de un ajuste de render — inadmisible para colocar la
 * etiqueta o la línea de hilo de una pieza.
 */
export function polygonCentroid(polygon: Polygon): Vec2 | null {
  const n = polygon.length;
  if (n === 0) return null;

  const area = signedArea(polygon);
  if (isZero(area, 1e-12)) {
    // Degenerado: sin área, el centroide del área no existe. Se usa la media.
    let sx = 0;
    let sy = 0;
    for (const p of polygon) {
      sx += p.x;
      sy += p.y;
    }
    return vec2(sx / n, sy / n);
  }

  let cx = 0;
  let cy = 0;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const current = polygon[i];
    const previous = polygon[j];
    if (current === undefined || previous === undefined) continue;

    const cross = previous.x * current.y - current.x * previous.y;
    cx += (previous.x + current.x) * cross;
    cy += (previous.y + current.y) * cross;
  }

  return vec2(cx / (6 * area), cy / (6 * area));
}

/**
 * ¿Contiene el polígono al punto?
 *
 * Número de cruces: se lanza un rayo horizontal hacia +X y se cuentan las
 * aristas que atraviesa; impar significa dentro.
 *
 * La comparación `(pᵢ.y > p.y) !== (p_j.y > p.y)` es lo que hace robusto el
 * algoritmo: al tratar cada arista como semiabierta en Y, un vértice a la
 * altura exacta del rayo se cuenta una sola vez en lugar de cero o dos, que es
 * el fallo clásico de las implementaciones ingenuas.
 *
 * El resultado en la propia frontera queda indefinido a propósito; para eso
 * está `distanceToPolygonBoundary`.
 */
export function polygonContains(polygon: Polygon, p: Vec2): boolean {
  const n = polygon.length;
  if (n < 3) return false;

  let inside = false;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;

    if (a.y > p.y !== b.y > p.y) {
      const crossingX = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < crossingX) inside = !inside;
    }
  }

  return inside;
}

/**
 * ¿Es simple el polígono, es decir, no se corta a sí mismo?
 *
 * Comprobación por pares, O(n²). Es aceptable para las decenas de vértices de
 * un contorno de pieza y deliberadamente sencilla: la alternativa —barrido de
 * Bentley-Ottmann, O(n log n)— es notoriamente delicada en los casos
 * degenerados y no se justifica hasta que el perfilado lo pida.
 *
 * Importa porque un contorno auto-intersecado no tiene interior bien definido:
 * ni área fiable, ni margen de costura, ni triangulación posible.
 */
export function polygonIsSimple(polygon: Polygon): boolean {
  const edges = polygonEdges(polygon);
  const n = edges.length;
  if (n < 4) return true;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Las aristas contiguas comparten un vértice: su contacto no es un corte.
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;

      const a = edges[i];
      const b = edges[j];
      if (a === undefined || b === undefined) continue;
      if (properlyIntersect(a, b)) return false;
    }
  }

  return true;
}

/** Cruce estricto de dos segmentos: sin contar contactos en los extremos. */
function properlyIntersect(p: LineSeg, q: LineSeg): boolean {
  const d1 = side(q.a, q.b, p.a);
  const d2 = side(q.a, q.b, p.b);
  const d3 = side(p.a, p.b, q.a);
  const d4 = side(p.a, p.b, q.b);

  return d1 * d2 < 0 && d3 * d4 < 0;
}

const side = (a: Vec2, b: Vec2, p: Vec2): number =>
  (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);

/** Distancia del punto a la frontera, siempre positiva. */
export function distanceToPolygonBoundary(polygon: Polygon, p: Vec2): number {
  let best = Number.POSITIVE_INFINITY;

  for (const edge of polygonEdges(polygon)) {
    const dx = edge.b.x - edge.a.x;
    const dy = edge.b.y - edge.a.y;
    const lenSq = dx * dx + dy * dy;

    const t = lenSq === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - edge.a.x) * dx + (p.y - edge.a.y) * dy) / lenSq));
    const d = Math.hypot(p.x - (edge.a.x + t * dx), p.y - (edge.a.y + t * dy));

    if (d < best) best = d;
  }

  return best;
}
