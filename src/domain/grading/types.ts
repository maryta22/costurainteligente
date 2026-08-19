import type { BodyMeasurements } from '../measurements/types';
import type { SizeCode } from '../measurements/standard';

export interface GradedSize {
  readonly size: SizeCode;
  readonly measurements: BodyMeasurements;
  /** Pasos de talla respecto a la base. Negativo hacia abajo. */
  readonly steps: number;
  /** La talla sobre la que se tomaron las medidas. */
  readonly isBase: boolean;
}

export interface GradeRequest {
  readonly base: BodyMeasurements;
  readonly baseSize: SizeCode;
  readonly sizes: readonly SizeCode[];
}

/**
 * Graduador: obtiene las medidas de un rango de tallas a partir de una base.
 *
 * ── Por qué es una interfaz y no una función ───────────────────────────────
 *
 * Porque hay dos formas legítimas de graduar y el sistema tiene que admitir
 * ambas, más una tercera que llegará después (riesgo R7 de
 * docs/ARCHITECTURE.md):
 *
 *   · POR MEDIDAS. Se cambian las medidas del cuerpo y se REGENERA el patrón
 *     entero. Es coherente por construcción —cada talla es un trazado válido
 *     de su cuerpo— pero puede desplazar las líneas de estilo: un escote
 *     trazado a la quinta parte del cuello se abre al subir de talla, y quizá
 *     el diseño quería que no lo hiciera.
 *   · POR TABLA. Se usan medidas antropométricas reales, que NO son lineales:
 *     los saltos entre tallas grandes son mayores que entre pequeñas, y ninguna
 *     fórmula los reproduce.
 *   · POR REGLAS DE PUNTO (`RuleBasedGrader`, fase posterior). Cada punto del
 *     trazado lleva su propio incremento en X e Y. Es lo que hace la industria
 *     porque conserva las líneas de estilo exactamente, a costa de tener que
 *     definir la regla punto por punto.
 *
 * Las tres producen resultados distintos y todas son correctas para su
 * propósito. Fijar la interfaz ahora es lo que permitirá añadir la tercera sin
 * tocar ni la interfaz de usuario ni los generadores.
 */
export interface Grader {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  grade(request: GradeRequest): GradedSize[];
}
