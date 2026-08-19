import { memo } from 'react';

import { gridLines, visibleGridStep } from '@core/geometry/grid';
import type { Rect } from '@core/geometry/rect';
import type { Viewport } from '@core/geometry/viewport';
import { scaleOf, visibleWorldRect } from '@core/geometry/viewport';

import { GRID_MIN_SPACING_PX } from '../constants';

/** Cada cuántas divisiones menores se dibuja una línea de acento. */
const MAJOR_EVERY = 5;

/**
 * Compone todas las líneas de una dirección en un único `d` de `<path>`.
 *
 * Un `<path>` con cientos de subtrazos cuesta al navegador mucho menos que
 * cientos de elementos `<line>`: un nodo del DOM, un estilo, una operación de
 * pintado. Es la diferencia entre un desplazamiento fluido y uno a tirones al
 * alejar la vista.
 */
function gridPath(rect: Rect, step: number): string {
  const { vertical, horizontal } = gridLines(rect, step);
  let d = '';
  for (const x of vertical) d += `M${x} ${rect.min.y}V${rect.max.y}`;
  for (const y of horizontal) d += `M${rect.min.x} ${y}H${rect.max.x}`;
  return d;
}

interface GridLayerProps {
  readonly viewport: Viewport;
  readonly stepMm: number;
  readonly enabled: boolean;
}

export const GridLayer = memo(function GridLayer({
  viewport,
  stepMm,
  enabled,
}: GridLayerProps) {
  if (!enabled) return null;

  const rect = visibleWorldRect(viewport);
  const minorStep = visibleGridStep(stepMm, scaleOf(viewport), GRID_MIN_SPACING_PX);
  const majorStep = minorStep * MAJOR_EVERY;

  const minor = gridPath(rect, minorStep);
  const major = gridPath(rect, majorStep);

  // Los ejes del documento se dibujan siempre, aunque la rejilla se haya
  // simplificado: son la referencia absoluta del sistema de coordenadas.
  const axes =
    `M${rect.min.x} 0H${rect.max.x}` + `M0 ${rect.min.y}V${rect.max.y}`;

  return (
    <g className="grid" aria-hidden="true">
      {minor !== '' && <path className="grid__minor" d={minor} vectorEffect="non-scaling-stroke" />}
      {major !== '' && <path className="grid__major" d={major} vectorEffect="non-scaling-stroke" />}
      <path className="grid__axes" d={axes} vectorEffect="non-scaling-stroke" />
    </g>
  );
});
