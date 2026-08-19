import type { BodyMeasurements, MeasurementKey } from './types';
import { MEASUREMENT_DEFINITIONS } from './types';

export type MeasurementIssue =
  | {
      readonly kind: 'out-of-range';
      readonly key: MeasurementKey;
      readonly value: number;
      readonly min: number;
      readonly max: number;
    }
  | { readonly kind: 'not-a-number'; readonly key: MeasurementKey }
  | {
      readonly kind: 'inconsistent';
      readonly message: string;
      readonly keys: readonly MeasurementKey[];
    };

/**
 * Comprueba que las medidas describen un cuerpo posible.
 *
 * Dos niveles, y el segundo es el que de verdad aporta:
 *
 *   · RANGO. Atrapa el error más frecuente y más destructivo: introducir
 *     centímetros donde se esperan milímetros. Un busto de 92 en vez de 920
 *     genera un patrón de muñeca y nada más lo delataría.
 *   · COHERENCIA. Relaciones que se cumplen en cualquier cuerpo humano. Un
 *     contorno bajo pecho mayor que el de pecho, o una altura de pecho mayor
 *     que el largo de talle, no son cuerpos raros: son medidas mal tomadas o
 *     intercambiadas al teclearlas.
 *
 * Estas comprobaciones son AVISOS, no prohibiciones: el sistema debe poder
 * trazar para cuerpos atípicos. Pero merecen decirse.
 */
export function validateMeasurements(measurements: BodyMeasurements): MeasurementIssue[] {
  const issues: MeasurementIssue[] = [];

  for (const definition of MEASUREMENT_DEFINITIONS) {
    const value = measurements[definition.key];

    if (!Number.isFinite(value)) {
      issues.push({ kind: 'not-a-number', key: definition.key });
      continue;
    }

    if (value < definition.min || value > definition.max) {
      issues.push({
        kind: 'out-of-range',
        key: definition.key,
        value,
        min: definition.min,
        max: definition.max,
      });
    }
  }

  issues.push(...checkConsistency(measurements));
  return issues;
}

function checkConsistency(m: BodyMeasurements): MeasurementIssue[] {
  const issues: MeasurementIssue[] = [];

  const require = (
    condition: boolean,
    message: string,
    keys: readonly MeasurementKey[],
  ): void => {
    if (!condition) issues.push({ kind: 'inconsistent', message, keys });
  };

  require(
    m.underbust <= m.bust,
    'El contorno bajo pecho no puede superar al de pecho',
    ['underbust', 'bust'],
  );

  require(
    m.waist <= m.hip,
    'La cintura mayor que la cadera es posible pero muy inusual; conviene revisarla',
    ['waist', 'hip'],
  );

  require(
    m.bustHeight < m.frontWaistLength,
    'La altura de pecho debe ser menor que el largo de talle delantero',
    ['bustHeight', 'frontWaistLength'],
  );

  require(
    m.waistToKnee < m.waistToFloor,
    'La rodilla no puede quedar por debajo del suelo',
    ['waistToKnee', 'waistToFloor'],
  );

  require(
    m.waistToHip < m.waistToKnee,
    'La cadera debe quedar por encima de la rodilla',
    ['waistToHip', 'waistToKnee'],
  );

  require(
    m.wrist < m.bicep,
    'La muñeca debe ser más estrecha que el bíceps',
    ['wrist', 'bicep'],
  );

  /*
   * El ancho de espalda cabe holgadamente dentro del contorno de pecho. Si se
   * acerca a la mitad, casi con seguridad se ha tomado de hombro a hombro en
   * lugar de sisa a sisa.
   */
  require(
    m.backWidth < m.bust * 0.55,
    'El ancho de espalda parece excesivo para ese contorno de pecho',
    ['backWidth', 'bust'],
  );

  return issues;
}

export const measurementsAreValid = (measurements: BodyMeasurements): boolean =>
  validateMeasurements(measurements).length === 0;

export function describeMeasurementIssue(issue: MeasurementIssue): string {
  switch (issue.kind) {
    case 'not-a-number':
      return `${issue.key}: el valor no es un número`;
    case 'out-of-range':
      return `${issue.key}: ${issue.value} mm está fuera del rango plausible (${issue.min}–${issue.max} mm)`;
    case 'inconsistent':
      return issue.message;
  }
}
