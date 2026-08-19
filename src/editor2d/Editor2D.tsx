import { useEditorStore } from '@state/editorStore';
import { useViewportStore } from '@state/viewportStore';

import { PatternCanvas } from './PatternCanvas';
import { RulerLeft, RulerTop } from './chrome/Rulers';

/**
 * Composición del editor 2D: reglas y lienzo.
 *
 * Las reglas y el lienzo comparten el mismo `Viewport`, por lo que están
 * sincronizados por construcción: no hay ningún desplazamiento que mantener a
 * mano entre ellos. El lienzo es además el único que se mide a sí mismo; las
 * reglas heredan las dimensiones del mismo estado.
 */
export function Editor2D() {
  const viewport = useViewportStore((state) => state.viewport);
  const unit = useEditorStore((state) => state.displayUnit);

  return (
    <div className="editor2d">
      <div className="editor2d__corner" aria-hidden="true">
        {unit}
      </div>
      <div className="editor2d__ruler-top">
        <RulerTop viewport={viewport} unit={unit} />
      </div>
      <div className="editor2d__ruler-left">
        <RulerLeft viewport={viewport} unit={unit} />
      </div>
      <div className="editor2d__canvas">
        <PatternCanvas />
      </div>
    </div>
  );
}
