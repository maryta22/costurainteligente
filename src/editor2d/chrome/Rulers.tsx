import { memo } from 'react';

import { niceStep } from '@core/geometry/math';
import type { Viewport } from '@core/geometry/viewport';
import { scaleOf, visibleWorldRect, worldToScreen } from '@core/geometry/viewport';
import { vec2 } from '@core/geometry/vec2';
import type { DisplayUnit } from '@core/units';
import { toDisplayUnit } from '@core/units';

import { useCursorStore } from '@state/cursorStore';

import { RULER_MIN_TICK_SPACING_PX, RULER_SIZE_PX } from '../constants';

/** Subdivisiones sin rotular entre dos marcas rotuladas. */
const SUBDIVISIONS = 5;

/** Longitud de las marcas, en píxeles, medida desde el borde interior. */
const MAJOR_TICK_PX = RULER_SIZE_PX;
const MINOR_TICK_PX = 5;

interface Tick {
  readonly world: number;
  readonly screen: number;
  readonly major: boolean;
}

/**
 * Marcas visibles de un eje.
 *
 * El paso se elige con `niceStep` a partir de una separación mínima en
 * píxeles: al alejar la vista, las divisiones saltan de 10 a 20, a 50, a
 * 100 mm… en lugar de amontonarse. Es la misma función que gobierna la
 * densidad de la rejilla, así que ambas permanecen coherentes entre sí.
 */
function computeTicks(
  viewport: Viewport,
  axis: 'x' | 'y',
): { readonly ticks: readonly Tick[]; readonly step: number } {
  const scale = scaleOf(viewport);
  if (scale <= 0) return { ticks: [], step: 0 };

  const rect = visibleWorldRect(viewport);
  const majorStep = niceStep(RULER_MIN_TICK_SPACING_PX / scale);
  const minorStep = majorStep / SUBDIVISIONS;

  const from = axis === 'x' ? rect.min.x : rect.min.y;
  const to = axis === 'x' ? rect.max.x : rect.max.y;

  const first = Math.ceil(from / minorStep) * minorStep;
  const count = Math.floor((to - first) / minorStep) + 1;
  if (count <= 0 || count > 4000) return { ticks: [], step: majorStep };

  const ticks: Tick[] = [];
  for (let i = 0; i < count; i++) {
    const world = first + i * minorStep;
    const point = axis === 'x' ? vec2(world, 0) : vec2(0, world);
    const screen = worldToScreen(viewport, point);
    // El redondeo evita que el error de coma flotante marque como menor una
    // división que cae exactamente sobre un múltiplo del paso mayor.
    const major = Math.abs(world / majorStep - Math.round(world / majorStep)) < 1e-6;
    ticks.push({ world, screen: axis === 'x' ? screen.x : screen.y, major });
  }

  return { ticks, step: majorStep };
}

const formatTick = (mm: number, unit: DisplayUnit): string => {
  const value = toDisplayUnit(mm, unit);
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
};

interface RulerProps {
  readonly viewport: Viewport;
  readonly unit: DisplayUnit;
}

export const RulerTop = memo(function RulerTop({ viewport, unit }: RulerProps) {
  const { ticks } = computeTicks(viewport, 'x');
  const cursor = useCursorStore((state) => state.world);
  const cursorX = cursor === null ? null : worldToScreen(viewport, cursor).x;

  return (
    <svg className="ruler ruler--top" width="100%" height={RULER_SIZE_PX} aria-hidden="true">
      {ticks.map((tick) => (
        <line
          key={tick.world}
          className={tick.major ? 'ruler__tick ruler__tick--major' : 'ruler__tick'}
          x1={tick.screen}
          y1={RULER_SIZE_PX - (tick.major ? MAJOR_TICK_PX : MINOR_TICK_PX)}
          x2={tick.screen}
          y2={RULER_SIZE_PX}
        />
      ))}
      {ticks
        .filter((tick) => tick.major)
        .map((tick) => (
          <text key={`t${tick.world}`} className="ruler__label" x={tick.screen + 3} y={10}>
            {formatTick(tick.world, unit)}
          </text>
        ))}
      {cursorX !== null && (
        <line className="ruler__cursor" x1={cursorX} y1={0} x2={cursorX} y2={RULER_SIZE_PX} />
      )}
    </svg>
  );
});

export const RulerLeft = memo(function RulerLeft({ viewport, unit }: RulerProps) {
  const { ticks } = computeTicks(viewport, 'y');
  const cursor = useCursorStore((state) => state.world);
  const cursorY = cursor === null ? null : worldToScreen(viewport, cursor).y;

  return (
    <svg className="ruler ruler--left" width={RULER_SIZE_PX} height="100%" aria-hidden="true">
      {ticks.map((tick) => (
        <line
          key={tick.world}
          className={tick.major ? 'ruler__tick ruler__tick--major' : 'ruler__tick'}
          x1={RULER_SIZE_PX - (tick.major ? MAJOR_TICK_PX : MINOR_TICK_PX)}
          y1={tick.screen}
          x2={RULER_SIZE_PX}
          y2={tick.screen}
        />
      ))}
      {ticks
        .filter((tick) => tick.major)
        .map((tick) => (
          <text
            key={`t${tick.world}`}
            className="ruler__label"
            x={10}
            y={tick.screen - 3}
            transform={`rotate(-90 10 ${tick.screen - 3})`}
          >
            {formatTick(tick.world, unit)}
          </text>
        ))}
      {cursorY !== null && (
        <line className="ruler__cursor" x1={0} y1={cursorY} x2={RULER_SIZE_PX} y2={cursorY} />
      )}
    </svg>
  );
});
