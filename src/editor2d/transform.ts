import type { Viewport } from '@core/geometry/viewport';
import { scaleOf } from '@core/geometry/viewport';

/**
 * Transformación SVG equivalente a `worldToScreen`.
 *
 * Aplicarla a un `<g>` deja que el navegador componga la matriz una sola vez
 * para todo el árbol, en lugar de recalcular cada coordenada en JavaScript en
 * cada desplazamiento de la vista. Es la mitigación estructural del riesgo R9.
 *
 * Se lee de derecha a izquierda:
 *   1. `translate(-center)`  lleva el punto de interés al origen
 *   2. `scale(s, -s)`        aplica la escala e INVIERTE Y
 *   3. `translate(w/2, h/2)` centra el resultado en el lienzo
 *
 * Debe permanecer algebraicamente idéntica a `worldToScreen`; hay un test que
 * lo comprueba comparando ambas rutas sobre los mismos puntos.
 *
 * Consecuencia del factor negativo en Y: cualquier `<text>` descendiente
 * aparecería invertido. Por eso el texto no se dibuja dentro de este grupo,
 * sino en una capa aparte en coordenadas de pantalla.
 */
export function worldTransform(vp: Viewport): string {
  const s = scaleOf(vp);
  const tx = vp.size.width / 2;
  const ty = vp.size.height / 2;
  return `translate(${tx} ${ty}) scale(${s} ${-s}) translate(${-vp.center.x} ${-vp.center.y})`;
}
