import { formatLength } from '@core/units';

import { useEditorStore } from '@state/editorStore';
import { usePatternStore } from '@state/patternStore';

/**
 * Ajustes manuales sobre el trazado — la mitad visible del AVISO 2.
 *
 * Guardar el ajuste como un delta con nombre resuelve que sobreviva a un cambio
 * de medidas. Pero eso no basta: si el usuario no puede VER qué ha tocado ni
 * deshacerlo, acaba con un patrón que no se comporta como dicen sus fórmulas y
 * sin forma de averiguar por qué. Esta lista es esa mitad.
 */
export function OverridesPanel() {
  const overrides = usePatternStore((state) => state.overrides);
  const clearOverride = usePatternStore((state) => state.clearOverride);
  const clearAll = usePatternStore((state) => state.clearAllOverrides);
  const showHandles = usePatternStore((state) => state.showHandles);
  const toggle = usePatternStore((state) => state.toggle);

  const unit = useEditorStore((state) => state.displayUnit);

  return (
    <section className="panel__section">
      <h3 className="panel__heading">Ajustes manuales</h3>

      <label className="field field--check">
        <input type="checkbox" checked={showHandles} onChange={() => toggle('showHandles')} />
        Mostrar puntos del trazado
      </label>

      {overrides.length === 0 ? (
        <p className="panel__hint">
          Arrastra un punto del trazado en el lienzo para corregirlo. La corrección se guarda
          como un desplazamiento y sobrevive a los cambios de medidas y de talla.
        </p>
      ) : (
        <>
          {overrides.map((override) => (
            <div key={override.point} className="override">
              <div className="override__info">
                <span className="override__name">{override.point}</span>
                <span className="override__delta">
                  {formatLength(override.delta.x, unit)} , {formatLength(override.delta.y, unit)}
                </span>
              </div>
              <button
                type="button"
                className="btn btn--small"
                onClick={() => clearOverride(override.point)}
                title="Devolver al valor paramétrico"
              >
                Deshacer
              </button>
            </div>
          ))}

          <button type="button" className="btn" onClick={clearAll}>
            Deshacer todos los ajustes
          </button>
        </>
      )}
    </section>
  );
}
