import { describe, expect, it } from 'vitest';

import { evaluateParameters } from '@core/parametric/evaluate';

import { DEFAULT_FIT, FIT_PRESETS, easeProfile } from '@domain/measurements/ease';
import { buildInputScope, inputNames } from '@domain/measurements/scope';
import { SIZE_CODES, standardMeasurements } from '@domain/measurements/standard';
import { MEASUREMENT_DEFINITIONS } from '@domain/measurements/types';
import {
  describeMeasurementIssue,
  measurementsAreValid,
  validateMeasurements,
} from '@domain/measurements/validate';
import { BLOCK_PARAMETERS } from '@domain/pattern/blockParameters';

const evaluateFor = (size: (typeof SIZE_CODES)[number], fit = DEFAULT_FIT) =>
  evaluateParameters(
    BLOCK_PARAMETERS,
    buildInputScope(standardMeasurements(size), easeProfile(fit)),
  );

describe('tablas de tallas', () => {
  it('todas las tallas estándar son coherentes', () => {
    for (const size of SIZE_CODES) {
      const issues = validateMeasurements(standardMeasurements(size));
      expect(issues.map(describeMeasurementIssue)).toEqual([]);
    }
  });

  it('todas las medidas definidas están presentes en cada talla', () => {
    for (const size of SIZE_CODES) {
      const measurements = standardMeasurements(size);
      for (const definition of MEASUREMENT_DEFINITIONS) {
        expect(Number.isFinite(measurements[definition.key])).toBe(true);
      }
    }
  });

  /*
   * Las tallas deben crecer de forma monótona en los contornos. Un salto
   * invertido en la tabla produciría un grading que se encoge al subir de
   * talla — un error que sólo se detectaría al superponer los patrones.
   */
  it('los contornos crecen monótonamente entre tallas', () => {
    const girths = ['bust', 'waist', 'hip', 'neck', 'bicep'] as const;

    for (const key of girths) {
      for (let i = 1; i < SIZE_CODES.length; i++) {
        const previous = SIZE_CODES[i - 1];
        const current = SIZE_CODES[i];
        if (previous === undefined || current === undefined) continue;

        expect(standardMeasurements(current)[key]).toBeGreaterThan(
          standardMeasurements(previous)[key],
        );
      }
    }
  });
});

describe('validación de medidas', () => {
  /*
   * El error más frecuente y más destructivo al introducir medidas: teclear
   * centímetros donde se esperan milímetros. Un busto de 92 en vez de 920
   * genera un patrón de muñeca y nada más lo delata.
   */
  it('atrapa la confusión entre centímetros y milímetros', () => {
    const wrong = { ...standardMeasurements('M'), bust: 88 };
    const issues = validateMeasurements(wrong);

    expect(issues.some((issue) => issue.kind === 'out-of-range' && issue.key === 'bust')).toBe(
      true,
    );
  });

  it('detecta medidas intercambiadas', () => {
    const base = standardMeasurements('M');
    const swapped = { ...base, underbust: base.bust + 100 };

    expect(
      validateMeasurements(swapped).some(
        (issue) => issue.kind === 'inconsistent' && issue.keys.includes('underbust'),
      ),
    ).toBe(true);
  });

  it('detecta una altura de pecho imposible', () => {
    const base = standardMeasurements('M');
    const broken = { ...base, bustHeight: base.frontWaistLength + 50 };

    expect(measurementsAreValid(broken)).toBe(false);
  });

  it('un valor no numérico se reporta', () => {
    const broken = { ...standardMeasurements('M'), waist: Number.NaN };
    expect(validateMeasurements(broken).some((issue) => issue.kind === 'not-a-number')).toBe(true);
  });
});

describe('ámbito de entrada', () => {
  it('contiene todas las medidas y las holguras con prefijo', () => {
    const scope = buildInputScope(standardMeasurements('M'), easeProfile('fitted'));

    expect(scope.get('bust')).toBe(880);
    expect(scope.get('easeBust')).toBe(FIT_PRESETS.fitted.bust);
    // La holgura NO puede confundirse con la medida del mismo nombre.
    expect(scope.has('ease')).toBe(false);
  });

  it('inputNames coincide con las claves del ámbito', () => {
    const scope = buildInputScope(standardMeasurements('M'), easeProfile('fitted'));
    expect(inputNames()).toEqual(new Set(scope.keys()));
  });
});

describe('parámetros de los bloques base', () => {
  it('se evalúan sin errores en todas las tallas y ajustes', () => {
    for (const size of SIZE_CODES) {
      for (const fit of Object.keys(FIT_PRESETS)) {
        const result = evaluateFor(size, fit as keyof typeof FIT_PRESETS);
        expect(result.issues).toEqual([]);
        expect(result.ok).toBe(true);
      }
    }
  });

  it('todos los parámetros obtienen valor', () => {
    const result = evaluateFor('M');
    for (const parameter of BLOCK_PARAMETERS) {
      expect(result.values.has(parameter.name)).toBe(true);
      expect(Number.isFinite(result.values.get(parameter.name))).toBe(true);
    }
  });

  it('las fórmulas dan los valores esperados en la talla M', () => {
    const result = evaluateFor('M', 'semi-fitted');
    const m = standardMeasurements('M');
    const ease = easeProfile('semi-fitted');

    expect(result.values.get('finishedBust')).toBe(m.bust + ease.bust);
    expect(result.values.get('bustQuarter')).toBe((m.bust + ease.bust) / 4);
    expect(result.values.get('neckWidth')).toBeCloseTo(m.neck / 5, 9);
    expect(result.values.get('skirtLength')).toBe(m.waistToKnee);
  });

  /*
   * El delantero se traza más ancho que la espalda: el volumen del pecho está
   * delante, y repartir el contorno a partes iguales dejaría la prenda tirante
   * por delante y sobrada por detrás.
   */
  it('el delantero es más ancho que la espalda, y suman el medio contorno', () => {
    const result = evaluateFor('M');
    const front = result.values.get('frontWidthQuarter') ?? 0;
    const back = result.values.get('backWidthQuarter') ?? 0;
    const bust = result.values.get('finishedBust') ?? 0;

    expect(front).toBeGreaterThan(back);
    expect(front + back).toBeCloseTo(bust / 2, 9);
  });

  /*
   * El pinzado repartido debe sumar EXACTAMENTE la reducción disponible: si
   * sumara menos, la falda quedaría suelta en la cintura; si sumara más, no
   * cerraría.
   *
   * Los factores son cuatro y dos, no uno: hay cuatro costados —dos costuras,
   * cada una con su mitad delantera y su mitad trasera— y dos pinzas de cada
   * tipo, porque cada media pieza se corta dos veces.
   */
  it('el pinzado repartido suma la reducción total', () => {
    const result = evaluateFor('M', 'fitted');

    const reduction = result.values.get('waistReduction') ?? 0;
    const side = result.values.get('skirtSideIntake') ?? 0;
    const back = result.values.get('skirtBackDart') ?? 0;
    const front = result.values.get('skirtFrontDart') ?? 0;

    expect(reduction).toBeGreaterThan(0);
    expect(4 * side + 2 * front + 2 * back).toBeCloseTo(reduction, 9);
  });

  /*
   * La cintura del patrón por cuarto, medida sobre la curva, más las pinzas,
   * tiene que dar la cintura terminada. Es la identidad que hace exacto el
   * criterio de salida de la Fase 5.
   */
  it('la longitud de cintura por cuarto cierra con la cintura terminada', () => {
    const result = evaluateFor('M');

    const span = result.values.get('skirtWaistSpan') ?? 0;
    const front = result.values.get('skirtFrontDart') ?? 0;
    const back = result.values.get('skirtBackDart') ?? 0;

    expect(4 * span - 2 * front - 2 * back).toBeCloseTo(
      result.values.get('finishedWaist') ?? 0,
      9,
    );
  });

  it('más holgura produce una prenda mayor', () => {
    const fitted = evaluateFor('M', 'fitted').values.get('finishedBust') ?? 0;
    const oversize = evaluateFor('M', 'oversize').values.get('finishedBust') ?? 0;

    expect(oversize).toBeGreaterThan(fitted);
  });

  it('subir de talla agranda todos los cuartos', () => {
    const small = evaluateFor('XS');
    const large = evaluateFor('XL');

    for (const key of ['bustQuarter', 'waistQuarter', 'hipQuarter'] as const) {
      expect(large.values.get(key) ?? 0).toBeGreaterThan(small.values.get(key) ?? 0);
    }
  });

  it('ningún parámetro base eclipsa una medida de entrada', () => {
    const reserved = inputNames();
    for (const parameter of BLOCK_PARAMETERS) {
      expect(reserved.has(parameter.name)).toBe(false);
    }
  });
});
