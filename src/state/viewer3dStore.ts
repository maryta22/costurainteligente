import { create } from 'zustand';

import type { MeshQuality } from '@domain/garment3d';
import type { RelaxReport, StrainField } from '@domain/fitting';

/**
 * Estado de la vista 3D.
 *
 * Separado del resto porque su ciclo de vida es distinto: la vista puede estar
 * cerrada y entonces nada de esto importa. Tenerlo aparte permite además que el
 * editor 2D no vuelva a renderizarse al girar la cámara.
 *
 * Nótese que aquí NO hay geometría de la prenda. La malla 3D no es estado: se
 * deriva del patrón, que a su vez se deriva de las medidas. Guardarla sería
 * crear una segunda fuente de verdad que podría quedar desfasada — exactamente
 * lo que la arquitectura evita. Lo único que se guarda es el informe de calidad
 * de la última malla construida, que es un RESULTADO, no una entrada.
 */
interface Viewer3DStore {
  readonly visible: boolean;
  readonly showLevels: boolean;
  readonly showGarment: boolean;
  readonly showWireframe: boolean;
  readonly showSeams: boolean;
  /** Arista objetivo de la malla, en mm: menos es más fino y más costoso. */
  readonly targetEdgeMm: number;
  readonly quality: MeshQuality | null;
  readonly warnings: readonly string[];
  /** Ceñir la prenda al cuerpo en vez de dejarla plana alrededor. */
  readonly dressed: boolean;
  /** Colorear por deformación respecto al patrón. */
  readonly showStrain: boolean;
  readonly fit: { relax: RelaxReport; strain: StrainField } | null;
  readonly ease: ReadonlyMap<string, number>;

  setVisible(visible: boolean): void;
  setShowLevels(show: boolean): void;
  setShowGarment(show: boolean): void;
  setShowWireframe(show: boolean): void;
  setShowSeams(show: boolean): void;
  setTargetEdgeMm(mm: number): void;
  setDressed(dressed: boolean): void;
  setShowStrain(show: boolean): void;
  reportMesh(quality: MeshQuality, warnings: readonly string[]): void;
  reportFit(
    fit: { relax: RelaxReport; strain: StrainField } | null,
    ease: ReadonlyMap<string, number>,
  ): void;
}

export const useViewer3DStore = create<Viewer3DStore>()((set) => ({
  visible: false,
  showLevels: true,
  showGarment: true,
  showWireframe: false,
  showSeams: false,
  targetEdgeMm: 18,
  quality: null,
  warnings: [],
  dressed: true,
  showStrain: false,
  fit: null,
  ease: new Map(),

  setVisible: (visible) => set({ visible }),
  setShowLevels: (showLevels) => set({ showLevels }),
  setShowGarment: (showGarment) => set({ showGarment }),
  setShowWireframe: (showWireframe) => set({ showWireframe }),
  setShowSeams: (showSeams) => set({ showSeams }),
  setTargetEdgeMm: (targetEdgeMm) => set({ targetEdgeMm }),
  setDressed: (dressed) => set({ dressed }),
  setShowStrain: (showStrain) => set({ showStrain }),
  reportMesh: (quality, warnings) => set({ quality, warnings }),
  reportFit: (fit, ease) => set({ fit, ease }),
}));
