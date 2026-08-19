import { applyToVector } from '@core/geometry/mat3';
import type { ScreenPoint } from '@core/geometry/screen';
import type { Vec2 } from '@core/geometry/vec2';
import { distance, sub } from '@core/geometry/vec2';

import { findPoint } from '@domain/sketch/document';
import type { SnapResult } from '@domain/sketch/snapping';
import type { EntityRef } from '@domain/sketch/types';
import { pointRef, refEquals } from '@domain/sketch/types';

import type { ToolId } from '@state/editorStore';
import { useEditorStore } from '@state/editorStore';
import type { DraftHandle } from '@state/patternStore';
import {
  currentPattern,
  documentDeltaToLocal,
  draftHandles,
  overrideOf,
  usePatternStore,
} from '@state/patternStore';

/**
 * Contexto de un evento de puntero, ya traducido al dominio.
 *
 * El lienzo resuelve una sola vez la conversión a mundo, el ajuste (snap) y el
 * test de acierto, y entrega el resultado a la herramienta activa. Las
 * herramientas no ven píxeles, ni eventos del DOM, ni React: son funciones que
 * leen este contexto y llaman a acciones del store, lo que las hace
 * verificables sin montar la interfaz.
 */
export interface PointerContext {
  readonly screen: ScreenPoint;
  /** Posición sin ajustar. Para el marco de selección y la lectura del cursor. */
  readonly world: Vec2;
  /** Posición ajustada a rejilla o a punto existente. Para crear y mover. */
  readonly snap: SnapResult;
  readonly hit: EntityRef | null;
  /** Radio de acierto de los manejadores del trazado, en mm. */
  readonly handleRadiusMm: number;
  readonly shift: boolean;
  readonly alt: boolean;
}

export interface Tool {
  readonly id: ToolId;
  readonly label: string;
  readonly hint: string;
  readonly shortcut: string;
  readonly cursor: string;
  onPointerDown?(ctx: PointerContext): void;
  onPointerMove?(ctx: PointerContext): void;
  onPointerUp?(ctx: PointerContext): void;
  onEscape?(): void;
}

const store = () => useEditorStore.getState();

/* ------------------------------------------------------------------------- */

const selectTool: Tool = {
  id: 'select',
  label: 'Seleccionar',
  hint: 'Clic para seleccionar · arrastrar un punto del trazado para ajustarlo · marco para selección múltiple',
  shortcut: 'V',
  cursor: 'default',

  onPointerDown(ctx) {
    const s = store();

    /*
     * Los manejadores del trazado tienen prioridad sobre el boceto. Son la vía
     * de los ajustes manuales (AVISO 2) y están siempre encima; sin la
     * prioridad, un punto del boceto que cayera cerca los haría inalcanzables.
     */
    const handle = nearestDraftHandle(ctx);
    if (handle !== null) {
      usePatternStore.getState().beginDrag(handle.name, handle.pieceId);
      return;
    }

    if (ctx.hit === null) {
      if (!ctx.shift) s.clearSelection();
      s.beginMarquee(ctx.world, ctx.shift);
      return;
    }

    if (ctx.shift) {
      s.toggleSelection(ctx.hit);
      return;
    }

    const alreadySelected = s.selection.some((ref) => refEquals(ref, ctx.hit as EntityRef));
    if (!alreadySelected) s.setSelection([ctx.hit]);

    /*
     * El ancla del arrastre es el CENTRO EXACTO del punto agarrado, no la
     * posición del cursor. Así el desplazamiento aplicado es
     * `cursorAjustado − centroDelPunto`, y el punto aterriza justo sobre la
     * rejilla en lugar de conservar el pequeño descentrado del agarre.
     */
    const grabbed = ctx.hit.kind === 'point' ? findPoint(s.document, ctx.hit.id) : undefined;
    store().beginMove(grabbed?.p ?? ctx.snap.point);
  },

  onPointerMove(ctx) {
    const pattern = usePatternStore.getState();

    if (pattern.dragging !== null) {
      /*
       * El ajuste se guarda como DELTA respecto a la posición paramétrica, no
       * como posición absoluta. Se calcula restando: dónde está ahora el cursor
       * menos dónde pondría el trazado ese punto sin corregir.
       */
      const handle = handleByName(pattern.dragging.point);
      if (handle === null) return;

      const parametric = sub(handle.document, overrideInDocument(pattern.dragging));
      const deltaInDocument = sub(ctx.snap.point, parametric);

      pattern.setOverride(
        pattern.dragging.point,
        documentDeltaToLocal(currentPattern(), pattern.dragging.pieceId, deltaInDocument),
      );
      return;
    }

    const s = store();
    switch (s.toolState.kind) {
      case 'moving':
        s.updateMove(ctx.snap.point);
        return;
      case 'marquee':
        s.updateMarquee(ctx.world);
        return;
      default:
        s.setHover(ctx.hit);
    }
  },

  onPointerUp() {
    const pattern = usePatternStore.getState();
    if (pattern.dragging !== null) {
      pattern.endDrag();
      return;
    }

    const s = store();
    if (s.toolState.kind === 'moving') s.endMove(true);
    else if (s.toolState.kind === 'marquee') s.endMarquee(true);
  },

  onEscape() {
    usePatternStore.getState().endDrag();
    store().cancelInteraction();
  },
};

/** Manejador del trazado bajo el cursor, si los manejadores están visibles. */
function nearestDraftHandle(ctx: PointerContext): DraftHandle | null {
  const pattern = usePatternStore.getState();
  if (!pattern.showHandles) return null;

  let best: DraftHandle | null = null;
  let bestDistance = ctx.handleRadiusMm;

  for (const handle of draftHandles(currentPattern())) {
    const d = distance(ctx.world, handle.document);
    if (d <= bestDistance) {
      bestDistance = d;
      best = handle;
    }
  }

  return best;
}

const handleByName = (name: string): DraftHandle | null =>
  draftHandles(currentPattern()).find((handle) => handle.name === name) ?? null;

/** El desplazamiento vigente del punto, expresado en el documento. */
function overrideInDocument(dragging: { point: string; pieceId: string }) {
  const local = overrideOf(dragging.point);
  const piece = currentPattern()?.pieces.find((p) => String(p.id) === dragging.pieceId);
  return piece === undefined ? local : applyToVector(piece.placement, local);
}

/* ------------------------------------------------------------------------- */

const pointTool: Tool = {
  id: 'point',
  label: 'Punto',
  hint: 'Clic para crear un punto en la posición ajustada',
  shortcut: 'P',
  cursor: 'crosshair',

  onPointerDown(ctx) {
    // Sobre un punto existente no se duplica: se selecciona.
    if (ctx.snap.targetId !== null) {
      store().setSelection([pointRef(ctx.snap.targetId)]);
      return;
    }
    const id = store().createPointAt(ctx.snap.point);
    store().setSelection([pointRef(id)]);
  },

  onPointerMove(ctx) {
    store().setHover(ctx.hit);
  },
};

/* ------------------------------------------------------------------------- */

const lineTool: Tool = {
  id: 'line',
  label: 'Línea',
  hint: 'Clic para fijar el origen y clic de nuevo para cerrar · encadena polilíneas · Esc termina',
  shortcut: 'L',
  cursor: 'crosshair',

  onPointerDown(ctx) {
    const pending = store().toolState;

    if (pending.kind === 'line-pending') {
      const endId = store().connectTo(pending.from, ctx.snap.targetId, ctx.snap.point);
      // Encadenar: el extremo recién creado pasa a ser el origen del siguiente
      // tramo, que es como se dibuja una polilínea sin repetir clics.
      if (endId !== null) store().beginLine(endId, ctx.snap.point);
      else store().cancelInteraction();
      return;
    }

    const startId = ctx.snap.targetId ?? store().createPointAt(ctx.snap.point);
    store().beginLine(startId, ctx.snap.point);
  },

  onPointerMove(ctx) {
    const s = store();
    if (s.toolState.kind === 'line-pending') s.updateLine(ctx.snap.point);
    s.setHover(ctx.hit);
  },

  onEscape() {
    store().cancelInteraction();
  },
};

/* ------------------------------------------------------------------------- */

export const TOOLS: Readonly<Record<ToolId, Tool>> = {
  select: selectTool,
  point: pointTool,
  line: lineTool,
};

export const TOOL_ORDER: readonly ToolId[] = ['select', 'point', 'line'];

export const getTool = (id: ToolId): Tool => TOOLS[id];
