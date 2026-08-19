import type { EdgeLocation } from './edge';
import { edgeLength, findEdge, sampleEdgeByArcLength } from './edge';
import { seamId } from './ids';
import type { EdgeId, PatternPiece, PieceId, Seam, SeamEndpoint } from './types';

/** Colección de piezas indexada, tal como la consumen las funciones del grafo. */
export type PieceIndex = ReadonlyMap<PieceId, PatternPiece>;

export const indexPieces = (pieces: readonly PatternPiece[]): PieceIndex =>
  new Map(pieces.map((piece) => [piece.id, piece]));

export function createSeam(
  a: SeamEndpoint,
  b: SeamEndpoint,
  ease = 0,
): Seam {
  return { id: seamId(a.edge, b.edge), a, b, ease };
}

export const endpoint = (piece: PieceId, edge: EdgeId, reversed = false): SeamEndpoint => ({
  piece,
  edge,
  reversed,
});

export interface SeamLengths {
  readonly a: number;
  readonly b: number;
  /** `b − a`: el embebido REAL que impone la geometría. */
  readonly difference: number;
  /** `difference − ease`: lo que sobra o falta respecto a lo declarado. */
  readonly discrepancy: number;
}

/**
 * Longitudes de las dos aristas de una costura.
 *
 * Es la comprobación central del patronaje. Casi todo error de trazado se
 * manifiesta aquí: si la copa de manga no mide lo que la sisa más el embebido,
 * la manga no entra —o entra frunciendo— y no hay forma de arreglarlo en la
 * máquina de coser.
 */
export function seamLengths(seam: Seam, pieces: PieceIndex): SeamLengths | null {
  const a = resolveLength(seam.a, pieces);
  const b = resolveLength(seam.b, pieces);
  if (a === null || b === null) return null;

  const difference = b - a;
  return { a, b, difference, discrepancy: difference - seam.ease };
}

function resolveLength(end: SeamEndpoint, pieces: PieceIndex): number | null {
  const piece = pieces.get(end.piece);
  if (piece === undefined) return null;

  const edge = findEdge(piece, end.edge);
  if (edge === undefined) return null;

  return edgeLength(piece, edge);
}

export interface SeamPairing {
  /** Puntos sobre la arista `a`, en orden de cosido. */
  readonly a: readonly EdgeLocation[];
  /** Puntos sobre la arista `b`, emparejados uno a uno con los de `a`. */
  readonly b: readonly EdgeLocation[];
}

/**
 * Empareja las dos aristas de una costura punto a punto.
 *
 * ── El paso que hace posible coser en 3D ────────────────────────────────────
 *
 * Ambas aristas se muestrean con el MISMO número de puntos, repartidos por
 * longitud de arco NORMALIZADA. Así, el vértice *i* de una corresponde al
 * vértice *i* de la otra aunque las aristas midan distinto, y la diferencia de
 * longitud —el embebido— queda distribuida de forma uniforme a lo largo de toda
 * la costura, que es exactamente lo que hace una costurera al montar una manga.
 *
 * Es el paso 2 de la estrategia 2D→3D (§7 de docs/ARCHITECTURE.md). Si se
 * muestreara por parámetro de curva, o con distinto número de puntos, la
 * costura quedaría fruncida en unos tramos y estirada en otros, y el solver
 * tendría que resolver una tensión que no existe en la prenda real.
 *
 * `reversed` invierte el recorrido de la arista correspondiente. Sin ese
 * indicador las dos piezas se coserían retorcidas una sobre otra.
 */
export function pairSeamPoints(
  seam: Seam,
  pieces: PieceIndex,
  count: number,
): SeamPairing | null {
  const a = sampleEndpoint(seam.a, pieces, count);
  const b = sampleEndpoint(seam.b, pieces, count);
  if (a === null || b === null) return null;

  return { a, b };
}

function sampleEndpoint(
  end: SeamEndpoint,
  pieces: PieceIndex,
  count: number,
): EdgeLocation[] | null {
  const piece = pieces.get(end.piece);
  if (piece === undefined) return null;

  const edge = findEdge(piece, end.edge);
  if (edge === undefined) return null;

  const samples = sampleEdgeByArcLength(piece, edge, count);
  return end.reversed ? [...samples].reverse() : samples;
}

/** Costuras en las que participa una pieza. */
export const seamsOfPiece = (seams: readonly Seam[], piece: PieceId): Seam[] =>
  seams.filter((seam) => seam.a.piece === piece || seam.b.piece === piece);

/** ¿Está esta arista cosida a alguna otra? */
export const isEdgeSewn = (seams: readonly Seam[], piece: PieceId, edge: EdgeId): boolean =>
  seams.some(
    (seam) =>
      (seam.a.piece === piece && seam.a.edge === edge) ||
      (seam.b.piece === piece && seam.b.edge === edge),
  );

export interface OpenEdge {
  readonly piece: PieceId;
  readonly edge: EdgeId;
  readonly role: string;
}

/**
 * Aristas que no participan en ninguna costura.
 *
 * No todas son un error: un bajo, un escote acabado con vista o una línea de
 * doblez son aristas libres por diseño. Pero un hombro o un costado sin coser
 * sí lo son, y esta lista es el punto de partida para detectarlo — en la Fase
 * 11 será, además, la frontera abierta de la malla.
 */
export function openEdges(pieces: readonly PatternPiece[], seams: readonly Seam[]): OpenEdge[] {
  const result: OpenEdge[] = [];

  for (const piece of pieces) {
    for (const edge of piece.edges) {
      if (!isEdgeSewn(seams, piece.id, edge.id)) {
        result.push({ piece: piece.id, edge: edge.id, role: edge.role });
      }
    }
  }

  return result;
}
