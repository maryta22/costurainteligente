import { useMemo, useRef } from 'react';

import { useEditorStore, selectionKeys } from '@state/editorStore';
import { useParametricStore } from '@state/parametricStore';
import { SIZE_CODES } from '@domain/measurements/standard';

import {
  draftHandles,
  selectGeneratedPattern,
  selectNestedPattern,
  usePatternStore,
} from '@state/patternStore';
import { useViewportStore } from '@state/viewportStore';

import { useCanvasPointer } from './hooks/useCanvasPointer';
import { useElementSize } from './hooks/useElementSize';
import { useWheelZoom } from './hooks/useWheelZoom';
import { getTool } from './interaction/tools';
import { GridLayer } from './layers/GridLayer';
import { MeasureLayer } from './layers/MeasureLayer';
import { NestLayer } from './layers/NestLayer';
import { OverlayLayer } from './layers/OverlayLayer';
import { PieceLayer } from './layers/PieceLayer';
import { SketchLayer } from './layers/SketchLayer';
import { worldTransform } from './transform';

/**
 * Lienzo de patrón.
 *
 * Responsabilidades: medirse a sí mismo, entregar eventos ya traducidos a la
 * herramienta activa y componer las capas. No contiene ninguna regla de
 * geometría ni de dominio.
 *
 * El `<svg>` ocupa el 100 % de su contenedor y el tamaño real llega al store
 * por `ResizeObserver`. Así el `Viewport` conoce siempre las dimensiones
 * efectivas del lienzo, que es de donde salen el centrado y el encuadre.
 */
export function PatternCanvas() {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const viewport = useViewportStore((state) => state.viewport);
  const setSize = useViewportStore((state) => state.setSize);
  const hostRef = useElementSize<HTMLDivElement>(setSize);

  const document = useEditorStore((state) => state.document);
  const selection = useEditorStore((state) => state.selection);
  const hover = useEditorStore((state) => state.hover);
  const toolState = useEditorStore((state) => state.toolState);
  const toolId = useEditorStore((state) => state.tool);
  const grid = useEditorStore((state) => state.grid);
  const unit = useEditorStore((state) => state.displayUnit);

  const garment = usePatternStore((state) => state.garment);
  const overrides = usePatternStore((state) => state.overrides);
  const measurements = useParametricStore((state) => state.measurements);
  const ease = useParametricStore((state) => state.ease);
  const parameters = useParametricStore((state) => state.parameters);

  const generated = useMemo(
    () => selectGeneratedPattern({ garment, overrides, measurements, ease, parameters }),
    [garment, overrides, measurements, ease, parameters],
  );
  const pieces = generated?.pieces ?? [];
  const handles = useMemo(() => draftHandles(generated), [generated]);

  const nesting = usePatternStore((state) => state.nesting);
  const graderId = usePatternStore((state) => state.graderId);
  const baseSize = useParametricStore((state) => state.size);

  const nested = useMemo(
    () =>
      nesting
        ? selectNestedPattern({
            garment,
            overrides,
            measurements,
            ease,
            parameters,
            baseSize,
            sizes: SIZE_CODES,
            graderId,
          })
        : [],
    [nesting, garment, overrides, measurements, ease, parameters, baseSize, graderId],
  );

  const showSeamAllowance = usePatternStore((state) => state.showSeamAllowance);
  const showNotches = usePatternStore((state) => state.showNotches);
  const showGrainLine = usePatternStore((state) => state.showGrainLine);
  const showEdgeColors = usePatternStore((state) => state.showEdgeColors);
  const showHandles = usePatternStore((state) => state.showHandles);

  useWheelZoom(svgRef);
  const { panning, handlers } = useCanvasPointer(svgRef);

  const selected = useMemo(() => selectionKeys(selection), [selection]);
  const transform = worldTransform(viewport);
  const cursor = panning ? 'grabbing' : getTool(toolId).cursor;

  return (
    <div className="canvas-host" ref={hostRef}>
      <svg
        ref={svgRef}
        className="canvas"
        width="100%"
        height="100%"
        style={{ cursor, touchAction: 'none' }}
        {...handlers}
      >
        <g transform={transform}>
          <GridLayer viewport={viewport} stepMm={grid.stepMm} enabled={grid.enabled} />
          {/* Debajo de la pieza base: es contexto, no el objeto de trabajo. */}
          <NestLayer sizes={nested} />
          <PieceLayer
            pieces={pieces}
            viewport={viewport}
            handles={handles}
            showSeamAllowance={showSeamAllowance}
            showNotches={showNotches}
            showGrainLine={showGrainLine}
            showEdgeColors={showEdgeColors}
            showHandles={showHandles}
          />
          <SketchLayer
            document={document}
            viewport={viewport}
            selection={selected}
            hover={hover}
          />
          <OverlayLayer document={document} viewport={viewport} toolState={toolState} />
        </g>

        {/* Fuera del grupo transformado: el texto no debe heredar la inversión de Y. */}
        <MeasureLayer
          document={document}
          viewport={viewport}
          toolState={toolState}
          selection={selection}
          unit={unit}
        />
      </svg>
    </div>
  );
}
