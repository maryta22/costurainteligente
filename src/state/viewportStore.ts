import { create } from 'zustand';

import type { Rect } from '@core/geometry/rect';
import type { ScreenPoint, ScreenSize } from '@core/geometry/screen';
import { screenSize } from '@core/geometry/screen';
import type { Viewport } from '@core/geometry/viewport';
import {
  createViewport,
  fitToRect,
  panByScreen,
  setZoom,
  setZoomAtScreen,
  withSize,
  zoomByFactorAtScreen,
} from '@core/geometry/viewport';
import { vec2 } from '@core/geometry/vec2';

/**
 * Estado de VISTA, deliberadamente separado del estado de MODELO.
 *
 * El viewport no entra en el historial de deshacer: nadie espera que Ctrl+Z
 * revierta un desplazamiento de la vista. Mantenerlo en su propio store hace
 * que esa distinción sea estructural y no una lista de excepciones dentro del
 * reductor del documento.
 */
interface ViewportStore {
  readonly viewport: Viewport;

  setSize(size: ScreenSize): void;
  panBy(dxPx: number, dyPx: number): void;
  zoomAt(anchor: ScreenPoint, factor: number): void;
  setZoomAt(anchor: ScreenPoint, zoom: number): void;
  setZoomLevel(zoom: number): void;
  /** Vuelve a escala 1:1 — tamaño real en pantalla. */
  resetZoom(): void;
  fit(rect: Rect, paddingPx?: number): void;
}

const INITIAL_VIEWPORT: Viewport = createViewport(vec2(0, 0), 1, screenSize(0, 0));

export const useViewportStore = create<ViewportStore>()((set, get) => ({
  viewport: INITIAL_VIEWPORT,

  setSize: (size) => set({ viewport: withSize(get().viewport, size) }),
  panBy: (dxPx, dyPx) => set({ viewport: panByScreen(get().viewport, dxPx, dyPx) }),
  zoomAt: (anchor, factor) => set({ viewport: zoomByFactorAtScreen(get().viewport, anchor, factor) }),
  setZoomAt: (anchor, zoom) => set({ viewport: setZoomAtScreen(get().viewport, anchor, zoom) }),
  setZoomLevel: (zoom) => set({ viewport: setZoom(get().viewport, zoom) }),
  resetZoom: () => set({ viewport: setZoom(get().viewport, 1) }),
  fit: (rect, paddingPx) => set({ viewport: fitToRect(get().viewport, rect, paddingPx) }),
}));
