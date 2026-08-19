import { NumberField } from '@components/NumberField';

import { radToDeg } from '@core/geometry/math';
import { angleBetweenPoints, distance, vec2 } from '@core/geometry/vec2';
import { formatLength, fromDisplayUnit, toDisplayUnit } from '@core/units';

import { findPoint, lineSegment } from '@domain/sketch/document';

import { selectedLine, selectedPoint, useEditorStore } from '@state/editorStore';

/**
 * Panel de propiedades de la selección.
 *
 * Cumple un papel que va más allá de la comodidad: permite introducir
 * coordenadas exactas en milímetros. Es la demostración concreta de que la
 * geometría vive en el modelo y no en la pantalla — el mismo punto se puede
 * colocar arrastrando o escribiendo, y ambas rutas terminan en la misma acción
 * del store.
 */
export function Inspector() {
  const document = useEditorStore((state) => state.document);
  const selection = useEditorStore((state) => state.selection);
  const unit = useEditorStore((state) => state.displayUnit);
  const setPointPosition = useEditorStore((state) => state.setPointPosition);

  const point = selectedPoint({ document, selection });
  const line = selectedLine({ document, selection });

  return (
    <aside className="inspector">
      <h2 className="inspector__title">Propiedades</h2>

      {point !== null && (
        <section className="inspector__section">
          <p className="inspector__kind">
            Punto <code>{point.id}</code>
          </p>
          <NumberField
            label="X"
            suffix={unit}
            value={toDisplayUnit(point.p.x, unit)}
            onCommit={(value) =>
              setPointPosition(point.id, vec2(fromDisplayUnit(value, unit), point.p.y))
            }
          />
          <NumberField
            label="Y"
            suffix={unit}
            value={toDisplayUnit(point.p.y, unit)}
            onCommit={(value) =>
              setPointPosition(point.id, vec2(point.p.x, fromDisplayUnit(value, unit)))
            }
          />
        </section>
      )}

      {line !== null &&
        (() => {
          const segment = lineSegment(document, line);
          const a = findPoint(document, line.a);
          const b = findPoint(document, line.b);
          if (segment === undefined || a === undefined || b === undefined) return null;

          const length = distance(segment.a, segment.b);
          const angle = radToDeg(angleBetweenPoints(segment.a, segment.b));

          return (
            <section className="inspector__section">
              <p className="inspector__kind">
                Línea <code>{line.id}</code>
              </p>
              <dl className="readout">
                <dt>Longitud</dt>
                <dd>{formatLength(length, unit)}</dd>
                <dt>Ángulo</dt>
                <dd>{angle.toFixed(2)}°</dd>
                <dt>Origen</dt>
                <dd>
                  <code>{a.id}</code> · {formatLength(a.p.x, unit)} , {formatLength(a.p.y, unit)}
                </dd>
                <dt>Destino</dt>
                <dd>
                  <code>{b.id}</code> · {formatLength(b.p.x, unit)} , {formatLength(b.p.y, unit)}
                </dd>
              </dl>
            </section>
          );
        })()}

      {point === null && line === null && (
        <section className="inspector__section">
          <p className="inspector__empty">
            {selection.length === 0
              ? 'Nada seleccionado.'
              : `${selection.length} entidades seleccionadas.`}
          </p>
          <dl className="readout">
            <dt>Puntos</dt>
            <dd>{document.points.length}</dd>
            <dt>Líneas</dt>
            <dd>{document.lines.length}</dd>
          </dl>
        </section>
      )}
    </aside>
  );
}
