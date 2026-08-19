import type { ContourIssue } from '@core/geometry/contour';
import { contourToPolyline, validateContour } from '@core/geometry/contour';
import { polygonIsSimple, polygonOrientation } from '@core/geometry/polygon';

import { edgeLength, findEdge } from './edge';
import { allowanceAddsMaterial } from './seamAllowance';
import type { PieceIndex } from './seam';
import { seamLengths } from './seam';
import type { EdgeId, PatternPiece, Seam } from './types';

/**
 * Tolerancia por defecto al casar dos costuras, en mm.
 *
 * Dos milímetros es lo que una costurera absorbe sin pensar en una costura
 * larga. Por encima, la pieza no monta.
 */
export const SEAM_MATCH_TOLERANCE_MM = 2;

export type PieceIssue =
  | { readonly kind: 'contour'; readonly issue: ContourIssue }
  | { readonly kind: 'not-closed' }
  | { readonly kind: 'not-simple' }
  | { readonly kind: 'wrong-orientation'; readonly found: string }
  | { readonly kind: 'no-edges' }
  | {
      readonly kind: 'edges-not-a-partition';
      readonly segmentIndex: number;
      readonly coverage: number;
    }
  | { readonly kind: 'negative-allowance'; readonly edge: EdgeId }
  | { readonly kind: 'notch-out-of-range'; readonly edge: EdgeId; readonly arcLength: number }
  | { readonly kind: 'notch-unknown-edge'; readonly edge: EdgeId }
  | { readonly kind: 'allowance-removes-material' };

/**
 * Comprueba los invariantes de una pieza.
 *
 * Se ejecuta tras cada regeneración paramétrica, no sólo en los tests. Los
 * defectos que busca comparten una característica desagradable: son invisibles
 * en pantalla y se manifiestan mucho después de su causa —al exportar, al
 * mallar, al coser— cuando ya no es obvio de dónde vienen.
 */
export function validatePiece(piece: PatternPiece): PieceIssue[] {
  const issues: PieceIssue[] = [];

  for (const issue of validateContour(piece.contour)) {
    issues.push({ kind: 'contour', issue });
  }

  if (!piece.contour.closed) issues.push({ kind: 'not-closed' });

  const polygon = contourToPolyline(piece.contour, 0.2);

  if (polygon.length >= 3) {
    /*
     * Un contorno que se corta a sí mismo no tiene interior bien definido: ni
     * área fiable, ni margen de costura, ni triangulación posible en la Fase 11.
     */
    if (!polygonIsSimple(polygon)) issues.push({ kind: 'not-simple' });

    const orientation = polygonOrientation(polygon);
    if (orientation !== 'ccw') issues.push({ kind: 'wrong-orientation', found: orientation });
  }

  issues.push(...validateEdgePartition(piece));

  for (const edge of piece.edges) {
    if (edge.seamAllowance < 0) issues.push({ kind: 'negative-allowance', edge: edge.id });
  }

  for (const notch of piece.notches) {
    const edge = findEdge(piece, notch.edge);
    if (edge === undefined) {
      issues.push({ kind: 'notch-unknown-edge', edge: notch.edge });
      continue;
    }

    const total = edgeLength(piece, edge);
    if (notch.arcLength < -1e-6 || notch.arcLength > total + 1e-6) {
      issues.push({
        kind: 'notch-out-of-range',
        edge: notch.edge,
        arcLength: notch.arcLength,
      });
    }
  }

  // Sólo tiene sentido si la geometría de partida ya es coherente.
  if (issues.length === 0 && !allowanceAddsMaterial(piece)) {
    issues.push({ kind: 'allowance-removes-material' });
  }

  return issues;
}

/**
 * Las aristas deben formar una PARTICIÓN del contorno.
 *
 * Cada segmento pertenece exactamente a una arista: ni a ninguna —un tramo sin
 * identidad no se puede coser ni acotar— ni a dos, que daría margen doble y
 * emparejamientos ambiguos en el grafo de costuras.
 */
function validateEdgePartition(piece: PatternPiece): PieceIssue[] {
  const total = piece.contour.segments.length;
  if (piece.edges.length === 0) return total === 0 ? [] : [{ kind: 'no-edges' }];

  const coverage = new Array<number>(total).fill(0);

  for (const edge of piece.edges) {
    for (let i = 0; i < edge.segmentCount; i++) {
      const index = edge.startSegment + i;
      if (index < 0 || index >= total) continue;
      coverage[index] = (coverage[index] ?? 0) + 1;
    }
  }

  const issues: PieceIssue[] = [];
  for (let i = 0; i < total; i++) {
    const count = coverage[i] ?? 0;
    if (count !== 1) {
      issues.push({ kind: 'edges-not-a-partition', segmentIndex: i, coverage: count });
    }
  }

  return issues;
}

export const isValidPiece = (piece: PatternPiece): boolean => validatePiece(piece).length === 0;

export type SeamIssue =
  | { readonly kind: 'unknown-piece'; readonly seam: string }
  | { readonly kind: 'unknown-edge'; readonly seam: string }
  | {
      readonly kind: 'length-mismatch';
      readonly seam: string;
      readonly lengthA: number;
      readonly lengthB: number;
      readonly ease: number;
      readonly discrepancy: number;
    };

/**
 * Comprueba que una costura puede coserse.
 *
 * El criterio es una igualdad de longitudes: `largo(b) = largo(a) + embebido`.
 * Es la comprobación que convierte un patrón matemáticamente correcto en uno
 * confeccionable, y la que hará de criterio de salida de las Fases 5 a 7.
 */
export function validateSeam(
  seam: Seam,
  pieces: PieceIndex,
  tolerance: number = SEAM_MATCH_TOLERANCE_MM,
): SeamIssue[] {
  const lengths = seamLengths(seam, pieces);
  if (lengths === null) return [{ kind: 'unknown-edge', seam: seam.id }];

  if (Math.abs(lengths.discrepancy) > tolerance) {
    return [
      {
        kind: 'length-mismatch',
        seam: seam.id,
        lengthA: lengths.a,
        lengthB: lengths.b,
        ease: seam.ease,
        discrepancy: lengths.discrepancy,
      },
    ];
  }

  return [];
}

export interface PatternReport {
  readonly pieceIssues: ReadonlyMap<string, readonly PieceIssue[]>;
  readonly seamIssues: readonly SeamIssue[];
  readonly ok: boolean;
}

export function validatePattern(
  pieces: readonly PatternPiece[],
  seams: readonly Seam[],
  tolerance: number = SEAM_MATCH_TOLERANCE_MM,
): PatternReport {
  const index: PieceIndex = new Map(pieces.map((piece) => [piece.id, piece]));

  const pieceIssues = new Map<string, readonly PieceIssue[]>();
  for (const piece of pieces) {
    const issues = validatePiece(piece);
    if (issues.length > 0) pieceIssues.set(piece.id, issues);
  }

  const seamIssues: SeamIssue[] = [];
  for (const seam of seams) seamIssues.push(...validateSeam(seam, index, tolerance));

  return { pieceIssues, seamIssues, ok: pieceIssues.size === 0 && seamIssues.length === 0 };
}

/** Mensaje legible de un problema de pieza, para la interfaz y los tests. */
export function describePieceIssue(issue: PieceIssue): string {
  switch (issue.kind) {
    case 'contour':
      return `contorno: ${issue.issue.kind}`;
    case 'not-closed':
      return 'el contorno de la pieza no está cerrado';
    case 'not-simple':
      return 'el contorno se corta a sí mismo';
    case 'wrong-orientation':
      return `el contorno se recorre en sentido ${issue.found}; debe ser antihorario`;
    case 'no-edges':
      return 'la pieza no tiene aristas con nombre';
    case 'edges-not-a-partition':
      return `el segmento ${issue.segmentIndex} pertenece a ${issue.coverage} aristas; debe pertenecer a una`;
    case 'negative-allowance':
      return `margen de costura negativo en ${issue.edge}`;
    case 'notch-out-of-range':
      return `piquete fuera de la arista ${issue.edge} (a ${issue.arcLength.toFixed(1)} mm)`;
    case 'notch-unknown-edge':
      return `piquete sobre una arista inexistente: ${issue.edge}`;
    case 'allowance-removes-material':
      return 'el margen de costura reduce el área en lugar de aumentarla';
  }
}
