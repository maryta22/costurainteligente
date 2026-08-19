import { memo } from 'react';

import { placedContour } from '@domain/pattern/piece';
import type { NestedSize } from '@state/patternStore';

import { contourToPathData } from '../svgPath';

interface NestLayerProps {
  readonly sizes: readonly NestedSize[];
}

/**
 * NIDO DE TALLAS — todas las tallas superpuestas sobre el mismo origen.
 *
 * Sólo se dibujan las tallas DISTINTAS de la base: la base la pinta
 * `PieceLayer` con todo su detalle —aristas coloreadas, piquetes, hilo— y aquí
 * quedaría tapada o duplicada.
 *
 * ── Qué se ve aquí y en ningún otro sitio ──────────────────────────────────
 *
 * Que las tallas evolucionen de forma regular. Una talla se genera trazando el
 * patrón entero para otro cuerpo, así que nada garantiza a priori que las
 * líneas queden paralelas: si dos curvas se cruzan, si el reparto de un escote
 * se dispara en los extremos o si una pinza se come el costado, el nido lo
 * enseña de golpe. Superpuestas, la irregularidad salta a la vista; una a una,
 * cada talla parece razonable.
 */
export const NestLayer = memo(function NestLayer({ sizes }: NestLayerProps) {
  return (
    <g className="nest" aria-hidden="true">
      {sizes
        .filter((entry) => !entry.isBase)
        .map((entry) => (
          <g key={entry.size} className={`nest__size nest__size--${entry.size.toLowerCase()}`}>
            {entry.pieces.map((piece) => (
              <path
                key={piece.id}
                className="nest__outline"
                d={contourToPathData(placedContour(piece))}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        ))}
    </g>
  );
});
