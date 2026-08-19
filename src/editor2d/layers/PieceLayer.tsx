import { memo, useMemo } from 'react';

import { contour, contourTransform } from '@core/geometry/contour';
import { applyToPoint } from '@core/geometry/mat3';
import type { Viewport } from '@core/geometry/viewport';
import { scaleOf } from '@core/geometry/viewport';
import { add, fromPolar, scale, sub, vec2 } from '@core/geometry/vec2';

import { edgeSegments } from '@domain/pattern/edge';
import { resolveNotches } from '@domain/pattern/notch';
import { placedContour } from '@domain/pattern/piece';
import { cutLine } from '@domain/pattern/seamAllowance';
import type { EdgeRole, PatternPiece } from '@domain/pattern/types';

import type { DraftHandle } from '@state/patternStore';

import { DRAFT_HANDLE_RADIUS_PX } from '../constants';
import { contourToPathData, polygonToPathData, segmentBetween } from '../svgPath';

/** Longitud de la marca de piquete dibujada, en px. */
const NOTCH_MARK_PX = 9;
/** Semiapertura de la punta de flecha del hilo, en px. */
const ARROW_PX = 7;

/**
 * Color por papel de arista.
 *
 * No es decoración: hace visible de un vistazo que la partición en aristas es
 * correcta y completa. Un tramo del contorno sin color es un tramo sin
 * identidad — el defecto que `validatePiece` detecta y que, sin verlo, sólo se
 * manifestaría al intentar coser la pieza.
 */
const ROLE_CLASS: Readonly<Record<EdgeRole, string>> = {
  hem: 'piece__edge--hem',
  side: 'piece__edge--side',
  armhole: 'piece__edge--armhole',
  'sleeve-cap': 'piece__edge--armhole',
  underarm: 'piece__edge--armhole',
  shoulder: 'piece__edge--shoulder',
  neckline: 'piece__edge--neckline',
  'center-front': 'piece__edge--fold',
  'center-back': 'piece__edge--fold',
  waist: 'piece__edge--side',
  hip: 'piece__edge--side',
  dart: 'piece__edge--dart',
  other: 'piece__edge--other',
};

interface PieceLayerProps {
  readonly pieces: readonly PatternPiece[];
  readonly viewport: Viewport;
  readonly handles: readonly DraftHandle[];
  readonly showSeamAllowance: boolean;
  readonly showNotches: boolean;
  readonly showGrainLine: boolean;
  readonly showEdgeColors: boolean;
  readonly showHandles: boolean;
}

export const PieceLayer = memo(function PieceLayer({
  pieces,
  viewport,
  handles,
  showSeamAllowance,
  showNotches,
  showGrainLine,
  showEdgeColors,
  showHandles,
}: PieceLayerProps) {
  const scale2d = scaleOf(viewport);

  return (
    <g className="piece-layer">
      {pieces.map((piece) => (
        <PieceView
          key={piece.id}
          piece={piece}
          pxPerMm={scale2d}
          showSeamAllowance={showSeamAllowance}
          showNotches={showNotches}
          showGrainLine={showGrainLine}
          showEdgeColors={showEdgeColors}
        />
      ))}

      {/*
        Manejadores del trazado paramétrico: los puntos que el usuario puede
        arrastrar para corregir el patrón sin tocar las fórmulas (AVISO 2).
        Los ajustados se marcan para poder localizarlos y deshacerlos.
      */}
      {showHandles &&
        handles.map((handle) => (
          <circle
            key={handle.name}
            className={`handle${handle.overridden ? ' handle--overridden' : ''}`}
            cx={handle.document.x}
            cy={handle.document.y}
            r={DRAFT_HANDLE_RADIUS_PX / scale2d}
            vectorEffect="non-scaling-stroke"
          >
            <title>{handle.name}</title>
          </circle>
        ))}
    </g>
  );
});

interface PieceViewProps {
  readonly piece: PatternPiece;
  readonly pxPerMm: number;
  readonly showSeamAllowance: boolean;
  readonly showNotches: boolean;
  readonly showGrainLine: boolean;
  readonly showEdgeColors: boolean;
}

function PieceView({
  piece,
  pxPerMm,
  showSeamAllowance,
  showNotches,
  showGrainLine,
  showEdgeColors,
}: PieceViewProps) {
  /*
   * La línea de corte es geometría DERIVADA: se recalcula al cambiar un margen,
   * nunca se almacena. Memorizarla evita rehacer el desplazamiento en cada
   * repintado, que ocurre con cada movimiento del ratón.
   */
  const cut = useMemo(() => cutLine(piece), [piece]);
  const notches = useMemo(() => (showNotches ? resolveNotches(piece) : []), [piece, showNotches]);

  const seamPath = contourToPathData(placedContour(piece));
  const cutPath = polygonToPathData(cut.polygon.map((p) => applyToPoint(piece.placement, p)));

  const mm = (px: number): number => px / pxPerMm;

  return (
    <g className="piece">
      {showSeamAllowance && (
        <path className="piece__cut" d={cutPath} vectorEffect="non-scaling-stroke" />
      )}

      <path className="piece__body" d={seamPath} />

      {showEdgeColors ? (
        piece.edges.map((edge) => (
          <path
            key={edge.id}
            className={`piece__edge ${ROLE_CLASS[edge.role]}`}
            d={contourToPathData(
              contourTransform(contour(edgeSegments(piece, edge), false), piece.placement),
            )}
            vectorEffect="non-scaling-stroke"
          />
        ))
      ) : (
        <path className="piece__seam" d={seamPath} vectorEffect="non-scaling-stroke" />
      )}

      {notches.map((resolved) => {
        // El piquete se DIBUJA en la línea de corte porque es donde se corta,
        // pero está DEFINIDO en la de costura, que es donde tiene que casar.
        const outer = applyToPoint(piece.placement, resolved.cutPoint);
        const inner = applyToPoint(
          piece.placement,
          add(resolved.cutPoint, scale(resolved.outward, -mm(NOTCH_MARK_PX))),
        );

        return (
          <g key={resolved.notch.id} className={`notch notch--${resolved.notch.type}`}>
            <path
              className="notch__mark"
              d={segmentBetween(outer, inner)}
              vectorEffect="non-scaling-stroke"
            />
            {/* Traza hasta la línea de costura: hace visible la proyección. */}
            <path
              className="notch__projection"
              d={segmentBetween(
                applyToPoint(piece.placement, resolved.seamPoint),
                outer,
              )}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}

      {showGrainLine && piece.grainLine !== null && (
        <GrainArrow piece={piece} lengthMm={mm(ARROW_PX)} />
      )}

      {piece.labels.map((label) => {
        const at = applyToPoint(piece.placement, label.position);
        return (
          <text
            key={label.text}
            className="piece__label"
            x={at.x}
            y={at.y}
            transform={`scale(1 -1) translate(0 ${-2 * at.y})`}
          >
            {label.text}
          </text>
        );
      })}
    </g>
  );
}

/** Línea de hilo con puntas de flecha en ambos extremos. */
function GrainArrow({ piece, lengthMm }: { piece: PatternPiece; lengthMm: number }) {
  const grain = piece.grainLine;
  if (grain === null) return null;

  const half = fromPolar(grain.length / 2, grain.angle);
  const from = applyToPoint(piece.placement, sub(grain.origin, half));
  const to = applyToPoint(piece.placement, add(grain.origin, half));

  const head = (tip: typeof from, towards: typeof to): string => {
    const direction = sub(towards, tip);
    const len = Math.hypot(direction.x, direction.y) || 1;
    const unit = vec2(direction.x / len, direction.y / len);
    const back = add(tip, scale(unit, lengthMm));
    const side = vec2(-unit.y, unit.x);

    return (
      segmentBetween(tip, add(back, scale(side, lengthMm * 0.5))) +
      segmentBetween(tip, add(back, scale(side, -lengthMm * 0.5)))
    );
  };

  return (
    <path
      className="grainline"
      d={segmentBetween(from, to) + head(from, to) + head(to, from)}
      vectorEffect="non-scaling-stroke"
    />
  );
}
