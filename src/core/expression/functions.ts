import { TAU, clamp, degToRad, radToDeg } from '../geometry/math';

export interface FunctionDefinition {
  readonly minArgs: number;
  readonly maxArgs: number;
  readonly apply: (args: readonly number[]) => number;
  readonly description: string;
}

const arg = (args: readonly number[], index: number): number => args[index] ?? 0;

/**
 * Funciones disponibles en las expresiones paramétricas.
 *
 * El conjunto es deliberadamente pequeño y cerrado. No hay acceso al ámbito de
 * JavaScript ni forma de introducir funciones desde el texto de la fórmula: una
 * expresión es una operación aritmética sobre números, y nada más. Es lo que
 * hace que evaluar el documento de un tercero sea seguro por construcción, algo
 * que `eval` o `new Function` no pueden ofrecer a ningún precio.
 *
 * `min`, `max` y `clamp` cubren además la lógica condicional que necesita el
 * patronaje —«nunca menos de 15 mm», «como mucho la mitad»— sin tener que
 * introducir un operador ternario en la gramática.
 *
 * ── Por qué un `Map` y no un objeto ────────────────────────────────────────
 *
 * Un objeto plano hereda de `Object.prototype`, de modo que `TABLA['constructor']`
 * no devuelve `undefined` sino la función constructora. Una fórmula que
 * escribiera `constructor` colaría así una FUNCIÓN en una tubería que sólo
 * espera números. Lo mismo con `toString`, `valueOf` o `__proto__`.
 *
 * Un `Map` no tiene cadena de prototipos que consultar: `get` de una clave
 * ausente devuelve `undefined` y punto. Elimina la clase entera de fugas en
 * lugar de tapar los nombres conocidos uno a uno.
 */
export const FUNCTIONS: ReadonlyMap<string, FunctionDefinition> = new Map(
  Object.entries({
  min: {
    minArgs: 1,
    maxArgs: Infinity,
    apply: (args) => Math.min(...args),
    description: 'menor de los valores',
  },
  max: {
    minArgs: 1,
    maxArgs: Infinity,
    apply: (args) => Math.max(...args),
    description: 'mayor de los valores',
  },
  clamp: {
    minArgs: 3,
    maxArgs: 3,
    apply: (args) => clamp(arg(args, 0), arg(args, 1), arg(args, 2)),
    description: 'acota un valor entre un mínimo y un máximo',
  },
  abs: { minArgs: 1, maxArgs: 1, apply: (args) => Math.abs(arg(args, 0)), description: 'valor absoluto' },
  sqrt: { minArgs: 1, maxArgs: 1, apply: (args) => Math.sqrt(arg(args, 0)), description: 'raíz cuadrada' },
  hypot: {
    minArgs: 2,
    maxArgs: Infinity,
    apply: (args) => Math.hypot(...args),
    description: 'hipotenusa',
  },
  round: { minArgs: 1, maxArgs: 1, apply: (args) => Math.round(arg(args, 0)), description: 'redondeo' },
  floor: { minArgs: 1, maxArgs: 1, apply: (args) => Math.floor(arg(args, 0)), description: 'parte entera inferior' },
  ceil: { minArgs: 1, maxArgs: 1, apply: (args) => Math.ceil(arg(args, 0)), description: 'parte entera superior' },
  sign: { minArgs: 1, maxArgs: 1, apply: (args) => Math.sign(arg(args, 0)), description: 'signo' },

  /*
   * Trigonometría EN GRADOS. Los ángulos de un patrón se escriben en grados
   * —una pinza de 12°, un hombro con 22° de caída— y obligar a envolver cada
   * uno en una conversión a radianes multiplica las ocasiones de equivocarse.
   * El núcleo sigue trabajando en radianes; la traducción vive aquí.
   */
  sin: { minArgs: 1, maxArgs: 1, apply: (args) => Math.sin(degToRad(arg(args, 0))), description: 'seno (grados)' },
  cos: { minArgs: 1, maxArgs: 1, apply: (args) => Math.cos(degToRad(arg(args, 0))), description: 'coseno (grados)' },
  tan: { minArgs: 1, maxArgs: 1, apply: (args) => Math.tan(degToRad(arg(args, 0))), description: 'tangente (grados)' },
  asin: { minArgs: 1, maxArgs: 1, apply: (args) => radToDeg(Math.asin(clamp(arg(args, 0), -1, 1))), description: 'arcoseno, en grados' },
  acos: { minArgs: 1, maxArgs: 1, apply: (args) => radToDeg(Math.acos(clamp(arg(args, 0), -1, 1))), description: 'arcocoseno, en grados' },
  atan2: {
    minArgs: 2,
    maxArgs: 2,
    apply: (args) => radToDeg(Math.atan2(arg(args, 0), arg(args, 1))),
    description: 'ángulo del vector (y, x), en grados',
  },

  /** Perímetro de circunferencia a partir del radio. Útil en vuelos y cuellos. */
  circumference: {
    minArgs: 1,
    maxArgs: 1,
    apply: (args) => TAU * arg(args, 0),
    description: 'perímetro de una circunferencia de radio r',
  },
  /** Radio a partir de un perímetro: el trazado de una falda de vuelo. */
    radiusOf: {
      minArgs: 1,
      maxArgs: 1,
      apply: (args) => arg(args, 0) / TAU,
      description: 'radio de una circunferencia de perímetro p',
    },
  } satisfies Record<string, FunctionDefinition>),
);

export const isKnownFunction = (name: string): boolean => FUNCTIONS.has(name);

/** Constantes disponibles siempre, sin declararlas. Ver la nota sobre `Map`. */
export const CONSTANTS: ReadonlyMap<string, number> = new Map([
  ['PI', Math.PI],
  ['TAU', TAU],
]);
