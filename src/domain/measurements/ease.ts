/**
 * Holgura (ease): milímetros que se añaden al cuerpo para obtener la prenda.
 *
 * NO es un margen de error ni una tolerancia de fabricación. Es una decisión de
 * diseño, y la que más determina cómo se ve y se siente una prenda: el mismo
 * bloque con 40 mm o con 200 mm en el pecho da una camisa ajustada o una
 * camisa oversize.
 *
 * Se distingue del margen de costura, con el que se confunde a menudo: el ease
 * cambia el TAMAÑO de la prenda terminada; el margen de costura es tela extra
 * para poder unir las piezas y desaparece al coser.
 */
export type EaseKey = 'bust' | 'waist' | 'hip' | 'neck' | 'bicep' | 'armholeDepth';

export type EaseProfile = Readonly<Record<EaseKey, number>>;

export type FitPreset = 'fitted' | 'semi-fitted' | 'relaxed' | 'oversize';

/**
 * Holguras habituales por tipo de ajuste, en milímetros.
 *
 * `fitted` es un bloque de prueba: la holgura mínima para poder moverse. No es
 * una prenda de calle, es la base sobre la que se diseñan las demás. De hecho
 * un bloque con ease cero no se puede llevar — el cuerpo necesita unos
 * milímetros sólo para respirar y levantar los brazos.
 *
 * La holgura de cintura es siempre menor que la de pecho: la cintura marca y
 * las prendas que buscan forma no pueden permitirse ahí el mismo volumen.
 */
export const FIT_PRESETS: Readonly<Record<FitPreset, EaseProfile>> = {
  fitted: { bust: 40, waist: 20, hip: 40, neck: 10, bicep: 40, armholeDepth: 10 },
  'semi-fitted': { bust: 80, waist: 50, hip: 70, neck: 15, bicep: 60, armholeDepth: 15 },
  relaxed: { bust: 140, waist: 110, hip: 120, neck: 20, bicep: 90, armholeDepth: 25 },
  oversize: { bust: 240, waist: 220, hip: 200, neck: 30, bicep: 140, armholeDepth: 40 },
};

export const FIT_PRESET_LABELS: Readonly<Record<FitPreset, string>> = {
  fitted: 'Ajustado (bloque base)',
  'semi-fitted': 'Semiajustado',
  relaxed: 'Holgado',
  oversize: 'Muy holgado',
};

export const DEFAULT_FIT: FitPreset = 'semi-fitted';

export const easeProfile = (preset: FitPreset): EaseProfile => FIT_PRESETS[preset];

/**
 * Nombre con el que cada holgura entra en el ámbito de las expresiones.
 *
 * `bust` → `easeBust`. El prefijo evita que una holgura pueda confundirse con
 * la medida corporal del mismo nombre, que es exactamente la clase de error
 * que el validador de parámetros marca como `shadows-input`.
 */
export const easeVariableName = (key: EaseKey): string =>
  `ease${key.charAt(0).toUpperCase()}${key.slice(1)}`;

export const EASE_KEYS: readonly EaseKey[] = [
  'bust',
  'waist',
  'hip',
  'neck',
  'bicep',
  'armholeDepth',
];

export const EASE_LABELS: Readonly<Record<EaseKey, string>> = {
  bust: 'Pecho',
  waist: 'Cintura',
  hip: 'Cadera',
  neck: 'Cuello',
  bicep: 'Brazo',
  armholeDepth: 'Profundidad de sisa',
};
