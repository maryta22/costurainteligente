import { memo } from 'react';

import type { Viewport } from '@core/geometry/viewport';
import { scaleOf } from '@core/geometry/viewport';

import { indexPoints } from '@domain/sketch/document';
import type { EntityRef, SketchDocument } from '@domain/sketch/types';
import { refKey } from '@domain/sketch/types';

import { POINT_RADIUS_PX, POINT_RADIUS_SELECTED_PX } from '../constants';

interface SketchLayerProps {
  readonly document: SketchDocument;
  readonly viewport: Viewport;
  readonly selection: ReadonlySet<string>;
  readonly hover: EntityRef | null;
}

/**
 * Dibuja el boceto dentro del grupo transformado a mundo.
 *
 * Las líneas se agrupan por estado visual en un único `<path>` cada uno. Es
 * posible porque el test de acierto NO usa el DOM —se resuelve analíticamente
 * en `domain/sketch/hitTest`— y por tanto ningún elemento necesita identidad
 * propia para poder seleccionarse. Esa decisión es la que permite escalar el
 * lienzo a patrones completos sin cambiar de tecnología de render.
 *
 * Los puntos sí son elementos individuales: su radio debe compensar la escala
 * del grupo (`r = radioEnPx / escala`) para conservar un tamaño constante en
 * pantalla, y son pocos por naturaleza.
 */
export const SketchLayer = memo(function SketchLayer({
  document,
  viewport,
  selection,
  hover,
}: SketchLayerProps) {
  const scale = scaleOf(viewport);
  const points = indexPoints(document);

  const hoverKey = hover === null ? null : refKey(hover);

  let normalPath = '';
  let selectedPath = '';
  let hoverPath = '';

  for (const line of document.lines) {
    const a = points.get(line.a);
    const b = points.get(line.b);
    if (a === undefined || b === undefined) continue;

    const d = `M${a.p.x} ${a.p.y}L${b.p.x} ${b.p.y}`;
    const key = `line:${line.id}`;

    if (selection.has(key)) selectedPath += d;
    else if (key === hoverKey) hoverPath += d;
    else normalPath += d;
  }

  return (
    <g className="sketch">
      {normalPath !== '' && (
        <path className="sketch__line" d={normalPath} vectorEffect="non-scaling-stroke" />
      )}
      {hoverPath !== '' && (
        <path
          className="sketch__line sketch__line--hover"
          d={hoverPath}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {selectedPath !== '' && (
        <path
          className="sketch__line sketch__line--selected"
          d={selectedPath}
          vectorEffect="non-scaling-stroke"
        />
      )}

      {document.points.map((point) => {
        const key = `point:${point.id}`;
        const isSelected = selection.has(key);
        const isHovered = key === hoverKey;
        const radiusPx = isSelected ? POINT_RADIUS_SELECTED_PX : POINT_RADIUS_PX;

        return (
          <circle
            key={point.id}
            className={
              'sketch__point' +
              (isSelected ? ' sketch__point--selected' : '') +
              (isHovered ? ' sketch__point--hover' : '')
            }
            cx={point.p.x}
            cy={point.p.y}
            r={radiusPx / scale}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </g>
  );
});
