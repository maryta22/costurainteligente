import type { Rect } from '@core/geometry/rect';
import { rectUnion } from '@core/geometry/rect';

import { documentBounds } from '@domain/sketch/document';
import { piecePlacedBounds } from '@domain/pattern/piece';

import { useEditorStore } from './editorStore';
import { useParametricStore } from './parametricStore';
import { selectGeneratedPattern, usePatternStore } from './patternStore';

/**
 * Envolvente de TODO lo que hay en el documento.
 *
 * Encuadrar debe enseñar lo que está en pantalla, venga del boceto o del
 * patrón. Que cada consumidor calculase su propia envolvente llevó a que
 * «Encuadrar» ignorase las piezas y dejase la vista en un sitio vacío; centrar
 * aquí el cálculo evita que vuelva a divergir al añadir más tipos de contenido.
 */
export function contentBounds(): Rect | null {
  let result: Rect | null = documentBounds(useEditorStore.getState().document);

  const pattern = usePatternStore.getState();
  const parametric = useParametricStore.getState();

  const generated = selectGeneratedPattern({
    garment: pattern.garment,
    overrides: pattern.overrides,
    measurements: parametric.measurements,
    ease: parametric.ease,
    parameters: parametric.parameters,
  });

  for (const piece of generated?.pieces ?? []) {
    const bounds = piecePlacedBounds(piece);
    if (bounds === null) continue;
    result = result === null ? bounds : rectUnion(result, bounds);
  }

  return result;
}
