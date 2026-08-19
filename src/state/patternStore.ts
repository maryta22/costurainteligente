import { create } from 'zustand';

import type { PointOverride } from '@domain/pattern/construction/draft';
import { buildOverrideMap } from '@domain/pattern/construction/draft';
import type { GarmentId, GenerationResult } from '@domain/pattern/generators';
import { generateGarment } from '@domain/pattern/generators';
import type { BodyMeasurements, EaseProfile } from '@domain/measurements';
import { buildInputScope } from '@domain/measurements/scope';
import type { SizeCode } from '@domain/measurements/standard';
import { DEFAULT_GRADER_ID, findGrader, measurementDrivenGrader } from '@domain/grading';
import type { PatternPiece } from '@domain/pattern/types';
import type { ParameterDefinition } from '@core/parametric/types';
import { evaluateParameters } from '@core/parametric/evaluate';
import { applyToPoint, applyToVector, invert } from '@core/geometry/mat3';
import type { Vec2 } from '@core/geometry/vec2';

import { useParametricStore } from './parametricStore';

/**
 * Estado del patrón.
 *
 * Guarda LA ESPECIFICACIÓN —qué prenda, qué ajustes manuales, qué se muestra—
 * y nunca las piezas. Las piezas son el resultado de generar, y generar es una
 * función pura sobre este estado más el paramétrico.
 *
 * Es lo que hace imposible que el patrón dibujado y las medidas dejen de
 * corresponderse: no hay dos copias que puedan divergir.
 */
interface PatternStore {
  readonly garment: GarmentId;
  /** Ajustes manuales sobre puntos del trazado. Ver AVISO 2. */
  readonly overrides: readonly PointOverride[];
  /** Arrastre de ajuste en curso. */
  readonly dragging: { readonly point: string; readonly pieceId: string } | null;

  /** Superposición de tallas. */
  readonly nesting: boolean;
  readonly graderId: string;

  readonly showHandles: boolean;
  readonly showSeamAllowance: boolean;
  readonly showNotches: boolean;
  readonly showGrainLine: boolean;
  readonly showEdgeColors: boolean;

  setGarment(garment: GarmentId): void;
  setOverride(point: string, delta: PointOverride['delta']): void;
  clearOverride(point: string): void;
  clearAllOverrides(): void;
  beginDrag(point: string, pieceId: string): void;
  endDrag(): void;
  setNesting(enabled: boolean): void;
  setGrader(id: string): void;
  toggle(
    flag:
      | 'showSeamAllowance'
      | 'showNotches'
      | 'showGrainLine'
      | 'showEdgeColors'
      | 'showHandles',
  ): void;
}

export const usePatternStore = create<PatternStore>()((set, get) => ({
  garment: 'skirt',
  overrides: [],
  dragging: null,

  nesting: false,
  graderId: DEFAULT_GRADER_ID,

  showHandles: true,
  showSeamAllowance: true,
  showNotches: true,
  showGrainLine: true,
  showEdgeColors: true,

  setGarment: (garment) => set({ garment }),

  setOverride: (point, delta) =>
    set({
      overrides: [
        ...get().overrides.filter((override) => override.point !== point),
        { point, delta },
      ],
    }),

  clearOverride: (point) =>
    set({ overrides: get().overrides.filter((override) => override.point !== point) }),

  clearAllOverrides: () => set({ overrides: [] }),

  beginDrag: (point, pieceId) => set({ dragging: { point, pieceId } }),
  endDrag: () => set({ dragging: null }),

  setNesting: (nesting) => set({ nesting }),
  setGrader: (graderId) => set({ graderId }),

  toggle: (flag) => set({ [flag]: !get()[flag] } as Partial<PatternStore>),
}));

/** Desplazamiento manual vigente de un punto, o cero. */
export function overrideOf(point: string): Vec2 {
  const found = usePatternStore.getState().overrides.find((o) => o.point === point);
  return found?.delta ?? { x: 0, y: 0 };
}

export interface NestedSize {
  readonly size: SizeCode;
  readonly isBase: boolean;
  readonly pieces: readonly PatternPiece[];
}

export interface NestInput extends PatternInput {
  readonly baseSize: SizeCode;
  readonly sizes: readonly SizeCode[];
  readonly graderId: string;
}

let lastNestInput: NestInput | null = null;
let lastNest: NestedSize[] = [];

/**
 * Genera el patrón para un rango de tallas: el NIDO.
 *
 * Cada talla recorre la cadena entera —graduar las medidas, evaluar los
 * parámetros, trazar— porque una talla NO es el patrón base deformado sino el
 * trazado válido de otro cuerpo. Es la consecuencia directa de que las tallas
 * se deriven de medidas y no sean dibujos independientes.
 *
 * Superponerlas es lo que permite ver de un vistazo cómo evoluciona una línea
 * entre tallas: si una curva se cruza con la de su vecina o si el reparto de
 * un escote se dispara, se ve aquí y en ningún otro sitio.
 */
export function selectNestedPattern(input: NestInput): NestedSize[] {
  if (lastNestInput !== null && sameNestInput(lastNestInput, input)) return lastNest;

  const grader = findGrader(input.graderId) ?? measurementDrivenGrader;

  const graded = grader.grade({
    base: input.measurements,
    baseSize: input.baseSize,
    sizes: input.sizes,
  });

  lastNest = graded.map((entry) => {
    const evaluation = evaluateParameters(
      input.parameters,
      buildInputScope(entry.measurements, input.ease),
    );

    const result = generateGarment(input.garment, {
      values: evaluation.values,
      overrides: buildOverrideMap(input.overrides),
    });

    return { size: entry.size, isBase: entry.isBase, pieces: result?.pieces ?? [] };
  });

  lastNestInput = input;
  return lastNest;
}

const sameNestInput = (a: NestInput, b: NestInput): boolean =>
  sameInput(a, b) &&
  a.baseSize === b.baseSize &&
  a.sizes === b.sizes &&
  a.graderId === b.graderId;

export interface PatternInput {
  readonly garment: GarmentId;
  readonly overrides: readonly PointOverride[];
  readonly measurements: BodyMeasurements;
  readonly ease: EaseProfile;
  readonly parameters: readonly ParameterDefinition[];
}

let lastInput: PatternInput | null = null;
let lastResult: GenerationResult | null = null;

/**
 * Genera el patrón a partir de la especificación completa.
 *
 * Función PURA sobre medidas, holguras, fórmulas y ajustes: recorre la cadena
 * entera de la arquitectura en cada llamada —parámetros, trazado, piezas—.
 *
 * La memoria de UNA entrada no es una optimización prematura sino un requisito
 * de la interacción: al arrastrar un punto, el manejador del puntero necesita
 * consultar el trazado en cada evento, y regenerarlo entero sesenta veces por
 * segundo se nota. Al ser de una sola entrada y compararse por identidad —las
 * referencias de Zustand son estables— no puede quedarse obsoleta: si algo
 * cambia, cambia la referencia y se recalcula.
 */
export function selectGeneratedPattern(input: PatternInput): GenerationResult | null {
  if (lastInput !== null && sameInput(lastInput, input)) return lastResult;

  const evaluation = evaluateParameters(
    input.parameters,
    buildInputScope(input.measurements, input.ease),
  );

  lastResult = generateGarment(input.garment, {
    values: evaluation.values,
    overrides: buildOverrideMap(input.overrides),
  });
  lastInput = input;

  return lastResult;
}

const sameInput = (a: PatternInput, b: PatternInput): boolean =>
  a.garment === b.garment &&
  a.overrides === b.overrides &&
  a.measurements === b.measurements &&
  a.ease === b.ease &&
  a.parameters === b.parameters;

/** Patrón vigente según el estado actual de ambos stores. */
export function currentPattern(): GenerationResult | null {
  const pattern = usePatternStore.getState();
  const parametric = useParametricStore.getState();

  return selectGeneratedPattern({
    garment: pattern.garment,
    overrides: pattern.overrides,
    measurements: parametric.measurements,
    ease: parametric.ease,
    parameters: parametric.parameters,
  });
}

/** Un punto del trazado situado ya en coordenadas del documento. */
export interface DraftHandle {
  readonly name: string;
  readonly pieceId: string;
  /** Posición en coordenadas locales de su pieza. */
  readonly local: Vec2;
  /** Posición en el documento, con la colocación de la pieza aplicada. */
  readonly document: Vec2;
  readonly overridden: boolean;
}

/**
 * Puntos del trazado que se pueden ajustar a mano.
 *
 * El nombre lleva el prefijo de su pieza (`skirtFront.waistSide`), que es lo
 * que permite situarlo en el documento: los puntos del trazado están en
 * coordenadas locales y hay que aplicarles la colocación de su pieza.
 */
export function draftHandles(result: GenerationResult | null): DraftHandle[] {
  if (result === null) return [];

  const byId = new Map(result.pieces.map((piece) => [String(piece.id), piece]));
  const handles: DraftHandle[] = [];

  for (const point of result.draft.points()) {
    const pieceId = point.name.split('.')[0] ?? '';
    const piece = byId.get(pieceId);
    if (piece === undefined) continue;

    handles.push({
      name: point.name,
      pieceId,
      local: point.position,
      document: applyToPoint(piece.placement, point.position),
      overridden: point.overridden,
    });
  }

  return handles;
}

/** Convierte un desplazamiento del documento a coordenadas locales de la pieza. */
export function documentDeltaToLocal(
  result: GenerationResult | null,
  pieceId: string,
  delta: Vec2,
): Vec2 {
  const piece = result?.pieces.find((candidate) => String(candidate.id) === pieceId);
  if (piece === undefined) return delta;

  const inverse = invert(piece.placement);
  if (inverse === null) return delta;

  // Un desplazamiento es un VECTOR: se transforma sin la traslación.
  return applyToVector(inverse, delta);
}
