import { create } from 'zustand';

import type { Vec2 } from '@core/geometry/vec2';
import { equals, sub } from '@core/geometry/vec2';
import type { DisplayUnit } from '@core/units';

import {
  addLine,
  addPoint,
  emptyDocument,
  findLine,
  findPoint,
  movePoint,
  removeEntities,
  translatePoints,
} from '@domain/sketch/document';
import {
  entitiesInRect,
  pointsAffectedBySelection,
  selectionRect,
} from '@domain/sketch/hitTest';
import type {
  EntityRef,
  LineId,
  PointId,
  SketchDocument,
} from '@domain/sketch/types';
import { refEquals, refKey } from '@domain/sketch/types';

export type ToolId = 'select' | 'point' | 'line';

/**
 * Estado transitorio de la interacción en curso.
 *
 * Vive en el store y no en un `ref` de React porque la capa de previsualización
 * necesita renderizarlo: el rectángulo de selección o la línea elástica son
 * datos, no efectos secundarios del manejador de eventos.
 *
 * `origin` guarda el documento tal como estaba al empezar el arrastre. Cada
 * movimiento se aplica sobre él —nunca sobre el resultado anterior—, de modo
 * que la posición final depende sólo del desplazamiento total y no acumula
 * error de redondeo a lo largo de cientos de eventos de puntero.
 */
export type ToolState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'marquee';
      readonly origin: Vec2;
      readonly current: Vec2;
      readonly additive: boolean;
    }
  | {
      readonly kind: 'moving';
      readonly startWorld: Vec2;
      readonly currentWorld: Vec2;
      readonly pointIds: readonly PointId[];
      readonly origin: SketchDocument;
    }
  | { readonly kind: 'line-pending'; readonly from: PointId; readonly current: Vec2 };

export interface GridSettings {
  readonly enabled: boolean;
  readonly stepMm: number;
}

interface EditorStore {
  readonly document: SketchDocument;
  readonly past: readonly SketchDocument[];
  readonly future: readonly SketchDocument[];

  readonly selection: readonly EntityRef[];
  readonly hover: EntityRef | null;

  readonly tool: ToolId;
  readonly toolState: ToolState;

  readonly grid: GridSettings;
  readonly snapToPoints: boolean;
  readonly displayUnit: DisplayUnit;

  // — documento (con historial) —
  createPointAt(world: Vec2): PointId;
  createLine(a: PointId, b: PointId): LineId | null;
  connectTo(from: PointId, target: PointId | null, world: Vec2): PointId | null;
  setPointPosition(id: PointId, p: Vec2): void;
  deleteSelection(): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  // — interacción de arrastre —
  beginMove(startWorld: Vec2): void;
  updateMove(currentWorld: Vec2): void;
  endMove(commit: boolean): void;

  beginMarquee(origin: Vec2, additive: boolean): void;
  updateMarquee(current: Vec2): void;
  endMarquee(commit: boolean): void;

  beginLine(from: PointId, current: Vec2): void;
  updateLine(current: Vec2): void;
  cancelInteraction(): void;

  // — selección —
  setSelection(refs: readonly EntityRef[]): void;
  toggleSelection(ref: EntityRef): void;
  clearSelection(): void;
  setHover(ref: EntityRef | null): void;

  // — ajustes —
  setTool(tool: ToolId): void;
  setGrid(grid: Partial<GridSettings>): void;
  setSnapToPoints(enabled: boolean): void;
  setDisplayUnit(unit: DisplayUnit): void;

  loadDocument(document: SketchDocument): void;
}

/** Profundidad del historial. Cada entrada son referencias, no copias profundas. */
const HISTORY_LIMIT = 200;

const pushHistory = (
  past: readonly SketchDocument[],
  entry: SketchDocument,
): readonly SketchDocument[] => {
  const next = [...past, entry];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
};

/**
 * Elimina de la selección las entidades que ya no existen.
 *
 * Necesario tras deshacer, rehacer o borrar. Una selección que apunta a
 * entidades fantasma provoca arrastres sobre nada y errores silenciosos.
 */
function pruneSelection(
  doc: SketchDocument,
  selection: readonly EntityRef[],
): readonly EntityRef[] {
  if (selection.length === 0) return selection;

  const pointIds = new Set<PointId>(doc.points.map((pt) => pt.id));
  const lineIds = new Set<LineId>(doc.lines.map((ln) => ln.id));

  const kept = selection.filter((ref) =>
    ref.kind === 'point' ? pointIds.has(ref.id) : lineIds.has(ref.id),
  );

  return kept.length === selection.length ? selection : kept;
}

export const useEditorStore = create<EditorStore>()((set, get) => ({
  document: emptyDocument,
  past: [],
  future: [],

  selection: [],
  hover: null,

  tool: 'select',
  toolState: { kind: 'idle' },

  grid: { enabled: true, stepMm: 10 },
  snapToPoints: true,
  displayUnit: 'mm',

  createPointAt: (world) => {
    const { document, past } = get();
    const { document: next, id } = addPoint(document, world);
    set({ document: next, past: pushHistory(past, document), future: [] });
    return id;
  },

  createLine: (a, b) => {
    const { document, past } = get();
    const { document: next, id } = addLine(document, a, b);
    if (id === null) return null;
    set({ document: next, past: pushHistory(past, document), future: [] });
    return id;
  },

  /**
   * Traza una línea desde `from` hasta un punto existente (`target`) o hasta
   * uno nuevo creado en `world`.
   *
   * Crear el punto y la línea en una única transición de estado es lo que hace
   * que un clic del usuario equivalga a un paso de deshacer. Si fueran dos
   * acciones separadas, cada clic dejaría dos entradas en el historial y
   * Ctrl+Z devolvería un estado intermedio que el usuario nunca vio.
   */
  connectTo: (from, target, world) => {
    const { document, past } = get();

    let working = document;
    let endId = target;

    if (endId === null) {
      const created = addPoint(working, world);
      working = created.document;
      endId = created.id;
    }

    const { document: withLine, id } = addLine(working, from, endId);
    if (id === null && working === document) return null;

    set({ document: withLine, past: pushHistory(past, document), future: [] });
    return endId;
  },

  /**
   * Coloca un punto en una posición exacta.
   *
   * Es la vía de entrada numérica del inspector, y la prueba de que la
   * geometría no depende de la pantalla: el usuario escribe milímetros y el
   * modelo los adopta tal cual, sin pasar por píxeles ni por el zoom actual.
   */
  setPointPosition: (id, p) => {
    const { document, past } = get();
    const next = movePoint(document, id, p);
    if (next === document) return;
    set({ document: next, past: pushHistory(past, document), future: [] });
  },

  deleteSelection: () => {
    const { document, past, selection } = get();
    if (selection.length === 0) return;

    const next = removeEntities(document, selection);
    if (next === document) return;

    set({
      document: next,
      past: pushHistory(past, document),
      future: [],
      selection: [],
      hover: null,
      toolState: { kind: 'idle' },
    });
  },

  undo: () => {
    const { past, future, document, selection } = get();
    const previous = past.at(-1);
    if (previous === undefined) return;

    set({
      document: previous,
      past: past.slice(0, -1),
      future: [document, ...future],
      selection: pruneSelection(previous, selection),
      hover: null,
      toolState: { kind: 'idle' },
    });
  },

  redo: () => {
    const { past, future, document, selection } = get();
    const next = future[0];
    if (next === undefined) return;

    set({
      document: next,
      past: pushHistory(past, document),
      future: future.slice(1),
      selection: pruneSelection(next, selection),
      hover: null,
      toolState: { kind: 'idle' },
    });
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  beginMove: (startWorld) => {
    const { document, selection } = get();
    const pointIds = [...pointsAffectedBySelection(document, selection)];
    if (pointIds.length === 0) return;

    set({
      toolState: {
        kind: 'moving',
        startWorld,
        currentWorld: startWorld,
        pointIds,
        origin: document,
      },
    });
  },

  updateMove: (currentWorld) => {
    const { toolState } = get();
    if (toolState.kind !== 'moving') return;

    const delta = sub(currentWorld, toolState.startWorld);
    set({
      document: translatePoints(toolState.origin, toolState.pointIds, delta),
      toolState: { ...toolState, currentWorld },
    });
  },

  endMove: (commit) => {
    const { toolState, past } = get();
    if (toolState.kind !== 'moving') return;

    if (!commit) {
      set({ document: toolState.origin, toolState: { kind: 'idle' } });
      return;
    }

    // Un arrastre sin desplazamiento neto no debe ensuciar el historial: el
    // usuario sólo ha hecho clic, aunque el puntero se moviera un subpíxel.
    if (equals(toolState.currentWorld, toolState.startWorld)) {
      set({ document: toolState.origin, toolState: { kind: 'idle' } });
      return;
    }

    set({
      toolState: { kind: 'idle' },
      past: pushHistory(past, toolState.origin),
      future: [],
    });
  },

  beginMarquee: (origin, additive) =>
    set({ toolState: { kind: 'marquee', origin, current: origin, additive } }),

  updateMarquee: (current) => {
    const { toolState } = get();
    if (toolState.kind !== 'marquee') return;
    set({ toolState: { ...toolState, current } });
  },

  endMarquee: (commit) => {
    const { toolState, document, selection } = get();
    if (toolState.kind !== 'marquee') return;

    if (!commit) {
      set({ toolState: { kind: 'idle' } });
      return;
    }

    const found = entitiesInRect(document, selectionRect(toolState.origin, toolState.current));

    const merged = toolState.additive
      ? [...selection, ...found.filter((ref) => !selection.some((s) => refEquals(s, ref)))]
      : found;

    set({ selection: merged, toolState: { kind: 'idle' } });
  },

  beginLine: (from, current) => set({ toolState: { kind: 'line-pending', from, current } }),

  updateLine: (current) => {
    const { toolState } = get();
    if (toolState.kind !== 'line-pending') return;
    set({ toolState: { ...toolState, current } });
  },

  cancelInteraction: () => {
    const { toolState } = get();
    if (toolState.kind === 'moving') {
      set({ document: toolState.origin, toolState: { kind: 'idle' } });
      return;
    }
    set({ toolState: { kind: 'idle' } });
  },

  setSelection: (refs) => set({ selection: refs }),

  toggleSelection: (ref) => {
    const { selection } = get();
    const exists = selection.some((s) => refEquals(s, ref));
    set({
      selection: exists ? selection.filter((s) => !refEquals(s, ref)) : [...selection, ref],
    });
  },

  clearSelection: () => set({ selection: [] }),
  setHover: (ref) => {
    const current = get().hover;
    const same =
      (current === null && ref === null) ||
      (current !== null && ref !== null && refEquals(current, ref));
    if (!same) set({ hover: ref });
  },

  setTool: (tool) => set({ tool, toolState: { kind: 'idle' } }),
  setGrid: (grid) => set({ grid: { ...get().grid, ...grid } }),
  setSnapToPoints: (enabled) => set({ snapToPoints: enabled }),
  setDisplayUnit: (unit) => set({ displayUnit: unit }),

  loadDocument: (document) =>
    set({
      document,
      past: [],
      future: [],
      selection: [],
      hover: null,
      toolState: { kind: 'idle' },
    }),
}));

/** Claves de la selección, para consultas O(1) durante el render. */
export const selectionKeys = (selection: readonly EntityRef[]): ReadonlySet<string> =>
  new Set(selection.map((ref) => refKey(ref)));

/** Punto único seleccionado, o `null`. Alimenta el inspector. */
export function selectedPoint(store: {
  document: SketchDocument;
  selection: readonly EntityRef[];
}) {
  const [only] = store.selection;
  if (only === undefined || store.selection.length !== 1 || only.kind !== 'point') return null;
  return findPoint(store.document, only.id) ?? null;
}

/** Línea única seleccionada, o `null`. */
export function selectedLine(store: {
  document: SketchDocument;
  selection: readonly EntityRef[];
}) {
  const [only] = store.selection;
  if (only === undefined || store.selection.length !== 1 || only.kind !== 'line') return null;
  return findLine(store.document, only.id) ?? null;
}
