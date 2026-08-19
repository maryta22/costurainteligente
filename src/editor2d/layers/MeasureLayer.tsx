import { memo } from 'react';

import { distance, midpoint } from '@core/geometry/vec2';
import type { Vec2 } from '@core/geometry/vec2';
import type { Viewport } from '@core/geometry/viewport';
import { worldToScreen } from '@core/geometry/viewport';
import type { DisplayUnit } from '@core/units';
import { formatLength } from '@core/units';

import { findPoint, lineSegment } from '@domain/sketch/document';
import type { EntityRef, SketchDocument } from '@domain/sketch/types';

import type { ToolState } from '@state/editorStore';

/** Separación de la etiqueta respecto al eje de la línea, en píxeles. */
const LABEL_OFFSET_PX = 12;

interface MeasureLayerProps {
  readonly document: SketchDocument;
  readonly viewport: Viewport;
  readonly toolState: ToolState;
  readonly selection: readonly EntityRef[];
  readonly unit: DisplayUnit;
}

/**
 * Cotas, EN ESPACIO DE PANTALLA.
 *
 * El texto no puede vivir dentro del grupo transformado a mundo: la escala
 * `(s, −s)` que invierte el eje Y también invertiría los glifos. Se dibuja
 * aquí, con las posiciones traducidas explícitamente por `worldToScreen`, que
 * es exactamente la misma transformación expresada de la otra manera.
 *
 * La longitud mostrada se calcula sobre las coordenadas del MODELO, en
 * milímetros, nunca sobre las de pantalla: es el valor real de la pieza, y no
 * cambia al hacer zoom.
 */
export const MeasureLayer = memo(function MeasureLayer({
  document,
  viewport,
  toolState,
  selection,
  unit,
}: MeasureLayerProps) {
  const labels: { key: string; at: Vec2; text: string }[] = [];

  if (toolState.kind === 'line-pending') {
    const from = findPoint(document, toolState.from);
    if (from !== undefined) {
      labels.push({
        key: 'pending',
        at: midpoint(from.p, toolState.current),
        text: formatLength(distance(from.p, toolState.current), unit),
      });
    }
  }

  const [only] = selection;
  if (selection.length === 1 && only !== undefined && only.kind === 'line') {
    const line = document.lines.find((ln) => ln.id === only.id);
    const segment = line === undefined ? undefined : lineSegment(document, line);
    if (segment !== undefined) {
      labels.push({
        key: `line:${only.id}`,
        at: midpoint(segment.a, segment.b),
        text: formatLength(distance(segment.a, segment.b), unit),
      });
    }
  }

  if (labels.length === 0) return null;

  return (
    <g className="measure" aria-hidden="true">
      {labels.map((label) => {
        const at = worldToScreen(viewport, label.at);
        return (
          <text
            key={label.key}
            className="measure__label"
            x={at.x}
            y={at.y - LABEL_OFFSET_PX}
            textAnchor="middle"
          >
            {label.text}
          </text>
        );
      })}
    </g>
  );
});
