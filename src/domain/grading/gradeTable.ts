import type { BodyMeasurements, MeasurementKey } from '../measurements/types';

export type GradeTable = Readonly<Record<MeasurementKey, number>>;

/**
 * Incrementos por paso de talla, en milímetros.
 *
 * ── De dónde salen ─────────────────────────────────────────────────────────
 *
 * Son los saltos habituales de una tabla de mujer europea, promediados a partir
 * de las tallas de referencia de `standard.ts`. Reflejan cómo crece un cuerpo
 * al subir de talla, que NO es proporcionalmente:
 *
 *   · Los CONTORNOS son los que más crecen —45 mm por talla en pecho, cintura
 *     y cadera— porque una talla es esencialmente volumen.
 *   · Los LARGOS apenas se mueven. La estatura sube 10 mm por talla y el largo
 *     de talle 6.5: alguien de una talla mayor no es proporcionalmente más
 *     alto, es más ancho.
 *   · Los ANCHOS crecen poco. El hombro gana 3.5 mm por talla frente a los 45
 *     del pecho: el esqueleto varía mucho menos que el tejido blando.
 *
 * Confundir esto y escalar el patrón entero por un factor —el error intuitivo—
 * produce tallas grandes con hombros de gigante y talles imposibles.
 */
export const STANDARD_GRADE_TABLE: GradeTable = {
  // Contornos: el grueso del salto de talla.
  bust: 45,
  underbust: 45,
  waist: 45,
  hip: 45,
  neck: 11,
  bicep: 16,
  wrist: 5,

  // Anchos: crecen poco, son estructura ósea.
  shoulderLength: 3.5,
  backWidth: 11,
  bustSpan: 7.5,

  // Largos y alturas: casi constantes entre tallas contiguas.
  height: 10,
  napeToWaist: 6.5,
  frontWaistLength: 9,
  bustHeight: 9,
  waistToHip: 3.5,
  waistToKnee: 8,
  waistToFloor: 10,
  armholeDepth: 6.5,
  armLength: 8,
};

/** Aplica `steps` pasos de graduación a unas medidas. */
export function applyGrade(
  base: BodyMeasurements,
  steps: number,
  table: GradeTable = STANDARD_GRADE_TABLE,
): BodyMeasurements {
  const result: Record<string, number> = {};

  for (const [key, value] of Object.entries(base)) {
    const increment = table[key as MeasurementKey] ?? 0;
    result[key] = value + increment * steps;
  }

  return result as BodyMeasurements;
}
