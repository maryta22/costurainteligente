import { create } from 'zustand';

import type { ParameterDefinition, ParameterEvaluation } from '@core/parametric/types';
import { evaluateParameters } from '@core/parametric/evaluate';

import type { EaseProfile, FitPreset } from '@domain/measurements/ease';
import { DEFAULT_FIT, easeProfile } from '@domain/measurements/ease';
import { buildInputScope } from '@domain/measurements/scope';
import type { SizeCode } from '@domain/measurements/standard';
import { DEFAULT_SIZE, standardMeasurements } from '@domain/measurements/standard';
import type { BodyMeasurements, MeasurementKey } from '@domain/measurements/types';
import { BLOCK_PARAMETERS } from '@domain/pattern/blockParameters';

/**
 * Estado del motor paramétrico.
 *
 * Guarda LA ESPECIFICACIÓN —medidas, holguras, fórmulas— y nunca el resultado.
 * Los valores derivados se obtienen con `selectEvaluation`, que es una función
 * pura sobre este estado.
 *
 * Es la aplicación literal del flujo de datos de §1 de docs/ARCHITECTURE.md, y
 * tiene una consecuencia práctica inmediata: es imposible que los parámetros
 * mostrados y las medidas dejen de corresponderse, porque no hay dos copias que
 * puedan divergir.
 */
interface ParametricStore {
  readonly size: SizeCode;
  readonly measurements: BodyMeasurements;
  readonly fit: FitPreset;
  readonly ease: EaseProfile;
  readonly parameters: readonly ParameterDefinition[];

  setSize(size: SizeCode): void;
  setMeasurement(key: MeasurementKey, value: number): void;
  setFit(fit: FitPreset): void;
  setEase(key: keyof EaseProfile, value: number): void;
  setParameterExpression(name: string, expression: string): void;
  addParameter(definition: ParameterDefinition): void;
  removeParameter(name: string): void;
  resetParameters(): void;
}

export const useParametricStore = create<ParametricStore>()((set, get) => ({
  size: DEFAULT_SIZE,
  measurements: standardMeasurements(DEFAULT_SIZE),
  fit: DEFAULT_FIT,
  ease: easeProfile(DEFAULT_FIT),
  parameters: BLOCK_PARAMETERS,

  setSize: (size) => set({ size, measurements: standardMeasurements(size) }),

  setMeasurement: (key, value) =>
    set({ measurements: { ...get().measurements, [key]: value } }),

  setFit: (fit) => set({ fit, ease: easeProfile(fit) }),

  setEase: (key, value) => set({ ease: { ...get().ease, [key]: value } }),

  setParameterExpression: (name, expression) =>
    set({
      parameters: get().parameters.map((parameter) =>
        parameter.name === name ? { ...parameter, expression } : parameter,
      ),
    }),

  addParameter: (definition) => set({ parameters: [...get().parameters, definition] }),

  removeParameter: (name) =>
    set({ parameters: get().parameters.filter((parameter) => parameter.name !== name) }),

  resetParameters: () => set({ parameters: BLOCK_PARAMETERS }),
}));

/**
 * Evalúa el estado actual. Función PURA: mismo estado, mismo resultado.
 *
 * Se recalcula entera en cada cambio en lugar de propagar incrementalmente. Con
 * unas decenas de parámetros son microsegundos, y a cambio se elimina toda una
 * clase de errores de invalidación de caché. Cuando el coste importe, el grafo
 * ya sabe qué depende de qué: `transitiveDependents` da exactamente los
 * parámetros que hay que rehacer.
 */
export function selectEvaluation(state: {
  measurements: BodyMeasurements;
  ease: EaseProfile;
  parameters: readonly ParameterDefinition[];
}): ParameterEvaluation {
  return evaluateParameters(
    state.parameters,
    buildInputScope(state.measurements, state.ease),
  );
}
