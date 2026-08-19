import { describe, expect, it } from 'vitest';

import { contour } from '@core/geometry/contour';
import { cubicSeg } from '@core/geometry/cubic';
import { lineSeg } from '@core/geometry/line';
import { distance, vec2 } from '@core/geometry/vec2';

import { edgeLength, findEdge } from '@domain/pattern/edge';
import { edgeId, pieceId } from '@domain/pattern/ids';
import { createPiece } from '@domain/pattern/piece';
import {
  createSeam,
  endpoint,
  indexPieces,
  isEdgeSewn,
  openEdges,
  pairSeamPoints,
  seamLengths,
  seamsOfPiece,
} from '@domain/pattern/seam';
import type { PatternEdge, PatternPiece } from '@domain/pattern/types';
import { validatePattern, validateSeam } from '@domain/pattern/validate';

/**
 * Dos rectángulos que se cosen por un costado.
 *
 * El de la derecha tiene el costado ligeramente CURVO, de modo que su arista
 * mide algo más que la recta del otro: es el embebido, y sirve para comprobar
 * que el validador lo distingue de un error de trazado.
 */
function makePieces(curveBulge: number): {
  left: PatternPiece;
  right: PatternPiece;
} {
  const edgesFor = (name: string): PatternEdge[] => [
    { id: edgeId(name, 'hem'), role: 'hem', startSegment: 0, segmentCount: 1, seamAllowance: 40, onFold: false },
    { id: edgeId(name, 'side'), role: 'side', startSegment: 1, segmentCount: 1, seamAllowance: 15, onFold: false },
    { id: edgeId(name, 'shoulder'), role: 'shoulder', startSegment: 2, segmentCount: 1, seamAllowance: 10, onFold: false },
    { id: edgeId(name, 'center-front'), role: 'center-front', startSegment: 3, segmentCount: 1, seamAllowance: 0, onFold: true },
  ];

  const left = createPiece({
    id: pieceId('left'),
    name: 'Izquierda',
    contour: contour(
      [
        lineSeg(vec2(0, 0), vec2(100, 0)),
        lineSeg(vec2(100, 0), vec2(100, 300)),
        lineSeg(vec2(100, 300), vec2(0, 300)),
        lineSeg(vec2(0, 300), vec2(0, 0)),
      ],
      true,
    ),
    edges: edgesFor('left'),
  });

  const right = createPiece({
    id: pieceId('right'),
    name: 'Derecha',
    contour: contour(
      [
        lineSeg(vec2(0, 0), vec2(100, 0)),
        cubicSeg(vec2(100, 0), vec2(100 + curveBulge, 100), vec2(100 + curveBulge, 200), vec2(100, 300)),
        lineSeg(vec2(100, 300), vec2(0, 300)),
        lineSeg(vec2(0, 300), vec2(0, 0)),
      ],
      true,
    ),
    edges: edgesFor('right'),
  });

  return { left, right };
}

describe('longitudes de costura', () => {
  /*
   * ES LA COMPROBACIÓN CENTRAL DEL PATRONAJE.
   *
   * Casi todo error de trazado se manifiesta como una desigualdad de
   * longitudes: si la copa de manga no mide lo que la sisa más el embebido, la
   * manga no entra, y no hay forma de arreglarlo en la máquina de coser.
   */
  it('mide ambas aristas y su diferencia', () => {
    const { left, right } = makePieces(0);
    const pieces = indexPieces([left, right]);

    const seam = createSeam(
      endpoint(left.id, edgeId('left', 'side')),
      endpoint(right.id, edgeId('right', 'side')),
    );

    const lengths = seamLengths(seam, pieces);
    expect(lengths?.a).toBeCloseTo(300, 6);
    expect(lengths?.b).toBeCloseTo(300, 6);
    expect(lengths?.difference).toBeCloseTo(0, 6);
  });

  it('acepta una costura que casa', () => {
    const { left, right } = makePieces(0);
    const seam = createSeam(
      endpoint(left.id, edgeId('left', 'side')),
      endpoint(right.id, edgeId('right', 'side')),
    );

    expect(validateSeam(seam, indexPieces([left, right]))).toEqual([]);
  });

  it('rechaza una costura cuyas aristas no casan', () => {
    // Una curva pronunciada alarga el costado derecho mucho más que la tolerancia.
    const { left, right } = makePieces(60);
    const seam = createSeam(
      endpoint(left.id, edgeId('left', 'side')),
      endpoint(right.id, edgeId('right', 'side')),
    );

    const issues = validateSeam(seam, indexPieces([left, right]));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe('length-mismatch');
  });

  /*
   * El embebido no es una holgura accidental sino una técnica: la copa de una
   * manga mide más que su sisa a propósito. Declararlo convierte lo que sería
   * un error en una especificación cumplida.
   */
  it('el embebido declarado convierte una diferencia en algo correcto', () => {
    // Curvatura suficiente para que la diferencia supere con holgura los 2 mm
    // de tolerancia; con una curva suave quedaría justo en el límite.
    const { left, right } = makePieces(45);
    const pieces = indexPieces([left, right]);

    const plain = createSeam(
      endpoint(left.id, edgeId('left', 'side')),
      endpoint(right.id, edgeId('right', 'side')),
    );

    const measured = seamLengths(plain, pieces);
    expect(measured).not.toBeNull();
    if (measured === null) return;

    expect(validateSeam(plain, pieces)).toHaveLength(1);

    const declared = createSeam(plain.a, plain.b, measured.difference);
    expect(validateSeam(declared, pieces)).toEqual([]);
  });

  it('una arista inexistente se reporta como tal', () => {
    const { left, right } = makePieces(0);
    const seam = createSeam(
      endpoint(left.id, edgeId('left', 'inventada')),
      endpoint(right.id, edgeId('right', 'side')),
    );

    expect(validateSeam(seam, indexPieces([left, right]))[0]?.kind).toBe('unknown-edge');
  });
});

describe('emparejamiento punto a punto', () => {
  /*
   * EL PASO QUE HACE POSIBLE COSER EN 3D (§7 de docs/ARCHITECTURE.md).
   *
   * Ambas aristas reciben el MISMO número de puntos, repartidos por longitud de
   * arco normalizada. Así el vértice i de una se empareja con el i de la otra
   * aunque midan distinto, y el embebido queda repartido de forma uniforme a lo
   * largo de toda la costura — que es lo que hace una costurera al montar una
   * manga.
   */
  it('produce el mismo número de puntos en ambas aristas', () => {
    const { left, right } = makePieces(20);
    const pieces = indexPieces([left, right]);

    const seam = createSeam(
      endpoint(left.id, edgeId('left', 'side')),
      endpoint(right.id, edgeId('right', 'side')),
    );

    const pairing = pairSeamPoints(seam, pieces, 16);
    expect(pairing?.a).toHaveLength(17);
    expect(pairing?.b).toHaveLength(17);
  });

  it('reparte el embebido de forma uniforme', () => {
    const { left, right } = makePieces(20);
    const pieces = indexPieces([left, right]);

    const seam = createSeam(
      endpoint(left.id, edgeId('left', 'side')),
      endpoint(right.id, edgeId('right', 'side')),
    );

    const pairing = pairSeamPoints(seam, pieces, 20);
    expect(pairing).not.toBeNull();
    if (pairing === null) return;

    // Cada tramo de la arista más larga debe superar al de la más corta en la
    // MISMA proporción a lo largo de toda la costura.
    const ratios: number[] = [];
    for (let i = 1; i < pairing.a.length; i++) {
      const a0 = pairing.a[i - 1];
      const a1 = pairing.a[i];
      const b0 = pairing.b[i - 1];
      const b1 = pairing.b[i];
      if (a0 === undefined || a1 === undefined || b0 === undefined || b1 === undefined) continue;

      ratios.push(distance(b0.point, b1.point) / distance(a0.point, a1.point));
    }

    const spread = Math.max(...ratios) / Math.min(...ratios);
    expect(spread).toBeLessThan(1.05);
  });

  /*
   * `reversed` no es un detalle de bookkeeping: sin él las dos piezas se cosen
   * retorcidas una sobre otra, porque el primer punto de una se emparejaría con
   * el primero de la otra en lugar de con el último.
   */
  it('reversed invierte el orden de emparejamiento', () => {
    const { left, right } = makePieces(0);
    const pieces = indexPieces([left, right]);

    const straight = pairSeamPoints(
      createSeam(
        endpoint(left.id, edgeId('left', 'side')),
        endpoint(right.id, edgeId('right', 'side')),
      ),
      pieces,
      8,
    );

    const flipped = pairSeamPoints(
      createSeam(
        endpoint(left.id, edgeId('left', 'side')),
        endpoint(right.id, edgeId('right', 'side'), true),
      ),
      pieces,
      8,
    );

    expect(straight?.b[0]?.point.y).toBeCloseTo(0, 6);
    expect(flipped?.b[0]?.point.y).toBeCloseTo(300, 6);
  });

  it('los puntos caen sobre sus aristas', () => {
    const { left, right } = makePieces(20);
    const pieces = indexPieces([left, right]);
    const seam = createSeam(
      endpoint(left.id, edgeId('left', 'side')),
      endpoint(right.id, edgeId('right', 'side')),
    );

    const pairing = pairSeamPoints(seam, pieces, 10);
    const edge = findEdge(right, edgeId('right', 'side'));
    expect(pairing).not.toBeNull();
    expect(edge).toBeDefined();
    if (pairing === null || edge === undefined) return;

    const total = edgeLength(right, edge);
    expect(total).toBeGreaterThan(300);

    for (const location of pairing.b) {
      expect(location.point.x).toBeGreaterThanOrEqual(99.9);
    }
  });
});

describe('grafo de costuras', () => {
  it('encuentra las costuras de una pieza', () => {
    const { left, right } = makePieces(0);
    const seam = createSeam(
      endpoint(left.id, edgeId('left', 'side')),
      endpoint(right.id, edgeId('right', 'side')),
    );

    expect(seamsOfPiece([seam], left.id)).toHaveLength(1);
    expect(isEdgeSewn([seam], left.id, edgeId('left', 'side'))).toBe(true);
    expect(isEdgeSewn([seam], left.id, edgeId('left', 'hem'))).toBe(false);
  });

  /*
   * No todas las aristas libres son un error: un bajo o una línea de doblez lo
   * son por diseño. Pero un hombro sin coser sí lo es, y esta lista es el punto
   * de partida para detectarlo — y, en la Fase 11, la frontera abierta de la
   * malla.
   */
  it('lista las aristas sin coser', () => {
    const { left, right } = makePieces(0);
    const seam = createSeam(
      endpoint(left.id, edgeId('left', 'side')),
      endpoint(right.id, edgeId('right', 'side')),
    );

    const open = openEdges([left, right], [seam]);
    expect(open).toHaveLength(6);
    expect(open.some((edge) => edge.role === 'shoulder')).toBe(true);
    expect(open.some((edge) => edge.role === 'side')).toBe(false);
  });
});

describe('validación del patrón completo', () => {
  it('acepta un patrón coherente', () => {
    const { left, right } = makePieces(0);
    const seam = createSeam(
      endpoint(left.id, edgeId('left', 'side')),
      endpoint(right.id, edgeId('right', 'side')),
    );

    const report = validatePattern([left, right], [seam]);
    expect(report.ok).toBe(true);
    expect(report.pieceIssues.size).toBe(0);
  });

  it('acumula los problemas de piezas y de costuras', () => {
    const { left, right } = makePieces(60);
    const seam = createSeam(
      endpoint(left.id, edgeId('left', 'side')),
      endpoint(right.id, edgeId('right', 'side')),
    );

    const report = validatePattern([left, right], [seam]);
    expect(report.ok).toBe(false);
    expect(report.seamIssues).toHaveLength(1);
  });
});
