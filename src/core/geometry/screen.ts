/**
 * Coordenadas de PANTALLA: píxeles CSS, X hacia la derecha, Y HACIA ABAJO,
 * origen en la esquina superior izquierda del lienzo.
 *
 * `space: 'screen'` es obligatorio y no tiene valor por defecto. Junto con la
 * marca opcional `space?: 'world'` de `Vec2`, hace que el compilador rechace
 * ambas confusiones:
 *
 *   worldToScreen(vp, screenPt)  // error: falta/está mal la marca
 *   screenToWorld(vp, worldPt)   // error: falta la propiedad `space`
 *
 * El coste en tiempo de ejecución es una propiedad de cadena por punto, y los
 * puntos de pantalla sólo se construyen en la frontera de eventos del DOM,
 * nunca en bucles numéricos.
 */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
  readonly space: 'screen';
}

/** Desplazamiento en píxeles. Comparte representación con `ScreenPoint`. */
export type ScreenVector = ScreenPoint;

export interface ScreenSize {
  readonly width: number;
  readonly height: number;
}

export const screenPoint = (x: number, y: number): ScreenPoint => ({ x, y, space: 'screen' });

export const screenSize = (width: number, height: number): ScreenSize => ({ width, height });

export const screenAdd = (a: ScreenPoint, b: ScreenVector): ScreenPoint =>
  screenPoint(a.x + b.x, a.y + b.y);

export const screenSub = (a: ScreenPoint, b: ScreenPoint): ScreenVector =>
  screenPoint(a.x - b.x, a.y - b.y);

export const screenDistance = (a: ScreenPoint, b: ScreenPoint): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

export const EMPTY_SIZE: ScreenSize = Object.freeze({ width: 0, height: 0 });

export const isDegenerateSize = (size: ScreenSize): boolean =>
  size.width <= 0 || size.height <= 0;
