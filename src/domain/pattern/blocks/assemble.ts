import { contour } from '@core/geometry/contour';
import type { Mat3 } from '@core/geometry/mat3';
import type { Segment } from '@core/geometry/segment';
import type { Vec2 } from '@core/geometry/vec2';

import { edgeId, pieceId } from '../ids';
import { createPiece } from '../piece';
import type { EdgeRole, GrainLine, Notch, PatternEdge, PatternPiece, PieceLabel } from '../types';
import { DEFAULT_SEAM_ALLOWANCE_MM } from '../types';

/** Una arista descrita por SUS SEGMENTOS, sin índices. */
export interface EdgeSpec {
  readonly name: string;
  readonly role: EdgeRole;
  readonly segments: readonly Segment[];
  /** Si se omite, el valor por defecto del papel de la arista. */
  readonly seamAllowance?: number;
  readonly onFold?: boolean;
  readonly label?: string;
}

export interface PanelSpec {
  readonly id: string;
  readonly name: string;
  readonly edges: readonly EdgeSpec[];
  readonly grainLine?: GrainLine;
  readonly labels?: readonly PieceLabel[];
  readonly notches?: readonly Notch[];
  readonly placement?: Mat3;
  readonly cutCount?: number;
}

/**
 * Monta una pieza a partir de sus aristas, calculando los índices.
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * Una `PatternEdge` referencia su tramo del contorno por `(startSegment,
 * segmentCount)`. Es la representación correcta —no duplica geometría— pero
 * escribirla a mano es tedioso y frágil: basta insertar una curva en mitad de
 * un trazado para que todos los índices posteriores queden desplazados, y el
 * síntoma no es un error de compilación sino un margen de costura aplicado a la
 * arista equivocada.
 *
 * Los dos primeros generadores llevaban esa contabilidad a mano, cada uno a su
 * manera. Aquí se hace una sola vez: quien traza describe QUÉ segmentos forman
 * cada arista y los índices salen solos.
 */
export function assemblePanel(spec: PanelSpec): PatternPiece {
  const segments: Segment[] = [];
  const edges: PatternEdge[] = [];

  for (const edge of spec.edges) {
    if (edge.segments.length === 0) continue;

    edges.push({
      id: edgeId(spec.id, edge.name),
      role: edge.role,
      startSegment: segments.length,
      segmentCount: edge.segments.length,
      seamAllowance: resolveAllowance(edge),
      onFold: edge.onFold ?? false,
      ...(edge.label === undefined ? {} : { label: edge.label }),
    });

    segments.push(...edge.segments);
  }

  return createPiece({
    id: pieceId(spec.id),
    name: spec.name,
    contour: contour(segments, true),
    edges,
    ...(spec.notches === undefined ? {} : { notches: spec.notches }),
    ...(spec.grainLine === undefined ? {} : { grainLine: spec.grainLine }),
    ...(spec.labels === undefined ? {} : { labels: spec.labels }),
    ...(spec.placement === undefined ? {} : { placement: spec.placement }),
    ...(spec.cutCount === undefined ? {} : { cutCount: spec.cutCount }),
  });
}

/**
 * Una arista al doblez no se corta, así que nunca lleva margen por mucho que
 * su papel tenga uno por defecto.
 */
function resolveAllowance(edge: EdgeSpec): number {
  if (edge.onFold === true) return 0;
  return edge.seamAllowance ?? DEFAULT_SEAM_ALLOWANCE_MM[edge.role];
}

/** Línea de hilo vertical centrada en una caja, el caso habitual. */
export const verticalGrain = (center: Vec2, length: number): GrainLine => ({
  origin: center,
  angle: Math.PI / 2,
  length,
});

export const label = (text: string, position: Vec2): PieceLabel => ({
  text,
  position,
  angle: 0,
});
