/**
 * Constantes visuales y de interacción, EN PÍXELES.
 *
 * Son magnitudes de percepción, no de modelo: el radio de acierto de un punto
 * debe sentirse igual a cualquier zoom, por lo que se define en pantalla y se
 * traduce a milímetros con `screenToWorldLength` justo antes de consultar la
 * geometría. Ningún módulo de `core` ni de `domain` conoce estos valores.
 */

/** Radio dibujado de un punto. */
export const POINT_RADIUS_PX = 4;
export const POINT_RADIUS_SELECTED_PX = 5.5;

/** Radio del área sensible de un punto. Mayor que el dibujado: la mano tiembla. */
export const POINT_HIT_RADIUS_PX = 9;

/** Distancia máxima al eje de una línea para considerarla señalada. */
export const LINE_HIT_TOLERANCE_PX = 6;

/** Radio del imán a puntos existentes. */
export const POINT_SNAP_RADIUS_PX = 10;

/** Radio dibujado y sensible de los manejadores del trazado paramétrico. */
export const DRAFT_HANDLE_RADIUS_PX = 3.5;
export const DRAFT_HANDLE_HIT_RADIUS_PX = 10;

/** Separación mínima entre líneas de rejilla antes de saltar al siguiente paso. */
export const GRID_MIN_SPACING_PX = 9;

/** Separación mínima entre marcas rotuladas de las reglas. */
export const RULER_MIN_TICK_SPACING_PX = 64;

/** Grosor de las bandas de regla, en píxeles CSS. */
export const RULER_SIZE_PX = 24;

/** Desplazamiento del puntero, en px, a partir del cual un clic pasa a arrastre. */
export const DRAG_THRESHOLD_PX = 3;

/** Sensibilidad del zoom con rueda. Mayor = más brusco. */
export const WHEEL_ZOOM_SENSITIVITY = 0.0015;

/** Saltos del zoom con los botones + / −. */
export const ZOOM_STEP_FACTOR = 1.25;
