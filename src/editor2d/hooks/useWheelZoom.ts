import { useEffect } from 'react';

import { screenPoint } from '@core/geometry/screen';

import { WHEEL_ZOOM_SENSITIVITY } from '../constants';
import { useViewportStore } from '@state/viewportStore';

/**
 * Zoom con rueda anclado al cursor.
 *
 * El listener se registra de forma nativa y con `passive: false` a propósito.
 * React adjunta `wheel` en la raíz del árbol como listener pasivo, y un
 * listener pasivo no puede llamar a `preventDefault`: sin esto, la rueda haría
 * scroll de la página además de zoom.
 *
 * El factor es exponencial —`exp(-Δy · k)`— y no lineal, para que el zoom sea
 * multiplicativo: dos pasos hacia delante y dos hacia atrás devuelven
 * exactamente a la escala de partida, y la sensación es la misma a cualquier
 * nivel de ampliación.
 */
export function useWheelZoom(target: React.RefObject<SVGSVGElement | null>): void {
  useEffect(() => {
    const element = target.current;
    if (element === null) return;

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();

      const rect = element.getBoundingClientRect();
      const anchor = screenPoint(event.clientX - rect.left, event.clientY - rect.top);

      if (event.shiftKey) {
        useViewportStore.getState().panBy(-event.deltaY, 0);
        return;
      }

      const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
      useViewportStore.getState().zoomAt(anchor, factor);
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [target]);
}
