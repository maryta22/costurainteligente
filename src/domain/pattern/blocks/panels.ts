import { lineSeg } from '@core/geometry/line';
import type { Mat3 } from '@core/geometry/mat3';
import type { Vec2 } from '@core/geometry/vec2';
import { vec2 } from '@core/geometry/vec2';

import { edgeLength, findEdge } from '../edge';
import { edgeId } from '../ids';
import { createNotch } from '../notch';
import type { NotchType, PatternPiece } from '../types';

import { assemblePanel, label, verticalGrain } from './assemble';
import type { BodiceUpperBlock } from './bodice';
import type { SkirtLowerBlock } from './skirtBody';
import type { WaistBlock } from './waist';
import { waistDartSegments, waistInnerSegments, waistOuterSegments, waistTowardCenter } from './waist';

export type CenterRole = 'center-front' | 'center-back';

export interface BodicePanelSpec {
  readonly id: string;
  readonly name: string;
  readonly centerRole: CenterRole;
  readonly centerOnFold: boolean;
  readonly waist: WaistBlock;
  readonly upper: BodiceUpperBlock;
  readonly centerWaist: Vec2;
  readonly armholeNotch: { readonly fraction: number; readonly type: NotchType };
  readonly placement: Mat3;
  readonly cutLabel: string;
  /** Margen de la cintura. Cero si es un bajo, mayor si se cose a una falda. */
  readonly waistAllowance?: number;
}

/**
 * PANEL DE CUERPO — delantero o espalda, de cintura a escote.
 *
 * Compone la línea de cintura con la mitad superior. Lo usan la blusa y el
 * vestido sin diferencia: cambia el margen de la cintura —un bajo lleva más
 * que una unión a falda— y poco más.
 *
 * Recorrido antihorario: cintura del centro al costado, costado hacia arriba,
 * sisa, hombro, escote y centro hacia abajo.
 */
export function bodicePanel(spec: BodicePanelSpec): PatternPiece {
  const { waist, upper } = spec;

  const piece = assemblePanel({
    id: spec.id,
    name: spec.name,
    edges: [
      {
        name: 'waistInner',
        role: 'waist',
        segments: waistInnerSegments(waist),
        ...(spec.waistAllowance === undefined ? {} : { seamAllowance: spec.waistAllowance }),
        label: 'cintura',
      },
      { name: 'dart', role: 'dart', segments: waistDartSegments(waist), label: 'pinza de talle' },
      {
        name: 'waistOuter',
        role: 'waist',
        segments: waistOuterSegments(waist),
        ...(spec.waistAllowance === undefined ? {} : { seamAllowance: spec.waistAllowance }),
        label: 'cintura',
      },
      { name: 'side', role: 'side', segments: [upper.side], label: 'costado' },
      { name: 'armhole', role: 'armhole', segments: [upper.armhole], label: 'sisa' },
      { name: 'shoulder', role: 'shoulder', segments: [upper.shoulder], label: 'hombro' },
      { name: 'neckline', role: 'neckline', segments: [upper.neckline], label: 'escote' },
      {
        name: spec.centerRole,
        role: spec.centerRole,
        segments: [lineSeg(upper.centerNeck, spec.centerWaist)],
        onFold: spec.centerOnFold,
        label: spec.centerOnFold ? 'centro al doblez' : 'centro',
      },
    ],
    grainLine: verticalGrain(
      vec2(upper.underarm.x * 0.45, upper.shoulderNeck.y * 0.45),
      upper.shoulderNeck.y * 0.6,
    ),
    labels: [label(spec.cutLabel, vec2(upper.underarm.x * 0.42, upper.shoulderNeck.y * 0.2))],
    placement: spec.placement,
    cutCount: spec.centerOnFold ? 1 : 2,
  });

  // El piquete se sitúa por fracción, lo que exige la pieza ya construida.
  const armhole = findEdge(piece, edgeId(spec.id, 'armhole'));
  if (armhole === undefined) return piece;

  return {
    ...piece,
    notches: [
      createNotch(
        {
          edge: armhole.id,
          arcLength: edgeLength(piece, armhole) * spec.armholeNotch.fraction,
          type: spec.armholeNotch.type,
        },
        0,
      ),
    ],
  };
}

export interface SkirtPanelSpec {
  readonly id: string;
  readonly name: string;
  readonly centerRole: CenterRole;
  readonly centerOnFold: boolean;
  readonly waist: WaistBlock;
  readonly lower: SkirtLowerBlock;
  readonly centerHem: Vec2;
  readonly centerWaist: Vec2;
  /** Altura de la línea de cadera, donde va el piquete de montaje. */
  readonly hipLevel: number;
  readonly notchType: NotchType;
  readonly placement: Mat3;
  readonly cutLabel: string;
}

/**
 * PANEL DE FALDA — delantero o espalda, de bajo a cintura.
 *
 * Compone la mitad inferior con la línea de cintura. Lo usan la falda y el
 * vestido sin diferencia.
 *
 * Recorrido antihorario: bajo del centro al costado, costado hacia arriba,
 * cintura de vuelta al centro, centro hacia abajo. La cintura se construye del
 * centro al costado —como se traza— y se invierte al montarla.
 */
export function skirtPanel(spec: SkirtPanelSpec): PatternPiece {
  const { waist, lower } = spec;
  const waistSegments = waistTowardCenter(waist);

  const piece = assemblePanel({
    id: spec.id,
    name: spec.name,
    edges: [
      { name: 'hem', role: 'hem', segments: [lower.hem], label: 'bajo' },
      {
        name: 'side',
        role: 'side',
        segments: [lower.sideLower, lower.sideUpper],
        label: 'costado',
      },
      { name: 'waistOuter', role: 'waist', segments: waistSegments.slice(0, 1), label: 'cintura' },
      { name: 'dart', role: 'dart', segments: waistSegments.slice(1, 3), label: 'pinza' },
      { name: 'waistInner', role: 'waist', segments: waistSegments.slice(3, 4), label: 'cintura' },
      {
        name: spec.centerRole,
        role: spec.centerRole,
        segments: [lineSeg(spec.centerWaist, spec.centerHem)],
        onFold: spec.centerOnFold,
        label: spec.centerOnFold ? 'centro al doblez' : 'centro · cremallera',
      },
    ],
    grainLine: verticalGrain(
      vec2(lower.sideHem.x * 0.5, (spec.centerWaist.y + spec.centerHem.y) / 2),
      Math.abs(spec.centerWaist.y - spec.centerHem.y) * 0.7,
    ),
    labels: [
      label(spec.cutLabel, vec2(lower.sideHem.x * 0.5, spec.centerHem.y + (spec.centerWaist.y - spec.centerHem.y) * 0.3)),
    ],
    placement: spec.placement,
    cutCount: spec.centerOnFold ? 1 : 2,
  });

  /*
   * Piquete a la altura de la cadera sobre el costado: la referencia que
   * permite montar la costura sin que se desplace. Se mide desde el bajo, que
   * es el extremo por el que arranca la arista.
   */
  const side = findEdge(piece, edgeId(spec.id, 'side'));
  if (side === undefined) return piece;

  return {
    ...piece,
    notches: [
      createNotch(
        { edge: side.id, arcLength: spec.hipLevel - spec.centerHem.y, type: spec.notchType },
        0,
      ),
    ],
  };
}
