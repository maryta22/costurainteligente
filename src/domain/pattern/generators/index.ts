import type { DraftContext } from '../construction/draft';

import { blouseGenerator } from './blouse';
import { dressGenerator } from './dress';
import { skirtGenerator } from './skirt';
import type { GarmentGenerator, GarmentId, GeneratedGarment } from './types';

export * from './types';
export { skirtGenerator, blouseGenerator, dressGenerator };

/**
 * Registro de generadores.
 *
 * En las Fases 6 y 7 se añadirán la blusa y el vestido. El registro existe
 * desde ahora para que añadirlos sea declarar una entrada y no tocar la
 * interfaz ni el estado.
 */
export const GENERATORS: Readonly<Partial<Record<GarmentId, GarmentGenerator>>> = {
  skirt: skirtGenerator,
  blouse: blouseGenerator,
  dress: dressGenerator,
};

export const AVAILABLE_GARMENTS: readonly GarmentId[] = ['skirt', 'blouse', 'dress'];

export const findGenerator = (id: GarmentId): GarmentGenerator | undefined => GENERATORS[id];

export interface GenerationResult extends GeneratedGarment {
  /** Parámetros que el generador necesitaba y no estaban definidos. */
  readonly missing: readonly string[];
}

/**
 * Genera una prenda comprobando antes que están sus parámetros.
 *
 * Sin la comprobación previa, un parámetro ausente valdría cero y el trazado
 * saldría deformado en silencio: una falda de largo cero es geometría válida
 * pero no es un error que nadie quiera diagnosticar mirando el dibujo.
 */
export function generateGarment(id: GarmentId, context: DraftContext): GenerationResult | null {
  const generator = findGenerator(id);
  if (generator === undefined) return null;

  const missing = generator.requires.filter((name) => !context.values.has(name));
  const result = generator.generate(context);

  return { ...result, missing };
}
