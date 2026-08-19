import { memo } from 'react';

import type { Viewport } from '@core/geometry/viewport';
import { scaleOf } from '@core/geometry/viewport';

import { findPoint } from '@domain/sketch/document';
import type { SketchDocument } from '@domain/sketch/types';

import type { ToolState } from '@state/editorStore';
import { useCursorStore } from '@state/cursorStore';

import { POINT_SNAP_RADIUS_PX } from '../constants';

interface OverlayLayerProps {
  readonly document: SketchDocument;
  readonly viewport: Viewport;
  readonly toolState: ToolState;
}

/**
 * Realimentación de la interacción en curso: marco de selección, línea elástica
 * e indicador de ajuste.
 *
 * Es geometría efímera —no forma parte del documento— pero se dibuja en el
 * mismo sistema de coordenadas de mundo, de modo que un marco trazado sobre
 * una zona ampliada encierra exactamente lo que el usuario ve encerrado.
 */
export const OverlayLayer = memo(function OverlayLayer({
  document,
  viewport,
  toolState,
}: OverlayLayerProps) {
  const scale = scaleOf(viewport);
  const snap = useCursorStore((state) => state.snap);

  return (
    <g className="overlay" aria-hidden="true">
      {toolState.kind === 'marquee' && (
        <rect
          className="overlay__marquee"
          x={Math.min(toolState.origin.x, toolState.current.x)}
          y={Math.min(toolState.origin.y, toolState.current.y)}
          width={Math.abs(toolState.current.x - toolState.origin.x)}
          height={Math.abs(toolState.current.y - toolState.origin.y)}
          vectorEffect="non-scaling-stroke"
        />
      )}

      {toolState.kind === 'line-pending' &&
        (() => {
          const from = findPoint(document, toolState.from);
          if (from === undefined) return null;
          return (
            <line
              className="overlay__rubber"
              x1={from.p.x}
              y1={from.p.y}
              x2={toolState.current.x}
              y2={toolState.current.y}
              vectorEffect="non-scaling-stroke"
            />
          );
        })()}

      {snap !== null && snap.kind === 'point' && (
        <circle
          className="overlay__snap"
          cx={snap.point.x}
          cy={snap.point.y}
          r={POINT_SNAP_RADIUS_PX / scale}
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  );
});
