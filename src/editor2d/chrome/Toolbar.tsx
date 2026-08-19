import { rectExpand } from '@core/geometry/rect';
import type { DisplayUnit } from '@core/units';

import { GRADERS } from '@domain/grading';
import type { GarmentId } from '@domain/pattern/generators';
import { AVAILABLE_GARMENTS, GENERATORS } from '@domain/pattern/generators';

import { contentBounds } from '@state/framing';
import { useEditorStore } from '@state/editorStore';
import { usePatternStore } from '@state/patternStore';
import { useViewer3DStore } from '@state/viewer3dStore';
import { useViewportStore } from '@state/viewportStore';

import { ZOOM_STEP_FACTOR } from '../constants';
import { TOOLS, TOOL_ORDER } from '../interaction/tools';

const UNITS: readonly DisplayUnit[] = ['mm', 'cm', 'in'];
const GRID_STEPS_MM: readonly number[] = [1, 5, 10, 25, 50];

export function Toolbar() {
  const tool = useEditorStore((state) => state.tool);
  const setTool = useEditorStore((state) => state.setTool);
  const grid = useEditorStore((state) => state.grid);
  const setGrid = useEditorStore((state) => state.setGrid);
  const snapToPoints = useEditorStore((state) => state.snapToPoints);
  const setSnapToPoints = useEditorStore((state) => state.setSnapToPoints);
  const unit = useEditorStore((state) => state.displayUnit);
  const setUnit = useEditorStore((state) => state.setDisplayUnit);
  const past = useEditorStore((state) => state.past);
  const future = useEditorStore((state) => state.future);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);

  const garment = usePatternStore((state) => state.garment);
  const setGarment = usePatternStore((state) => state.setGarment);

  const zoom = useViewportStore((state) => state.viewport.zoom);
  const resetZoom = useViewportStore((state) => state.resetZoom);
  const setZoomLevel = useViewportStore((state) => state.setZoomLevel);
  const fit = useViewportStore((state) => state.fit);

  const fitToDocument = (): void => {
    const bounds = contentBounds();
    if (bounds !== null) fit(rectExpand(bounds, 20));
  };

  return (
    <header className="toolbar">
      <div className="toolbar__brand">Costura Inteligente</div>

      <label className="field">
        <span className="field__label">Prenda</span>
        <select
          value={garment}
          onChange={(event) => setGarment(event.target.value as GarmentId)}
        >
          {AVAILABLE_GARMENTS.map((id) => (
            <option key={id} value={id}>
              {GENERATORS[id]?.name ?? id}
            </option>
          ))}
        </select>
      </label>

      <div className="toolbar__group" role="radiogroup" aria-label="Herramienta">
        {TOOL_ORDER.map((id) => {
          const definition = TOOLS[id];
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={tool === id}
              className={`btn${tool === id ? ' btn--active' : ''}`}
              title={`${definition.label} (${definition.shortcut})`}
              onClick={() => setTool(id)}
            >
              {definition.label}
              <span className="btn__key">{definition.shortcut}</span>
            </button>
          );
        })}
      </div>

      <div className="toolbar__group">
        <button
          type="button"
          className="btn"
          disabled={past.length === 0}
          title="Deshacer (Ctrl+Z)"
          onClick={undo}
        >
          Deshacer
        </button>
        <button
          type="button"
          className="btn"
          disabled={future.length === 0}
          title="Rehacer (Ctrl+Mayús+Z)"
          onClick={redo}
        >
          Rehacer
        </button>
      </div>

      <div className="toolbar__group">
        <button
          type="button"
          className="btn"
          title="Alejar"
          onClick={() => setZoomLevel(zoom / ZOOM_STEP_FACTOR)}
        >
          −
        </button>
        <button
          type="button"
          className="btn btn--zoom"
          title="Escala 1:1 — tamaño real en pantalla (Ctrl+0)"
          onClick={resetZoom}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="btn"
          title="Acercar"
          onClick={() => setZoomLevel(zoom * ZOOM_STEP_FACTOR)}
        >
          +
        </button>
        <button type="button" className="btn" title="Encuadrar todo (F)" onClick={fitToDocument}>
          Encuadrar
        </button>
      </div>

      <div className="toolbar__group">
        <label className="field field--check">
          <input
            type="checkbox"
            checked={grid.enabled}
            onChange={(event) => setGrid({ enabled: event.target.checked })}
          />
          Rejilla
        </label>

        <label className="field">
          <span className="field__label">Paso</span>
          <select
            value={grid.stepMm}
            onChange={(event) => setGrid({ stepMm: Number(event.target.value) })}
          >
            {GRID_STEPS_MM.map((step) => (
              <option key={step} value={step}>
                {step} mm
              </option>
            ))}
          </select>
        </label>

        <label className="field field--check">
          <input
            type="checkbox"
            checked={snapToPoints}
            onChange={(event) => setSnapToPoints(event.target.checked)}
          />
          Imán a puntos
        </label>

        <label className="field">
          <span className="field__label">Unidad</span>
          <select value={unit} onChange={(event) => setUnit(event.target.value as DisplayUnit)}>
            {UNITS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      <PatternToggles />
    </header>
  );
}

const PATTERN_FLAGS = [
  { key: 'showSeamAllowance', label: 'Margen' },
  { key: 'showNotches', label: 'Piquetes' },
  { key: 'showGrainLine', label: 'Hilo' },
  { key: 'showEdgeColors', label: 'Aristas' },
] as const;

function PatternToggles() {
  const store = usePatternStore();

  return (
    <div className="toolbar__group">
      {PATTERN_FLAGS.map(({ key, label }) => (
        <label key={key} className="field field--check">
          <input type="checkbox" checked={store[key]} onChange={() => store.toggle(key)} />
          {label}
        </label>
      ))}

      <label className="field field--check">
        <input
          type="checkbox"
          checked={store.nesting}
          onChange={(event) => store.setNesting(event.target.checked)}
        />
        Nido de tallas
      </label>

      <Viewer3DToggles />

      {store.nesting && (
        <label className="field">
          <span className="field__label">Graduar</span>
          <select value={store.graderId} onChange={(event) => store.setGrader(event.target.value)}>
            {GRADERS.map((grader) => (
              <option key={grader.id} value={grader.id} title={grader.description}>
                {grader.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function Viewer3DToggles() {
  const visible = useViewer3DStore((state) => state.visible);
  const setVisible = useViewer3DStore((state) => state.setVisible);
  const showLevels = useViewer3DStore((state) => state.showLevels);
  const setShowLevels = useViewer3DStore((state) => state.setShowLevels);
  const showGarment = useViewer3DStore((state) => state.showGarment);
  const setShowGarment = useViewer3DStore((state) => state.setShowGarment);
  const showWireframe = useViewer3DStore((state) => state.showWireframe);
  const setShowWireframe = useViewer3DStore((state) => state.setShowWireframe);
  const showSeams = useViewer3DStore((state) => state.showSeams);
  const setShowSeams = useViewer3DStore((state) => state.setShowSeams);
  const dressed = useViewer3DStore((state) => state.dressed);
  const setDressed = useViewer3DStore((state) => state.setDressed);
  const showStrain = useViewer3DStore((state) => state.showStrain);
  const setShowStrain = useViewer3DStore((state) => state.setShowStrain);

  return (
    <>
      <label className="field field--check">
        <input
          type="checkbox"
          checked={visible}
          onChange={(event) => setVisible(event.target.checked)}
        />
        Vista 3D
      </label>

      {visible && (
        <>
          <label className="field field--check">
            <input
              type="checkbox"
              checked={showLevels}
              onChange={(event) => setShowLevels(event.target.checked)}
            />
            Secciones
          </label>

          <label className="field field--check">
            <input
              type="checkbox"
              checked={showGarment}
              onChange={(event) => setShowGarment(event.target.checked)}
            />
            Prenda
          </label>

          <label className="field field--check">
            <input
              type="checkbox"
              checked={showWireframe}
              onChange={(event) => setShowWireframe(event.target.checked)}
            />
            Malla
          </label>

          <label className="field field--check">
            <input
              type="checkbox"
              checked={showSeams}
              onChange={(event) => setShowSeams(event.target.checked)}
            />
            Costuras
          </label>

          <label className="field field--check">
            <input
              type="checkbox"
              checked={dressed}
              onChange={(event) => setDressed(event.target.checked)}
            />
            Vestir
          </label>

          <label className="field field--check">
            <input
              type="checkbox"
              checked={showStrain}
              onChange={(event) => setShowStrain(event.target.checked)}
            />
            Tensión
          </label>
        </>
      )}
    </>
  );
}
