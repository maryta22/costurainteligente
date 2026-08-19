import type { EaseProfile } from './ease';
import { EASE_KEYS, easeVariableName } from './ease';
import type { BodyMeasurements } from './types';
import { MEASUREMENT_KEYS } from './types';

/**
 * Construye el ámbito de ENTRADA del motor paramétrico.
 *
 * Es la frontera entre el dominio y el núcleo: a partir de aquí, el evaluador
 * de expresiones sólo ve un diccionario de números y no sabe nada de cuerpos ni
 * de prendas. Esa ignorancia es deliberada — permite probar el motor sin
 * patronaje y cambiar las medidas sin tocar el motor.
 *
 * Las holguras entran con el prefijo `ease` (`easeBust`) para que nunca puedan
 * confundirse con la medida corporal del mismo nombre.
 */
export function buildInputScope(
  measurements: BodyMeasurements,
  ease: EaseProfile,
): Map<string, number> {
  const scope = new Map<string, number>();

  for (const key of MEASUREMENT_KEYS) scope.set(key, measurements[key]);
  for (const key of EASE_KEYS) scope.set(easeVariableName(key), ease[key]);

  return scope;
}

/** Nombres reservados: los que ocupa el ámbito de entrada. */
export function inputNames(): Set<string> {
  const names = new Set<string>(MEASUREMENT_KEYS);
  for (const key of EASE_KEYS) names.add(easeVariableName(key));
  return names;
}
