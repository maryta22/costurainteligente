import { useEffect, useRef } from 'react';

import type { ScreenSize } from '@core/geometry/screen';
import { screenSize } from '@core/geometry/screen';

/**
 * Observa el tamaño de un elemento y notifica los cambios.
 *
 * Se usa `ResizeObserver` en lugar del evento `resize` de la ventana porque el
 * lienzo puede cambiar de tamaño sin que lo haga la ventana: al plegar un
 * panel, al abrir el inspector o al ajustar una división.
 *
 * `contentRect` da el tamaño del área de contenido en píxeles CSS, que es
 * exactamente la unidad en la que trabaja el `Viewport`.
 */
export function useElementSize<T extends Element>(
  onResize: (size: ScreenSize) => void,
): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const callbackRef = useRef(onResize);
  callbackRef.current = onResize;

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      callbackRef.current(screenSize(width, height));
    });

    observer.observe(element);

    const rect = element.getBoundingClientRect();
    callbackRef.current(screenSize(rect.width, rect.height));

    return () => observer.disconnect();
  }, []);

  return ref;
}
