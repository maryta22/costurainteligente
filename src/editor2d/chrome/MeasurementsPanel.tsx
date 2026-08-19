import { NumberField } from '@components/NumberField';

import { fromDisplayUnit, toDisplayUnit } from '@core/units';

import { EASE_KEYS, EASE_LABELS, FIT_PRESETS, FIT_PRESET_LABELS } from '@domain/measurements/ease';
import type { FitPreset } from '@domain/measurements/ease';
import { SIZE_CODES } from '@domain/measurements/standard';
import type { SizeCode } from '@domain/measurements/standard';
import { MEASUREMENT_DEFINITIONS } from '@domain/measurements/types';
import { describeMeasurementIssue, validateMeasurements } from '@domain/measurements/validate';

import { useEditorStore } from '@state/editorStore';
import { useParametricStore } from '@state/parametricStore';

const FAMILY_LABELS = {
  girth: 'Contornos',
  width: 'Anchos',
  length: 'Largos y alturas',
} as const;

const FAMILY_ORDER = ['girth', 'width', 'length'] as const;

export function MeasurementsPanel() {
  const size = useParametricStore((state) => state.size);
  const setSize = useParametricStore((state) => state.setSize);
  const measurements = useParametricStore((state) => state.measurements);
  const setMeasurement = useParametricStore((state) => state.setMeasurement);
  const fit = useParametricStore((state) => state.fit);
  const setFit = useParametricStore((state) => state.setFit);
  const ease = useParametricStore((state) => state.ease);
  const setEase = useParametricStore((state) => state.setEase);

  const unit = useEditorStore((state) => state.displayUnit);
  const issues = validateMeasurements(measurements);

  return (
    <div className="panel">
      <section className="panel__section">
        <label className="field field--stack">
          <span className="field__label">Talla base</span>
          <select value={size} onChange={(event) => setSize(event.target.value as SizeCode)}>
            {SIZE_CODES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>

        <label className="field field--stack">
          <span className="field__label">Ajuste</span>
          <select value={fit} onChange={(event) => setFit(event.target.value as FitPreset)}>
            {Object.keys(FIT_PRESETS).map((preset) => (
              <option key={preset} value={preset}>
                {FIT_PRESET_LABELS[preset as FitPreset]}
              </option>
            ))}
          </select>
        </label>
      </section>

      {issues.length > 0 && (
        <section className="panel__section issues">
          <h3 className="issues__title">Revisar</h3>
          {issues.map((issue) => (
            <p key={describeMeasurementIssue(issue)} className="issues__item">
              {describeMeasurementIssue(issue)}
            </p>
          ))}
        </section>
      )}

      {FAMILY_ORDER.map((family) => (
        <section key={family} className="panel__section">
          <h3 className="panel__heading">{FAMILY_LABELS[family]}</h3>

          {MEASUREMENT_DEFINITIONS.filter((definition) => definition.family === family).map(
            (definition) => (
              <NumberField
                key={definition.key}
                label={definition.label}
                suffix={unit}
                decimals={unit === 'mm' ? 0 : 1}
                value={toDisplayUnit(measurements[definition.key], unit)}
                onCommit={(value) =>
                  setMeasurement(definition.key, fromDisplayUnit(value, unit))
                }
              />
            ),
          )}
        </section>
      ))}

      <section className="panel__section">
        <h3 className="panel__heading">Holgura</h3>
        <p className="panel__hint">
          Milímetros añadidos al cuerpo. Cambia el tamaño de la prenda, no el margen de costura.
        </p>

        {EASE_KEYS.map((key) => (
          <NumberField
            key={key}
            label={EASE_LABELS[key]}
            suffix={unit}
            decimals={unit === 'mm' ? 0 : 1}
            value={toDisplayUnit(ease[key], unit)}
            onCommit={(value) => setEase(key, fromDisplayUnit(value, unit))}
          />
        ))}
      </section>
    </div>
  );
}
