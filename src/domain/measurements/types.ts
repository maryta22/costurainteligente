/**
 * Medidas corporales, TODAS EN MILÍMETROS.
 *
 * El conjunto está elegido para cubrir las tres prendas del MVP —falda, blusa y
 * vestido— sin pedir al usuario más de lo imprescindible. Cada medida que se
 * añade es una que alguien tiene que tomarse correctamente con una cinta, y
 * una medida mal tomada estropea el patrón entero.
 *
 * Se distinguen dos familias, y la distinción importa:
 *
 *   · CONTORNOS (`bust`, `waist`, `hip`…): rodean el cuerpo. Sobre ellos se
 *     aplica el ease y se dividen por cuatro para obtener un cuarto de patrón.
 *   · LARGOS y ANCHOS (`napeToWaist`, `shoulderLength`…): distancias directas.
 *     No se dividen ni suelen llevar ease.
 */
export type MeasurementKey =
  // Generales
  | 'height'
  // Contornos del torso
  | 'bust'
  | 'underbust'
  | 'waist'
  | 'hip'
  | 'neck'
  // Anchos
  | 'shoulderLength'
  | 'backWidth'
  | 'bustSpan'
  // Alturas y largos verticales
  | 'napeToWaist'
  | 'frontWaistLength'
  | 'bustHeight'
  | 'waistToHip'
  | 'waistToKnee'
  | 'waistToFloor'
  | 'armholeDepth'
  // Brazo
  | 'armLength'
  | 'bicep'
  | 'wrist';

export type BodyMeasurements = Readonly<Record<MeasurementKey, number>>;

export type MeasurementFamily = 'girth' | 'width' | 'length';

export interface MeasurementDefinition {
  readonly key: MeasurementKey;
  readonly label: string;
  readonly family: MeasurementFamily;
  /** Cómo tomarla. Aparece como ayuda en la interfaz. */
  readonly howTo: string;
  /** Límites plausibles en un cuerpo humano adulto, en mm. */
  readonly min: number;
  readonly max: number;
}

/**
 * Los límites NO son validación de formato sino de plausibilidad.
 *
 * Su función es atrapar el error más común y más destructivo al introducir
 * medidas: confundir centímetros con milímetros. Un busto de «92» en lugar de
 * «920» produce un patrón de muñeca sin que nada más lo delate.
 */
export const MEASUREMENT_DEFINITIONS: readonly MeasurementDefinition[] = [
  {
    key: 'height',
    label: 'Estatura',
    family: 'length',
    howTo: 'De la coronilla al suelo, descalza y con la espalda recta.',
    min: 1200,
    max: 2100,
  },
  {
    key: 'bust',
    label: 'Contorno de pecho',
    family: 'girth',
    howTo: 'Por la parte más prominente del pecho, con la cinta horizontal.',
    min: 600,
    max: 1600,
  },
  {
    key: 'underbust',
    label: 'Contorno bajo pecho',
    family: 'girth',
    howTo: 'Justo por debajo del pecho, donde apoya el aro del sujetador.',
    min: 550,
    max: 1500,
  },
  {
    key: 'waist',
    label: 'Contorno de cintura',
    family: 'girth',
    howTo: 'Por la parte más estrecha del talle, sin apretar.',
    min: 450,
    max: 1500,
  },
  {
    key: 'hip',
    label: 'Contorno de cadera',
    family: 'girth',
    howTo: 'Por la parte más ancha de la cadera, con la cinta horizontal.',
    min: 650,
    max: 1700,
  },
  {
    key: 'neck',
    label: 'Contorno de cuello',
    family: 'girth',
    howTo: 'Por la base del cuello, dejando holgura para un dedo.',
    min: 260,
    max: 550,
  },
  {
    key: 'shoulderLength',
    label: 'Largo de hombro',
    family: 'width',
    howTo: 'Del nacimiento del cuello al hueso del hombro.',
    min: 90,
    max: 200,
  },
  {
    key: 'backWidth',
    label: 'Ancho de espalda',
    family: 'width',
    howTo: 'De sisa a sisa por la espalda, a media altura de la sisa.',
    min: 280,
    max: 550,
  },
  {
    key: 'bustSpan',
    label: 'Separación de pecho',
    family: 'width',
    howTo: 'Distancia entre los dos puntos de pecho.',
    min: 120,
    max: 280,
  },
  {
    key: 'napeToWaist',
    label: 'Largo talle espalda',
    family: 'length',
    howTo: 'De la séptima cervical a la cintura, siguiendo la columna.',
    min: 300,
    max: 520,
  },
  {
    key: 'frontWaistLength',
    label: 'Largo talle delantero',
    family: 'length',
    howTo: 'Del hombro junto al cuello a la cintura, pasando por el pecho.',
    min: 300,
    max: 560,
  },
  {
    key: 'bustHeight',
    label: 'Altura de pecho',
    family: 'length',
    howTo: 'Del hombro junto al cuello al punto de pecho.',
    min: 180,
    max: 380,
  },
  {
    key: 'waistToHip',
    label: 'Altura de cadera',
    family: 'length',
    howTo: 'De la cintura a la parte más ancha de la cadera.',
    min: 130,
    max: 280,
  },
  {
    key: 'waistToKnee',
    label: 'Cintura a rodilla',
    family: 'length',
    howTo: 'De la cintura al centro de la rodilla, por el costado.',
    min: 400,
    max: 750,
  },
  {
    key: 'waistToFloor',
    label: 'Cintura al suelo',
    family: 'length',
    howTo: 'De la cintura al suelo, por el costado.',
    min: 800,
    max: 1300,
  },
  {
    key: 'armholeDepth',
    label: 'Altura de sisa',
    family: 'length',
    howTo: 'Del hombro a la línea de axila, medido en vertical.',
    min: 150,
    max: 320,
  },
  {
    key: 'armLength',
    label: 'Largo de brazo',
    family: 'length',
    howTo: 'Del hombro a la muñeca, con el brazo ligeramente flexionado.',
    min: 450,
    max: 750,
  },
  {
    key: 'bicep',
    label: 'Contorno de brazo',
    family: 'girth',
    howTo: 'Por la parte más ancha del bíceps.',
    min: 200,
    max: 550,
  },
  {
    key: 'wrist',
    label: 'Contorno de muñeca',
    family: 'girth',
    howTo: 'Por el hueso de la muñeca.',
    min: 120,
    max: 250,
  },
];

export const MEASUREMENT_KEYS: readonly MeasurementKey[] = MEASUREMENT_DEFINITIONS.map(
  (definition) => definition.key,
);

export const findMeasurementDefinition = (
  key: MeasurementKey,
): MeasurementDefinition | undefined =>
  MEASUREMENT_DEFINITIONS.find((definition) => definition.key === key);
