import { create } from 'zustand';

import type { Vec2 } from '@core/geometry/vec2';
import type { SnapResult } from '@domain/sketch/snapping';

/**
 * Posición del cursor, en su propio store.
 *
 * Se separa del store del editor porque cambia en cada evento de movimiento del
 * puntero: si viviera junto al documento, mover el ratón sobre el lienzo
 * volvería a renderizar todo el árbol. Aislada aquí, sólo se suscriben la barra
 * de estado y el indicador de ajuste.
 */
interface CursorStore {
  readonly world: Vec2 | null;
  readonly snap: SnapResult | null;
  update(world: Vec2, snap: SnapResult): void;
  clear(): void;
}

export const useCursorStore = create<CursorStore>()((set) => ({
  world: null,
  snap: null,
  update: (world, snap) => set({ world, snap }),
  clear: () => set({ world: null, snap: null }),
}));
