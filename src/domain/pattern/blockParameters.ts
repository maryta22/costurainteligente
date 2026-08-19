import type { ParameterDefinition } from '@core/parametric/types';

/**
 * Parámetros derivados de los bloques base.
 *
 * Son las reglas de trazado clásicas escritas como fórmulas. Cada una responde
 * a una decisión de patronaje que, dicha en palabras, sería una línea de un
 * manual — y aquí es una línea de código que el sistema puede recalcular.
 *
 * ── Por qué viven en datos y no en funciones de TypeScript ──────────────────
 *
 * Porque son lo que el usuario debe poder LEER Y CAMBIAR. Un patronista que
 * prefiera repartir el pecho 5 mm distinto entre delantero y espalda tiene que
 * poder editar `frontWidth` sin recompilar nada. Escritas como código
 * quedarían fuera de su alcance; escritas como expresiones son el documento.
 *
 * Son también la entrada de la Fase 5: el generador de la falda leerá de aquí
 * `waistQuarter`, `hipQuarter` y `totalDartIntake` en lugar de recalcularlos.
 */
export const BLOCK_PARAMETERS: readonly ParameterDefinition[] = [
  /* — medidas terminadas: cuerpo más holgura — */
  {
    name: 'finishedBust',
    expression: 'bust + easeBust',
    label: 'Pecho terminado',
    unit: 'mm',
    description: 'Contorno de pecho de la prenda acabada.',
  },
  {
    name: 'finishedWaist',
    expression: 'waist + easeWaist',
    label: 'Cintura terminada',
    unit: 'mm',
  },
  {
    name: 'finishedHip',
    expression: 'hip + easeHip',
    label: 'Cadera terminada',
    unit: 'mm',
  },

  /* — cuartos de patrón — */
  {
    name: 'bustQuarter',
    expression: 'finishedBust / 4',
    label: 'Cuarto de pecho',
    unit: 'mm',
    description: 'Se traza un cuarto de prenda: media espalda o medio delantero.',
  },
  { name: 'waistQuarter', expression: 'finishedWaist / 4', label: 'Cuarto de cintura', unit: 'mm' },
  { name: 'hipQuarter', expression: 'finishedHip / 4', label: 'Cuarto de cadera', unit: 'mm' },

  /*
   * El delantero se traza más ancho que la espalda. El volumen del pecho está
   * delante, y repartir el contorno a partes iguales dejaría la prenda tirante
   * por delante y sobrada por detrás.
   */
  {
    name: 'frontWidthQuarter',
    expression: 'bustQuarter + 5',
    label: 'Cuarto delantero',
    unit: 'mm',
  },
  {
    name: 'backWidthQuarter',
    expression: 'bustQuarter - 5',
    label: 'Cuarto espalda',
    unit: 'mm',
  },

  /* — escote — */
  /*
   * Regla clásica: el ancho de escote es la quinta parte del contorno de
   * cuello. La caída delantera es ese ancho más un centímetro, y la trasera
   * apenas dos centímetros: el cuello se inclina hacia delante, así que por
   * detrás el escote sube casi hasta la base.
   */
  {
    name: 'neckWidth',
    expression: 'neck / 5',
    label: 'Ancho de escote',
    unit: 'mm',
  },
  { name: 'frontNeckDrop', expression: 'neckWidth + 10', label: 'Caída escote delantero', unit: 'mm' },
  { name: 'backNeckDrop', expression: '20', label: 'Caída escote espalda', unit: 'mm' },

  /* — sisa y hombro — */
  {
    name: 'draftArmholeDepth',
    expression: 'armholeDepth + easeArmholeDepth',
    label: 'Profundidad de sisa',
    unit: 'mm',
  },
  {
    name: 'shoulderSlope',
    expression: '22',
    label: 'Caída de hombro',
    unit: 'deg',
    description: 'Inclinación del hombro respecto a la horizontal.',
  },

  /* — entalle de la falda — */
  /*
   * La diferencia entre cadera y cintura es la tela que sobra en la cintura y
   * hay que absorber. Es la magnitud que decide si una falda queda recta o
   * entallada, y se reparte en tres sitios: los dos costados y las pinzas.
   *
   * El reparto respeta una identidad que el generador necesita:
   *
   *     4·costado + 2·pinzaDelantera + 2·pinzaEspalda = reducción total
   *
   * Cuatro costados (dos costuras, delantero y espalda) y dos pinzas de cada
   * tipo (la pieza se corta dos veces). Cumplirla es lo que hace que el
   * contorno de cintura del patrón salga EXACTO y no aproximado.
   *
   * La pinza de espalda es mayor que la delantera: el cuerpo tiene más volumen
   * detrás entre cintura y cadera, y necesita recoger más.
   */
  {
    name: 'waistReduction',
    expression: 'finishedHip - finishedWaist',
    label: 'Reducción de cintura',
    unit: 'mm',
    description: 'Tela sobrante en la cintura respecto a la cadera.',
  },
  {
    name: 'skirtFrontDart',
    expression: 'waistReduction * 0.10',
    label: 'Pinza delantera',
    unit: 'mm',
  },
  {
    name: 'skirtBackDart',
    expression: 'waistReduction * 0.15',
    label: 'Pinza de espalda',
    unit: 'mm',
  },
  {
    name: 'skirtSideIntake',
    expression: '(waistReduction - 2 * skirtFrontDart - 2 * skirtBackDart) / 4',
    label: 'Entrada de costado',
    unit: 'mm',
  },
  /*
   * Longitud OBJETIVO de la línea de cintura de cada cuarto, medida sobre la
   * curva. No es la distancia horizontal: la cintura sube hacia el costado, así
   * que el generador resuelve numéricamente qué anchura da esa longitud.
   */
  {
    name: 'skirtWaistSpan',
    expression: 'hipQuarter - skirtSideIntake',
    label: 'Longitud de cintura por cuarto',
    unit: 'mm',
  },
  {
    name: 'skirtSideRise',
    expression: '7',
    label: 'Subida de la cintura en el costado',
    unit: 'mm',
    description: 'La cintura sube hacia el costado para asentar sobre el cuerpo.',
  },
  {
    name: 'skirtFrontDartLength',
    expression: '100',
    label: 'Largo de pinza delantera',
    unit: 'mm',
  },
  {
    name: 'skirtBackDartLength',
    expression: '140',
    label: 'Largo de pinza de espalda',
    unit: 'mm',
  },
  {
    name: 'skirtFrontDartPosition',
    expression: 'skirtWaistSpan * 0.45',
    label: 'Posición de la pinza delantera',
    unit: 'mm',
    description: 'Distancia desde el centro delantero, medida sobre la cintura.',
  },
  {
    name: 'skirtBackDartPosition',
    expression: 'skirtWaistSpan * 0.5',
    label: 'Posición de la pinza de espalda',
    unit: 'mm',
  },

  /* — entalle del cuerpo — */
  /*
   * Misma identidad que en la falda, pero entre pecho y cintura:
   *
   *     4·costado + 2·pinzaDelantera + 2·pinzaEspalda = reducción
   *
   * La pinza de espalda es mayor: el omóplato necesita más recogida que el
   * delantero, donde parte del volumen ya lo absorbe el pecho.
   */
  {
    name: 'bodiceWaistReduction',
    expression: 'finishedBust - finishedWaist',
    label: 'Reducción de cintura del cuerpo',
    unit: 'mm',
  },
  {
    name: 'bodiceFrontDart',
    expression: 'bodiceWaistReduction * 0.15',
    label: 'Pinza de talle delantera',
    unit: 'mm',
  },
  {
    name: 'bodiceBackDart',
    expression: 'bodiceWaistReduction * 0.20',
    label: 'Pinza de talle de espalda',
    unit: 'mm',
  },
  {
    name: 'bodiceSideIntake',
    expression: '(bodiceWaistReduction - 2 * bodiceFrontDart - 2 * bodiceBackDart) / 4',
    label: 'Entrada de costado del cuerpo',
    unit: 'mm',
  },

  /*
   * Altura de la línea de axila, medida desde la cintura.
   *
   * Es COMÚN a delantero y espalda, y no es un detalle: si cada uno la tuviera
   * a su altura, sus costados medirían distinto y la blusa no cerraría por más
   * que se estirase al coser.
   */
  {
    name: 'underarmLevel',
    expression: 'napeToWaist - draftArmholeDepth',
    label: 'Altura de la línea de axila',
    unit: 'mm',
  },
  {
    name: 'backNeckRise',
    expression: '20',
    label: 'Subida del escote de espalda',
    unit: 'mm',
    description: 'Cuánto sube el escote del centro espalda al hombro.',
  },
  {
    name: 'frontNeckWidthExtra',
    expression: '3',
    label: 'Ensanche del escote delantero',
    unit: 'mm',
  },
  {
    name: 'bodiceFrontDartPosition',
    expression: 'frontWidthQuarter * 0.5',
    label: 'Posición de la pinza delantera',
    unit: 'mm',
  },
  {
    name: 'bodiceBackDartPosition',
    expression: 'backWidthQuarter * 0.5',
    label: 'Posición de la pinza de espalda',
    unit: 'mm',
  },
  {
    name: 'bodiceDartLength',
    expression: 'draftArmholeDepth * 0.7',
    label: 'Largo de las pinzas de talle',
    unit: 'mm',
  },

  /*
   * Pinzas del VESTIDO. Una sola por lado, compartida entre el cuerpo y la
   * falda: es la condición para que las dos líneas de cintura casen al coser el
   * talle, y lo que alinea verticalmente las pinzas de arriba y de abajo.
   */
  {
    name: 'dressFrontDart',
    expression: 'bodiceFrontDart',
    label: 'Pinza de talle delantera del vestido',
    unit: 'mm',
  },
  {
    name: 'dressBackDart',
    expression: 'bodiceBackDart',
    label: 'Pinza de talle de espalda del vestido',
    unit: 'mm',
  },

  /* — manga — */
  /*
   * El embebido de la copa es lo que da volumen al hombro: la copa mide MÁS que
   * la sisa a propósito, y ese exceso se reparte al coser. Sin él la manga
   * tira; con demasiado, frunce.
   *
   * Se reparte desigual: la espalda se lleva más, porque el omóplato necesita
   * ese volumen para que el brazo pueda ir hacia delante.
   */
  {
    name: 'sleeveCapEase',
    expression: '25',
    label: 'Embebido de copa',
    unit: 'mm',
  },
  {
    name: 'sleeveCapEaseFrontShare',
    expression: '0.4',
    label: 'Parte del embebido en el delantero',
    unit: 'ratio',
  },
  {
    name: 'sleeveWristWidth',
    expression: 'wrist + 80',
    label: 'Ancho de manga en la muñeca',
    unit: 'mm',
    description: 'Con holgura suficiente para que pase la mano.',
  },

  /* — pretina — */
  {
    name: 'waistbandWidth',
    expression: '35',
    label: 'Ancho de pretina',
    unit: 'mm',
  },
  {
    name: 'waistbandExtension',
    expression: '40',
    label: 'Solapa de la pretina',
    unit: 'mm',
    description: 'Prolongación para el cierre.',
  },

  /* — largos — */
  { name: 'skirtLength', expression: 'waistToKnee', label: 'Largo de falda', unit: 'mm' },
  {
    name: 'bodiceLength',
    expression: 'napeToWaist',
    label: 'Largo de cuerpo',
    unit: 'mm',
  },

  /* — manga — */
  {
    name: 'sleeveWidth',
    expression: 'bicep + easeBicep',
    label: 'Ancho de manga',
    unit: 'mm',
  },
  {
    name: 'sleeveCapHeight',
    expression: 'draftArmholeDepth * 0.75',
    label: 'Altura de copa',
    unit: 'mm',
    description: 'Tres cuartos de la sisa: la proporción habitual de una manga montada.',
  },
];
