import type { Contour } from '@core/geometry/contour';
import { contour, contourLength, contourLocationAtLength } from '@core/geometry/contour';
import { LENGTH_TOL_MM } from '@core/geometry/epsilon';
import type { Segment } from '@core/geometry/segment';
import { segmentNormal, segmentPointAt, segmentReverse } from '@core/geometry/segment';
import type { Vec2 } from '@core/geometry/vec2';
import { negate } from '@core/geometry/vec2';

import type { EdgeId, PatternEdge, PatternPiece } from './types';

/** Segmentos del contorno que pertenecen a la arista, en orden de recorrido. */
export function edgeSegments(piece: PatternPiece, edge: PatternEdge): Segment[] {
  return piece.contour.segments.slice(
    edge.startSegment,
    edge.startSegment + edge.segmentCount,
  ) as Segment[];
}

/** La arista como contorno independiente (abierto). */
export function edgeContour(piece: PatternPiece, edge: PatternEdge): Contour {
  return contour(edgeSegments(piece, edge), false);
}

export function findEdge(piece: PatternPiece, id: EdgeId): PatternEdge | undefined {
  return piece.edges.find((edge) => edge.id === id);
}

/**
 * Longitud de la arista, en mm.
 *
 * Es la magnitud sobre la que se apoya toda la validación del patronaje: la
 * copa de manga debe medir lo que la sisa más el embebido, el costado
 * delantero lo que el de la espalda, el contorno de cintura lo que la medida
 * más el ease y las pinzas.
 */
export function edgeLength(
  piece: PatternPiece,
  edge: PatternEdge,
  tolerance: number = LENGTH_TOL_MM,
): number {
  return contourLength(edgeContour(piece, edge), tolerance);
}

export interface EdgeLocation {
  /** Índice del segmento DENTRO DEL CONTORNO de la pieza. */
  readonly segmentIndex: number;
  readonly t: number;
  readonly point: Vec2;
  /** Normal unitaria hacia FUERA de la pieza. */
  readonly outward: Vec2;
}

/**
 * Punto de la arista situado a `arcLength` de su inicio.
 *
 * Devuelve además la normal HACIA FUERA, que es lo que necesita quien coloque
 * algo sobre el margen: un piquete proyectado a la línea de corte, una marca de
 * pinza o una etiqueta.
 *
 * El contorno de la pieza se recorre en sentido antihorario, así que la normal
 * izquierda —la que devuelve `segmentNormal`— apunta hacia DENTRO y hay que
 * invertirla. Ese convenio único es lo que evita que los márgenes de unas
 * aristas salgan hacia fuera y los de otras hacia dentro.
 */
export function edgeLocationAtLength(
  piece: PatternPiece,
  edge: PatternEdge,
  arcLength: number,
): EdgeLocation | null {
  const local = contourLocationAtLength(edgeContour(piece, edge), arcLength);
  if (local === null) return null;

  const segmentIndex = edge.startSegment + local.segmentIndex;
  const segment = piece.contour.segments[segmentIndex];
  if (segment === undefined) return null;

  return {
    segmentIndex,
    t: local.t,
    point: segmentPointAt(segment, local.t),
    outward: negate(segmentNormal(segment, local.t)),
  };
}

/**
 * Muestrea la arista en `count + 1` puntos EQUIESPACIADOS EN LONGITUD DE ARCO.
 *
 * Es el paso 2 de la conversión a 3D (§7 de docs/ARCHITECTURE.md) y la razón
 * de que se pueda coser sin conocer de antemano la forma de las piezas: dos
 * aristas cosidas entre sí se muestrean con el mismo número de puntos por
 * parámetro de arco normalizado, de modo que el vértice *i* de una se empareja
 * con el vértice *i* de la otra aunque midan distinto. Esa diferencia de
 * longitud ES el embebido, y queda repartida de forma uniforme.
 *
 * Repartir por parámetro de curva en vez de por longitud produciría costuras
 * fruncidas en unos tramos y estiradas en otros.
 */
export function sampleEdgeByArcLength(
  piece: PatternPiece,
  edge: PatternEdge,
  count: number,
): EdgeLocation[] {
  if (count < 1) return [];

  const total = edgeLength(piece, edge);
  const samples: EdgeLocation[] = [];

  for (let i = 0; i <= count; i++) {
    const location = edgeLocationAtLength(piece, edge, (total * i) / count);
    if (location !== null) samples.push(location);
  }

  return samples;
}

/** La arista recorrida al revés, para coser dos piezas en sentidos opuestos. */
export function reversedEdgeSegments(piece: PatternPiece, edge: PatternEdge): Segment[] {
  return edgeSegments(piece, edge).map(segmentReverse).reverse();
}

/**
 * Margen efectivo de la arista.
 *
 * Una arista al doblez no se corta —la tela continúa al otro lado— así que su
 * margen es siempre cero, diga lo que diga el campo. Centralizar esta regla
 * evita que cada consumidor tenga que recordarla.
 */
export const effectiveSeamAllowance = (edge: PatternEdge): number =>
  edge.onFold ? 0 : Math.max(0, edge.seamAllowance);
