import { formatLength } from '@core/units';

import { useCursorStore } from '@state/cursorStore';
import { useEditorStore } from '@state/editorStore';
import { useViewportStore } from '@state/viewportStore';

import { TOOLS } from '../interaction/tools';

const SNAP_LABEL = {
  free: 'libre',
  grid: 'rejilla',
  point: 'punto',
} as const;

export function StatusBar() {
  const world = useCursorStore((state) => state.world);
  const snap = useCursorStore((state) => state.snap);

  const tool = useEditorStore((state) => state.tool);
  const unit = useEditorStore((state) => state.displayUnit);
  const selection = useEditorStore((state) => state.selection);
  const zoom = useViewportStore((state) => state.viewport.zoom);

  const isRealScale = Math.abs(zoom - 1) < 1e-9;

  return (
    <footer className="statusbar">
      <span className="statusbar__hint">{TOOLS[tool].hint}</span>

      <span className="statusbar__spacer" />

      {selection.length > 0 && (
        <span className="statusbar__item">{selection.length} seleccionado(s)</span>
      )}

      {snap !== null && (
        <span className="statusbar__item">ajuste: {SNAP_LABEL[snap.kind]}</span>
      )}

      <span className="statusbar__item statusbar__item--mono">
        {world === null
          ? '—'
          : `x ${formatLength(world.x, unit)}   y ${formatLength(world.y, unit)}`}
      </span>

      <span
        className={`statusbar__item statusbar__item--mono${isRealScale ? ' statusbar__item--accent' : ''}`}
        title={
          isRealScale
            ? 'Escala 1:1 — lo que se ve mide en pantalla lo que dice el modelo'
            : 'Zoom actual'
        }
      >
        {isRealScale ? '1:1' : `${Math.round(zoom * 100)}%`}
      </span>
    </footer>
  );
}
