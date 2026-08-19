import { useMemo, useState } from 'react';

import { formatExpressionIssue } from '@core/expression/parser';
import { describeParametricIssue } from '@core/parametric/evaluate';
import type { ParametricIssue } from '@core/parametric/types';
import { formatLength } from '@core/units';

import { useEditorStore } from '@state/editorStore';
import { selectEvaluation, useParametricStore } from '@state/parametricStore';

import { OverridesPanel } from './OverridesPanel';

/**
 * Panel de parámetros derivados.
 *
 * Es la comprobación viva del criterio de salida de la Fase 4: al cambiar una
 * medida, todo lo que se ve aquí se recalcula, y al escribir una fórmula
 * circular aparece el camino exacto del ciclo.
 *
 * Cada fórmula es editable. No es una demostración: es el modelo de trabajo. Un
 * patronista que quiera repartir el pecho de otro modo entre delantero y
 * espalda cambia `frontWidthQuarter` aquí, sin tocar código.
 */
export function ParametersPanel() {
  const measurements = useParametricStore((state) => state.measurements);
  const ease = useParametricStore((state) => state.ease);
  const parameters = useParametricStore((state) => state.parameters);
  const setExpression = useParametricStore((state) => state.setParameterExpression);
  const reset = useParametricStore((state) => state.resetParameters);

  const unit = useEditorStore((state) => state.displayUnit);

  const evaluation = useMemo(
    () => selectEvaluation({ measurements, ease, parameters }),
    [measurements, ease, parameters],
  );

  const issuesByParameter = useMemo(() => {
    const map = new Map<string, ParametricIssue[]>();
    for (const issue of evaluation.issues) {
      if (!('parameter' in issue)) continue;
      const bucket = map.get(issue.parameter) ?? [];
      bucket.push(issue);
      map.set(issue.parameter, bucket);
    }
    return map;
  }, [evaluation.issues]);

  const cycles = evaluation.issues.filter((issue) => issue.kind === 'cycle');

  return (
    <div className="panel">
      <section className="panel__section">
        <p className="panel__hint">
          Fórmulas sobre las medidas. Se admiten <code>+ − * / % ^</code>, funciones como{' '}
          <code>min</code>, <code>max</code> o <code>clamp</code>, y unidades: <code>2cm</code>.
        </p>
        <button type="button" className="btn" onClick={reset}>
          Restaurar fórmulas
        </button>
      </section>

      {cycles.length > 0 && (
        <section className="panel__section issues issues--error">
          <h3 className="issues__title">Dependencia circular</h3>
          {cycles.map((issue) => (
            <p key={describeParametricIssue(issue)} className="issues__item">
              {describeParametricIssue(issue)}
            </p>
          ))}
          <p className="panel__hint">
            Ningún parámetro se ha podido calcular: el orden de evaluación no existe mientras
            haya un ciclo.
          </p>
        </section>
      )}

      <OverridesPanel />

      <section className="panel__section">
        {parameters.map((parameter) => (
          <ParameterRow
            key={parameter.name}
            name={parameter.name}
            label={parameter.label ?? parameter.name}
            expression={parameter.expression}
            unitKind={parameter.unit ?? 'mm'}
            value={evaluation.values.get(parameter.name)}
            issues={issuesByParameter.get(parameter.name) ?? []}
            displayUnit={unit}
            onChange={(next) => setExpression(parameter.name, next)}
          />
        ))}
      </section>
    </div>
  );
}

interface ParameterRowProps {
  readonly name: string;
  readonly label: string;
  readonly expression: string;
  readonly unitKind: string;
  readonly value: number | undefined;
  readonly issues: readonly ParametricIssue[];
  readonly displayUnit: 'mm' | 'cm' | 'in';
  readonly onChange: (expression: string) => void;
}

function ParameterRow({
  name,
  label,
  expression,
  unitKind,
  value,
  issues,
  displayUnit,
  onChange,
}: ParameterRowProps) {
  const [draft, setDraft] = useState(expression);
  const [editing, setEditing] = useState(false);

  // Mientras no se esté editando, la fórmula sigue al estado (p. ej. al
  // restaurar); durante la edición manda lo que el usuario está escribiendo.
  const shown = editing ? draft : expression;
  const broken = issues.length > 0;

  return (
    <div className={`param${broken ? ' param--error' : ''}`}>
      <div className="param__head">
        <span className="param__label" title={name}>
          {label}
        </span>
        <span className="param__value">{formatValue(value, unitKind, displayUnit)}</span>
      </div>

      <input
        className="param__input"
        value={shown}
        spellCheck={false}
        onFocus={() => {
          setEditing(true);
          setDraft(expression);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(event.target.value);
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => event.stopPropagation()}
      />

      {issues.map((issue) => (
        <pre key={describeParametricIssue(issue)} className="param__issue">
          {renderIssue(issue)}
        </pre>
      ))}
    </div>
  );
}

/**
 * Muestra el problema con el cursor bajo la posición exacta del fallo.
 *
 * Es la diferencia entre «la fórmula falla» y saber dónde mirar sin tener que
 * releerla entera.
 */
function renderIssue(issue: ParametricIssue): string {
  if (issue.kind === 'syntax' || issue.kind === 'evaluation' || issue.kind === 'unknown-reference') {
    return formatExpressionIssue(issue.source, issue.issue);
  }
  return describeParametricIssue(issue);
}

function formatValue(
  value: number | undefined,
  unitKind: string,
  displayUnit: 'mm' | 'cm' | 'in',
): string {
  if (value === undefined) return '—';
  if (unitKind === 'deg') return `${value.toFixed(1)}°`;
  if (unitKind === 'ratio' || unitKind === 'count') return value.toFixed(2);
  return formatLength(value, displayUnit);
}
