import type { Vec2 } from '@core/geometry/vec2';
import { add, scale } from '@core/geometry/vec2';

import { edgeLength, edgeLocationAtLength, effectiveSeamAllowance, findEdge } from './edge';
import { notchId } from './ids';
import type { EdgeId, Notch, NotchType, PatternEdge, PatternPiece } from './types';

/** Profundidad por defecto de la marca, en mm. */
export const DEFAULT_NOTCH_DEPTH_MM = 5;

export interface NotchSpec {
  readonly edge: EdgeId;
  readonly arcLength: number;
  readonly type?: NotchType;
  readonly depth?: number;
}

export function createNotch(spec: NotchSpec, index: number): Notch {
  return {
    id: notchId(spec.edge, index),
    edge: spec.edge,
    arcLength: spec.arcLength,
    type: spec.type ?? 'single',
    depth: spec.depth ?? DEFAULT_NOTCH_DEPTH_MM,
  };
}

/**
 * Coloca un piquete por FRACCIÓN de la arista en lugar de por milímetros.
 *
 * Útil en los generadores: «a un tercio de la sisa» se mantiene proporcional al
 * cambiar de talla, mientras que «a 120 mm» no.
 */
export function notchAtFraction(
  piece: PatternPiece,
  edge: PatternEdge,
  fraction: number,
  index: number,
  type: NotchType = 'single',
): Notch {
  return createNotch(
    { edge: edge.id, arcLength: edgeLength(piece, edge) * fraction, type },
    index,
  );
}

/** Geometría de un piquete ya resuelta sobre la pieza. */
export interface ResolvedNotch {
  readonly notch: Notch;
  /** Punto sobre la línea de costura. */
  readonly seamPoint: Vec2;
  /** Punto sobre la línea de corte, proyectado por la normal. */
  readonly cutPoint: Vec2;
  /** Normal unitaria hacia fuera de la pieza. */
  readonly outward: Vec2;
  /** Extremo interior de la marca, a `depth` de la línea de corte. */
  readonly markStart: Vec2;
}

/**
 * Resuelve un piquete a coordenadas concretas.
 *
 * ── Por qué se proyecta ─────────────────────────────────────────────────────
 *
 * El piquete está DEFINIDO sobre la línea de costura, que es donde tiene
 * sentido: marca el punto que debe coincidir con otro de la pieza vecina. Pero
 * se CORTA en el borde de la tela, es decir, sobre la línea de corte. Hay que
 * llevarlo de una a otra a lo largo de la normal, recorriendo exactamente el
 * margen de esa arista.
 *
 * Guardar la posición del piquete ya proyectada sería el error: al cambiar el
 * margen —o al cambiar una medida— la marca quedaría desplazada respecto a la
 * costura, y dos piezas que deberían casar dejarían de hacerlo. Por eso el
 * modelo guarda `(arista, longitud)` y la proyección se recalcula siempre.
 */
export function resolveNotch(piece: PatternPiece, notch: Notch): ResolvedNotch | null {
  const edge = findEdge(piece, notch.edge);
  if (edge === undefined) return null;

  const location = edgeLocationAtLength(piece, edge, notch.arcLength);
  if (location === null) return null;

  const allowance = effectiveSeamAllowance(edge);
  const cutPoint = add(location.point, scale(location.outward, allowance));
  const markStart = add(cutPoint, scale(location.outward, -Math.min(notch.depth, allowance)));

  return {
    notch,
    seamPoint: location.point,
    cutPoint,
    outward: location.outward,
    markStart,
  };
}

export function resolveNotches(piece: PatternPiece): ResolvedNotch[] {
  const resolved: ResolvedNotch[] = [];

  for (const notch of piece.notches) {
    const result = resolveNotch(piece, notch);
    if (result !== null) resolved.push(result);
  }

  return resolved;
}

/**
 * Reparte `count` piquetes de equilibrio a lo largo de una arista.
 *
 * Se colocan en los interiores, sin tocar los extremos: los extremos ya son
 * puntos de emparejamiento por sí mismos y marcarlos otra vez sólo añade
 * ruido al patrón.
 */
export function balanceNotches(
  piece: PatternPiece,
  edge: PatternEdge,
  count: number,
  startIndex = 0,
): Notch[] {
  if (count < 1) return [];

  const total = edgeLength(piece, edge);
  const notches: Notch[] = [];

  for (let i = 1; i <= count; i++) {
    notches.push(
      createNotch(
        { edge: edge.id, arcLength: (total * i) / (count + 1), type: 'balance' },
        startIndex + i - 1,
      ),
    );
  }

  return notches;
}
