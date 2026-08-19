import type { SizeCode } from '../measurements/standard';
import { SIZE_CODES, standardMeasurements } from '../measurements/standard';

import type { GradeTable } from './gradeTable';
import { STANDARD_GRADE_TABLE, applyGrade } from './gradeTable';
import type { GradeRequest, GradedSize, Grader } from './types';

const stepsBetween = (from: SizeCode, to: SizeCode): number =>
  SIZE_CODES.indexOf(to) - SIZE_CODES.indexOf(from);

/**
 * GRADUADOR POR MEDIDAS — el del MVP.
 *
 * Aplica los incrementos de la tabla a las medidas base y REGENERA el patrón
 * entero para cada talla. Es coherente por construcción: cada talla es el
 * trazado válido de un cuerpo concreto, no una deformación del trazado vecino.
 *
 * Su virtud es también su límite. Como todo se recalcula, las líneas de estilo
 * se mueven: un escote definido como «la quinta parte del contorno de cuello»
 * se abre al subir de talla. A veces es lo que se quiere —el escote acompaña al
 * cuerpo— y a veces no: un cuello camisero debe medir lo mismo en todas las
 * tallas. Resolver eso exige reglas por punto, que es la Fase posterior.
 *
 * Es el graduador correcto para partir de las medidas de una persona concreta y
 * obtener las tallas vecinas.
 */
export function createMeasurementDrivenGrader(
  table: GradeTable = STANDARD_GRADE_TABLE,
): Grader {
  return {
    id: 'measurement-driven',
    name: 'Por medidas',
    description:
      'Aplica los incrementos de talla a las medidas y vuelve a trazar el patrón entero.',

    grade(request: GradeRequest): GradedSize[] {
      return request.sizes.map((size) => {
        const steps = stepsBetween(request.baseSize, size);
        return {
          size,
          steps,
          isBase: steps === 0,
          measurements: steps === 0 ? request.base : applyGrade(request.base, steps, table),
        };
      });
    },
  };
}

/**
 * GRADUADOR POR TABLA — medidas antropométricas reales.
 *
 * Ignora las medidas base y usa las de referencia de cada talla. Existe porque
 * las tablas reales NO son lineales: los saltos entre tallas grandes son
 * mayores que entre pequeñas, y ninguna fórmula de incrementos constantes los
 * reproduce.
 *
 * Es el graduador correcto para hacer un patrón industrial destinado a una
 * tabla de tallas, no a una persona.
 */
export const standardTableGrader: Grader = {
  id: 'standard-table',
  name: 'Por tabla estándar',
  description: 'Usa las medidas de referencia de cada talla, sin partir de las introducidas.',

  grade(request: GradeRequest): GradedSize[] {
    return request.sizes.map((size) => ({
      size,
      steps: stepsBetween(request.baseSize, size),
      isBase: size === request.baseSize,
      measurements: standardMeasurements(size),
    }));
  },
};

export const measurementDrivenGrader = createMeasurementDrivenGrader();

export const GRADERS: readonly Grader[] = [measurementDrivenGrader, standardTableGrader];

export const findGrader = (id: string): Grader | undefined =>
  GRADERS.find((grader) => grader.id === id);

export const DEFAULT_GRADER_ID = measurementDrivenGrader.id;
