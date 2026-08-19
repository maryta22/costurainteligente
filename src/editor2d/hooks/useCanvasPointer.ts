import { useCallback, useEffect, useRef, useState } from 'react';

import type { ScreenPoint } from '@core/geometry/screen';
import { screenPoint } from '@core/geometry/screen';
import { screenToWorld, screenToWorldLength } from '@core/geometry/viewport';

import { hitTest } from '@domain/sketch/hitTest';
import { resolveSnap } from '@domain/sketch/snapping';
import type { PointId } from '@domain/sketch/types';

import { useCursorStore } from '@state/cursorStore';
import { useEditorStore } from '@state/editorStore';
import { useViewportStore } from '@state/viewportStore';

import {
  DRAFT_HANDLE_HIT_RADIUS_PX,
  LINE_HIT_TOLERANCE_PX,
  POINT_HIT_RADIUS_PX,
  POINT_SNAP_RADIUS_PX,
} from '../constants';
import type { PointerContext } from '../interaction/tools';
import { getTool } from '../interaction/tools';

interface Modifiers {
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

type DragMode = 'tool' | 'pan';

interface ActiveDrag {
  readonly pointerId: number;
  readonly mode: DragMode;
  lastScreen: ScreenPoint;
}

const toScreen = (element: Element, clientX: number, clientY: number): ScreenPoint => {
  const rect = element.getBoundingClientRect();
  return screenPoint(clientX - rect.left, clientY - rect.top);
};

/**
 * Traduce un evento del DOM al lenguaje del dominio.
 *
 * Aquí ocurre, una sola vez por evento, todo lo que separa la pantalla del
 * modelo: conversión de coordenadas, resolución del ajuste y test de acierto.
 * Las tolerancias se definen en píxeles y se convierten a milímetros con la
 * escala actual, de modo que el área sensible es constante en pantalla sea cual
 * sea el zoom.
 */
function buildContext(screen: ScreenPoint, modifiers: Modifiers): PointerContext {
  const { viewport } = useViewportStore.getState();
  const editor = useEditorStore.getState();
  const world = screenToWorld(viewport, screen);

  // Un punto no puede imantarse a sí mismo mientras se arrastra.
  const exclude: ReadonlySet<PointId> | undefined =
    editor.toolState.kind === 'moving' ? new Set(editor.toolState.pointIds) : undefined;

  const snap = resolveSnap(editor.document, world, {
    gridEnabled: editor.grid.enabled,
    gridStepMm: editor.grid.stepMm,
    pointRadiusMm: editor.snapToPoints
      ? screenToWorldLength(viewport, POINT_SNAP_RADIUS_PX)
      : 0,
    ...(exclude !== undefined ? { exclude } : {}),
  });

  const hit = hitTest(editor.document, world, {
    pointMm: screenToWorldLength(viewport, POINT_HIT_RADIUS_PX),
    lineMm: screenToWorldLength(viewport, LINE_HIT_TOLERANCE_PX),
  });

  useCursorStore.getState().update(world, snap);

  return {
    screen,
    world,
    snap,
    hit,
    handleRadiusMm: screenToWorldLength(viewport, DRAFT_HANDLE_HIT_RADIUS_PX),
    shift: modifiers.shiftKey,
    alt: modifiers.altKey,
  };
}

/**
 * Enrutado de eventos de puntero del lienzo.
 *
 * El desplazamiento de la vista se resuelve aquí y no en una herramienta porque
 * no toca el modelo: mover la cámara está disponible en todo momento, sea cual
 * sea la herramienta activa, igual que el zoom.
 *
 * Se activa con el botón central o con Espacio + botón izquierdo, los dos
 * convenios habituales en editores gráficos.
 */
export function useCanvasPointer(svgRef: React.RefObject<SVGSVGElement | null>) {
  const dragRef = useRef<ActiveDrag | null>(null);
  const spaceRef = useRef(false);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || isTypingTarget(event.target)) return;
      // Sin esto, Espacio desplazaría la página bajo el lienzo.
      event.preventDefault();
      spaceRef.current = true;
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code === 'Space') spaceRef.current = false;
    };
    const onBlur = (): void => {
      spaceRef.current = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const element = svgRef.current;
    if (element === null || dragRef.current !== null) return;

    const screen = toScreen(element, event.clientX, event.clientY);
    const wantsPan = event.button === 1 || (event.button === 0 && spaceRef.current);

    if (wantsPan) {
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      dragRef.current = { pointerId: event.pointerId, mode: 'pan', lastScreen: screen };
      setPanning(true);
      return;
    }

    if (event.button !== 0) return;

    element.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, mode: 'tool', lastScreen: screen };

    const tool = getTool(useEditorStore.getState().tool);
    tool.onPointerDown?.(buildContext(screen, event));
  }, [svgRef]);

  const onPointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const element = svgRef.current;
    if (element === null) return;

    const screen = toScreen(element, event.clientX, event.clientY);
    const drag = dragRef.current;

    if (drag !== null && drag.mode === 'pan' && drag.pointerId === event.pointerId) {
      useViewportStore
        .getState()
        .panBy(screen.x - drag.lastScreen.x, screen.y - drag.lastScreen.y);
      drag.lastScreen = screen;
      return;
    }

    // Se notifica también sin arrastre: es lo que mantiene vivo el resaltado
    // bajo el cursor y la previsualización de la línea elástica.
    const tool = getTool(useEditorStore.getState().tool);
    tool.onPointerMove?.(buildContext(screen, event));
  }, [svgRef]);

  const endDrag = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const element = svgRef.current;
    const drag = dragRef.current;
    if (element === null || drag === null || drag.pointerId !== event.pointerId) return;

    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;

    if (drag.mode === 'pan') {
      setPanning(false);
      return;
    }

    const screen = toScreen(element, event.clientX, event.clientY);
    const tool = getTool(useEditorStore.getState().tool);
    tool.onPointerUp?.(buildContext(screen, event));
  }, [svgRef]);

  const onPointerLeave = useCallback(() => {
    if (dragRef.current !== null) return;
    useCursorStore.getState().clear();
    useEditorStore.getState().setHover(null);
  }, []);

  return {
    panning,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onPointerLeave,
      onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
    },
  };
}
