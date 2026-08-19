import type { Contour } from '@core/geometry/contour';
import { contourBounds, contourLength, contourToPolyline, contourTransform } from '@core/geometry/contour';
import { CHORD_TOL_MM } from '@core/geometry/epsilon';
import type { Mat3 } from '@core/geometry/mat3';
import { IDENTITY, applyToPoint, applyToVector, multiply } from '@core/geometry/mat3';
import type { Rect } from '@core/geometry/rect';
import type { Polygon } from '@core/geometry/polygon';
import { polygonOrientation } from '@core/geometry/polygon';
import { segmentToPolyline } from '@core/geometry/segment';
import type { Vec2 } from '@core/geometry/vec2';
import { angleOf, equals } from '@core/geometry/vec2';

import { effectiveSeamAllowance } from './edge';
import type { PatternEdge, PatternPiece, PieceId } from './types';

export interface CreatePieceOptions {
  readonly id: PieceId;
  readonly name: string;
  readonly contour: Contour;
  readonly edges: readonly PatternEdge[];
  readonly notches?: PatternPiece['notches'];
  readonly grainLine?: PatternPiece['grainLine'];
  readonly labels?: PatternPiece['labels'];
  readonly placement?: Mat3;
  readonly cutCount?: number;
}

export function createPiece(options: CreatePieceOptions): PatternPiece {
  return {
    id: options.id,
    name: options.name,
    contour: options.contour,
    edges: options.edges,
    notches: options.notches ?? [],
    grainLine: options.grainLine ?? null,
    labels: options.labels ?? [],
    placement: options.placement ?? IDENTITY,
    cutCount: options.cutCount ?? 1,
  };
}

/** Perímetro de la línea de costura. */
export const pieceLength = (piece: PatternPiece): number => contourLength(piece.contour);

/** Caja envolvente en coordenadas LOCALES. */
export const pieceBounds = (piece: PatternPiece): Rect | null => contourBounds(piece.contour);

/** Caja envolvente en coordenadas del DOCUMENTO, con la colocación aplicada. */
export function piecePlacedBounds(piece: PatternPiece): Rect | null {
  return contourBounds(contourTransform(piece.contour, piece.placement));
}

/**
 * Compone una transformación sobre la colocación existente.
 *
 * Mover, girar o reflejar una pieza NO toca su geometría: sólo cambia la matriz
 * que la sitúa en el documento. Así, regenerar el patrón tras cambiar una
 * medida conserva la disposición que el usuario había preparado, y el nido de
 * piezas para el corte no se deshace en cada edición.
 */
export function placePiece(piece: PatternPiece, transform: Mat3): PatternPiece {
  return { ...piece, placement: multiply(transform, piece.placement) };
}

export const withPlacement = (piece: PatternPiece, placement: Mat3): PatternPiece => ({
  ...piece,
  placement,
});

/** Contorno de la pieza expresado en coordenadas del documento. */
export const placedContour = (piece: PatternPiece): Contour =>
  contourTransform(piece.contour, piece.placement);

export const toDocument = (piece: PatternPiece, local: Vec2): Vec2 =>
  applyToPoint(piece.placement, local);

export const directionToDocument = (piece: PatternPiece, local: Vec2): Vec2 =>
  applyToVector(piece.placement, local);

/** Ángulo de la línea de hilo una vez colocada la pieza en el documento. */
export function grainAngleInDocument(piece: PatternPiece): number | null {
  if (piece.grainLine === null) return null;

  const direction = applyToVector(piece.placement, {
    x: Math.cos(piece.grainLine.angle),
    y: Math.sin(piece.grainLine.angle),
  });

  return angleOf(direction);
}

/** Muestra de la línea de costura como polígono, junto con la arista de origen. */
export interface FlattenedBoundary {
  readonly polygon: Polygon;
  /**
   * Índice de la arista a la que pertenece cada LADO del polígono.
   * `edgeOfSide[i]` corresponde al lado que va de `polygon[i]` a `polygon[i+1]`.
   */
  readonly edgeOfSide: readonly number[];
}

/**
 * Aplana el contorno conservando de qué arista viene cada tramo.
 *
 * La atribución es imprescindible para el margen variable: sin ella no se
 * sabría qué anchura aplicar a cada lado del polígono aplanado, que es la
 * entrada de `offsetPolygon`.
 */
export function flattenBoundary(
  piece: PatternPiece,
  tolerance: number = CHORD_TOL_MM,
): FlattenedBoundary {
  const edgeBySegment = edgeIndexBySegment(piece);

  const polygon: Vec2[] = [];
  const edgeOfSide: number[] = [];

  for (let index = 0; index < piece.contour.segments.length; index++) {
    const segment = piece.contour.segments[index];
    if (segment === undefined) continue;

    const owner = edgeBySegment[index] ?? -1;
    const points = segmentToPolyline(segment, tolerance);

    for (const point of points) {
      const previous = polygon.at(-1);
      if (previous !== undefined && equals(previous, point)) continue;
      polygon.push(point);
      if (polygon.length > 1) edgeOfSide.push(owner);
    }
  }

  // El contorno es cerrado: el último vértice coincide con el primero.
  const first = polygon[0];
  const last = polygon.at(-1);
  if (polygon.length > 1 && first !== undefined && last !== undefined && equals(first, last)) {
    polygon.pop();
    edgeOfSide.pop();
  }

  // Lado de cierre, del último vértice al primero.
  const lastSegment = piece.contour.segments.length - 1;
  edgeOfSide.push(edgeBySegment[lastSegment] ?? -1);

  return { polygon, edgeOfSide };
}

/** Tabla segmento → índice de arista. `-1` si el segmento no pertenece a ninguna. */
export function edgeIndexBySegment(piece: PatternPiece): number[] {
  const table = new Array<number>(piece.contour.segments.length).fill(-1);

  piece.edges.forEach((edge, edgeIndex) => {
    for (let i = 0; i < edge.segmentCount; i++) {
      const target = edge.startSegment + i;
      if (target >= 0 && target < table.length) table[target] = edgeIndex;
    }
  });

  return table;
}

/** Anchura de margen por LADO del polígono aplanado. */
export function seamAllowancePerSide(
  piece: PatternPiece,
  boundary: FlattenedBoundary,
): number[] {
  return boundary.edgeOfSide.map((edgeIndex) => {
    const edge = piece.edges[edgeIndex];
    return edge === undefined ? 0 : effectiveSeamAllowance(edge);
  });
}

/** ¿Se recorre el contorno en sentido antihorario, como exige el modelo? */
export function pieceOrientation(piece: PatternPiece): ReturnType<typeof polygonOrientation> {
  return polygonOrientation(contourToPolyline(piece.contour, 1));
}
