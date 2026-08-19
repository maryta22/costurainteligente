import { useEffect } from 'react';

import { rectExpand } from '@core/geometry/rect';

import { contentBounds } from '@state/framing';
import type { ToolId } from '@state/editorStore';
import { useEditorStore } from '@state/editorStore';
import { useViewportStore } from '@state/viewportStore';

import { getTool } from '@editor2d/interaction/tools';

const TOOL_KEYS: Readonly<Record<string, ToolId>> = {
  KeyV: 'select',
  KeyP: 'point',
  KeyL: 'line',
};

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

/**
 * Atajos globales del editor.
 *
 * Se registran en `window` y no en el lienzo para que funcionen aunque el foco
 * esté en la barra de herramientas. La comprobación de `isTypingTarget` es
 * imprescindible: sin ella, escribir «120» en el inspector cambiaría de
 * herramienta y borraría la selección.
 *
 * Se usa `event.code` en lugar de `event.key` para que los atajos de
 * herramienta dependan de la posición física de la tecla y no cambien con la
 * distribución del teclado.
 */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return;

      const editor = useEditorStore.getState();
      const viewportStore = useViewportStore.getState();
      const mod = event.ctrlKey || event.metaKey;

      if (mod && event.code === 'KeyZ') {
        event.preventDefault();
        if (event.shiftKey) editor.redo();
        else editor.undo();
        return;
      }

      if (mod && event.code === 'KeyY') {
        event.preventDefault();
        editor.redo();
        return;
      }

      if (mod && event.code === 'KeyA') {
        event.preventDefault();
        editor.setSelection([
          ...editor.document.points.map((pt) => ({ kind: 'point', id: pt.id }) as const),
          ...editor.document.lines.map((ln) => ({ kind: 'line', id: ln.id }) as const),
        ]);
        return;
      }

      if (mod && (event.code === 'Digit0' || event.code === 'Numpad0')) {
        event.preventDefault();
        viewportStore.resetZoom();
        return;
      }

      if (event.code === 'KeyF' && !mod) {
        const bounds = contentBounds();
        if (bounds !== null) viewportStore.fit(rectExpand(bounds, 20));
        return;
      }

      if (event.code === 'Delete' || event.code === 'Backspace') {
        event.preventDefault();
        editor.deleteSelection();
        return;
      }

      if (event.code === 'Escape') {
        getTool(editor.tool).onEscape?.();
        editor.clearSelection();
        return;
      }

      const tool = TOOL_KEYS[event.code];
      if (tool !== undefined && !mod) editor.setTool(tool);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
