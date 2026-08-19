import { useEffect, useId, useRef, useState } from 'react';

interface NumberFieldProps {
  readonly label: string;
  readonly value: number;
  readonly suffix?: string;
  readonly step?: number;
  readonly decimals?: number;
  readonly onCommit: (value: number) => void;
}

/**
 * Campo numérico con confirmación explícita.
 *
 * El valor se confirma al pulsar Intro o al perder el foco, nunca en cada
 * pulsación: escribir «-» o «12.» son estados intermedios válidos que no deben
 * llegar al modelo. Escape descarta lo tecleado y restaura el valor vigente.
 *
 * Mientras el campo tiene el foco no se sincroniza con el exterior, para que
 * una actualización del documento no borre lo que el usuario está escribiendo.
 */
export function NumberField({
  label,
  value,
  suffix,
  step = 1,
  decimals = 2,
  onCommit,
}: NumberFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(() => value.toFixed(decimals));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value.toFixed(decimals));
  }, [value, decimals]);

  const commit = (): void => {
    const parsed = Number(draft.replace(',', '.'));
    if (Number.isFinite(parsed)) onCommit(parsed);
    else setDraft(value.toFixed(decimals));
  };

  return (
    <div className="numfield">
      <label className="numfield__label" htmlFor={id}>
        {label}
      </label>
      <div className="numfield__control">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step={step}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            commit();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              setDraft(value.toFixed(decimals));
              event.currentTarget.blur();
            }
            // Los atajos globales no deben dispararse mientras se teclea.
            event.stopPropagation();
          }}
        />
        {suffix !== undefined && <span className="numfield__suffix">{suffix}</span>}
      </div>
    </div>
  );
}
