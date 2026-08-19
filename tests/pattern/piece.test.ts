import { describe, expect, it } from 'vitest';

import { contour } from '@core/geometry/contour';
import { lineSeg } from '@core/geometry/line';
import { rotation, translation } from '@core/geometry/mat3';
import { distanceToPolygonBoundary, polygonArea } from '@core/geometry/polygon';
import { distance, vec2 } from '@core/geometry/vec2';

import {
  edgeLength,
  edgeLocationAtLength,
  effectiveSeamAllowance,
  findEdge,
  sampleEdgeByArcLength,
} from '@domain/pattern/edge';
import { bodiceFrontSample } from '@domain/pattern/demo';
import { edgeId, pieceId } from '@domain/pattern/ids';
import { createPiece, flattenBoundary, pieceLength, placePiece, seamAllowancePerSide } from '@domain/pattern/piece';
import { resolveNotch, resolveNotches } from '@domain/pattern/notch';
import { allowanceAddsMaterial, cutLine } from '@domain/pattern/seamAllowance';
import type { PatternEdge } from '@domain/pattern/types';
import { describePieceIssue, validatePiece } from '@domain/pattern/validate';

/** Cuadrado de 100 mm con un margen distinto en cada lado. */
function squarePiece() {
  const corners = [vec2(0, 0), vec2(100, 0), vec2(100, 100), vec2(0, 100)];
  const [a, b, c, d] = corners;
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    throw new Error('setup');
  }

  const edges: PatternEdge[] = [
    { id: edgeId('sq', 'hem'), role: 'hem', startSegment: 0, segmentCount: 1, seamAllowance: 40, onFold: false },
    { id: edgeId('sq', 'side'), role: 'side', startSegment: 1, segmentCount: 1, seamAllowance: 15, onFold: false },
    { id: edgeId('sq', 'neckline'), role: 'neckline', startSegment: 2, segmentCount: 1, seamAllowance: 6, onFold: false },
    { id: edgeId('sq', 'center-front'), role: 'center-front', startSegment: 3, segmentCount: 1, seamAllowance: 15, onFold: true },
  ];

  return createPiece({
    id: pieceId('sq'),
    name: 'Cuadrado',
    contour: contour([lineSeg(a, b), lineSeg(b, c), lineSeg(c, d), lineSeg(d, a)], true),
    edges,
  });
}

describe('aristas', () => {
  it('miden lo que su tramo del contorno', () => {
    const piece = squarePiece();
    for (const edge of piece.edges) expect(edgeLength(piece, edge)).toBeCloseTo(100, 9);
    expect(pieceLength(piece)).toBeCloseTo(400, 9);
  });

  /*
   * El contorno se recorre en sentido antihorario, así que la normal hacia
   * fuera apunta al exterior de la pieza. Es el convenio del que dependen los
   * márgenes y los piquetes: si se invirtiera, ambos saldrían hacia dentro.
   */
  it('la normal apunta hacia fuera de la pieza', () => {
    const piece = squarePiece();
    const hem = piece.edges[0];
    if (hem === undefined) return;

    const location = edgeLocationAtLength(piece, hem, 50);
    expect(location).not.toBeNull();
    // Lado inferior recorrido hacia +X: fuera es −Y.
    expect(location?.outward.x).toBeCloseTo(0, 9);
    expect(location?.outward.y).toBeCloseTo(-1, 9);
  });

  it('una arista al doblez no lleva margen aunque el campo diga otra cosa', () => {
    const piece = squarePiece();
    const fold = findEdge(piece, edgeId('sq', 'center-front'));
    expect(fold?.seamAllowance).toBe(15);
    expect(fold === undefined ? -1 : effectiveSeamAllowance(fold)).toBe(0);
  });
});

describe('muestreo por longitud de arco', () => {
  /*
   * Es el paso que hará posible coser en 3D: dos aristas de distinta longitud
   * se muestrean con el mismo número de puntos, repartidos uniformemente en
   * longitud, para poder emparejarlas una a una.
   */
  it('produce tramos iguales', () => {
    const piece = bodiceFrontSample();
    const armhole = findEdge(piece, edgeId('front', 'armhole'));
    if (armhole === undefined) return;

    const samples = sampleEdgeByArcLength(piece, armhole, 12);
    expect(samples).toHaveLength(13);

    const steps: number[] = [];
    for (let i = 1; i < samples.length; i++) {
      const previous = samples[i - 1];
      const current = samples[i];
      if (previous === undefined || current === undefined) continue;
      steps.push(distance(previous.point, current.point));
    }

    expect(Math.max(...steps) / Math.min(...steps)).toBeLessThan(1.03);
  });

  it('empieza y acaba en los extremos de la arista', () => {
    const piece = squarePiece();
    const side = piece.edges[1];
    if (side === undefined) return;

    const samples = sampleEdgeByArcLength(piece, side, 4);
    expect(samples[0]?.point.x).toBeCloseTo(100, 9);
    expect(samples[0]?.point.y).toBeCloseTo(0, 9);
    expect(samples.at(-1)?.point.y).toBeCloseTo(100, 9);
  });
});

describe('margen de costura variable', () => {
  it('cada arista aporta su anchura al polígono aplanado', () => {
    const piece = squarePiece();
    const boundary = flattenBoundary(piece);
    const widths = seamAllowancePerSide(piece, boundary);

    // El lado al doblez queda a cero.
    expect(widths).toContain(40);
    expect(widths).toContain(15);
    expect(widths).toContain(6);
    expect(widths).toContain(0);
  });

  it('la línea de corte encierra a la de costura', () => {
    const piece = squarePiece();
    const { polygon, seamLine } = cutLine(piece);

    expect(polygonArea(polygon)).toBeGreaterThan(polygonArea(seamLine));
    expect(allowanceAddsMaterial(piece)).toBe(true);
  });

  it('funciona sobre una pieza real con curvas', () => {
    const piece = bodiceFrontSample();
    const { polygon, seamLine } = cutLine(piece);

    expect(polygon.length).toBeGreaterThan(10);
    expect(polygonArea(polygon)).toBeGreaterThan(polygonArea(seamLine));
    expect(allowanceAddsMaterial(piece)).toBe(true);
  });

  /*
   * CRITERIO DE SALIDA DE LA FASE 3.
   *
   * En el centro de cada arista, la distancia de la línea de costura a la de
   * corte debe ser EXACTAMENTE el margen de esa arista. Sobre la pieza de
   * muestra eso significa comprobar seis anchuras distintas a la vez, de 0 mm
   * en el doblez a 40 en el bajo, sobre rectas y sobre curvas.
   *
   * Se mide en el punto medio y no cerca de las esquinas a propósito: allí el
   * punto más próximo del contorno de corte puede pertenecer al margen de la
   * arista vecina, y se estaría midiendo la esquina en lugar del margen.
   */
  it('cada arista queda a su propia distancia de la línea de corte', () => {
    const piece = bodiceFrontSample();
    const cut = cutLine(piece, { tolerance: 0.01 });

    const expected: Record<string, number> = {
      hem: 40,
      side: 15,
      armhole: 10,
      shoulder: 10,
      neckline: 6,
      'center-front': 0,
    };

    for (const edge of piece.edges) {
      const middle = edgeLocationAtLength(piece, edge, edgeLength(piece, edge) / 2);
      expect(middle).not.toBeNull();
      if (middle === null) continue;

      const measured = distanceToPolygonBoundary(cut.polygon, middle.point);
      const target = expected[edge.role];
      expect(target).toBeDefined();

      // 0.2 mm de holgura: la línea de corte es una polilínea, y su desviación
      // respecto a la curva desplazada real está acotada por el aplanado.
      expect(Math.abs(measured - (target ?? 0))).toBeLessThan(0.2);
    }
  });

  it('la arista al doblez deja la línea de corte sobre la de costura', () => {
    const piece = bodiceFrontSample();
    const cut = cutLine(piece);
    const fold = findEdge(piece, edgeId('front', 'center-front'));
    if (fold === undefined) return;

    for (const sample of sampleEdgeByArcLength(piece, fold, 8)) {
      expect(distanceToPolygonBoundary(cut.polygon, sample.point)).toBeLessThan(0.2);
    }
  });

  /*
   * La línea de corte es geometría DERIVADA. Cambiar un margen no toca el
   * patrón: se vuelve a calcular. Esta es la comprobación de que la fuente es
   * la línea de costura y no al revés.
   */
  it('cambiar un margen cambia la línea de corte y no la de costura', () => {
    const piece = squarePiece();
    const before = cutLine(piece);

    const widened = {
      ...piece,
      edges: piece.edges.map((edge) =>
        edge.role === 'hem' ? { ...edge, seamAllowance: 80 } : edge,
      ),
    };
    const after = cutLine(widened);

    expect(polygonArea(after.polygon)).toBeGreaterThan(polygonArea(before.polygon));
    expect(polygonArea(after.seamLine)).toBeCloseTo(polygonArea(before.seamLine), 6);
  });
});

describe('piquetes', () => {
  /*
   * EL PIQUETE SE DEFINE EN LA COSTURA Y SE CORTA EN EL BORDE.
   *
   * La proyección debe recorrer exactamente el margen de su arista, ni más ni
   * menos. Si se guardara ya proyectado, cambiar el margen lo dejaría
   * descolocado respecto a la costura y dos piezas dejarían de casar.
   */
  it('se proyectan a la línea de corte recorriendo el margen de su arista', () => {
    const piece = squarePiece();

    for (const notchEdge of piece.edges) {
      const notch = {
        id: `${notchEdge.id}#t` as never,
        edge: notchEdge.id,
        arcLength: 50,
        type: 'single' as const,
        depth: 5,
      };

      const resolved = resolveNotch(piece, notch);
      expect(resolved).not.toBeNull();
      if (resolved === null) continue;

      const travelled = distance(resolved.seamPoint, resolved.cutPoint);
      expect(travelled).toBeCloseTo(effectiveSeamAllowance(notchEdge), 6);
    }
  });

  it('el punto de corte queda fuera de la línea de costura', () => {
    const piece = bodiceFrontSample();

    for (const resolved of resolveNotches(piece)) {
      const outward = distance(resolved.seamPoint, resolved.cutPoint);
      expect(outward).toBeGreaterThan(0);
      expect(Number.isFinite(resolved.cutPoint.x)).toBe(true);
    }
  });

  it('la marca no penetra más allá del margen disponible', () => {
    const piece = bodiceFrontSample();

    for (const resolved of resolveNotches(piece)) {
      const depth = distance(resolved.cutPoint, resolved.markStart);
      expect(depth).toBeLessThanOrEqual(distance(resolved.seamPoint, resolved.cutPoint) + 1e-9);
    }
  });

  /*
   * La razón de guardar el piquete como (arista, longitud) y no como
   * coordenada: al cambiar el margen, la POSICIÓN EN LA COSTURA no se mueve —
   * sigue casando con la pieza vecina— y sólo se recoloca el punto de corte.
   */
  it('sobrevive a un cambio de margen sin moverse de la costura', () => {
    const piece = bodiceFrontSample();
    const original = resolveNotches(piece);

    const widened = {
      ...piece,
      edges: piece.edges.map((edge) => ({ ...edge, seamAllowance: edge.seamAllowance + 10 })),
    };
    const after = resolveNotches(widened);

    expect(after).toHaveLength(original.length);
    for (let i = 0; i < original.length; i++) {
      const before = original[i];
      const now = after[i];
      if (before === undefined || now === undefined) continue;

      expect(distance(before.seamPoint, now.seamPoint)).toBeLessThan(1e-9);
      expect(distance(before.cutPoint, now.cutPoint)).toBeGreaterThan(1);
    }
  });
});

describe('colocación', () => {
  /*
   * Mover una pieza no toca su geometría, sólo la matriz que la sitúa. Así,
   * regenerar el patrón tras cambiar una medida conserva la disposición que el
   * usuario había preparado para el corte.
   */
  it('no altera la geometría local', () => {
    const piece = squarePiece();
    const moved = placePiece(piece, translation(500, -200));

    expect(moved.contour).toBe(piece.contour);
    expect(pieceLength(moved)).toBeCloseTo(pieceLength(piece), 9);
  });

  it('se compone con transformaciones sucesivas', () => {
    const piece = squarePiece();
    const moved = placePiece(placePiece(piece, translation(100, 0)), rotation(Math.PI / 2));

    expect(moved.placement).not.toBe(piece.placement);
    expect(pieceLength(moved)).toBeCloseTo(400, 9);
  });
});

describe('validación', () => {
  it('la pieza de muestra es válida', () => {
    const issues = validatePiece(bodiceFrontSample());
    expect(issues.map(describePieceIssue)).toEqual([]);
  });

  it('el cuadrado de test es válido', () => {
    expect(validatePiece(squarePiece())).toEqual([]);
  });

  it('detecta un contorno recorrido al revés', () => {
    const piece = squarePiece();
    const reversed = {
      ...piece,
      contour: contour([...piece.contour.segments].reverse().map((s) => s), true),
    };

    const issues = validatePiece(reversed);
    expect(issues.some((issue) => issue.kind !== 'contour')).toBe(true);
  });

  it('detecta un segmento sin arista asignada', () => {
    const piece = squarePiece();
    const truncated = { ...piece, edges: piece.edges.slice(0, 3) };

    const issues = validatePiece(truncated);
    expect(issues.some((issue) => issue.kind === 'edges-not-a-partition')).toBe(true);
  });

  it('detecta un segmento reclamado por dos aristas', () => {
    const piece = squarePiece();
    const first = piece.edges[0];
    if (first === undefined) return;

    const overlapping = {
      ...piece,
      edges: [...piece.edges, { ...first, id: edgeId('sq', 'duplicada') }],
    };

    const issues = validatePiece(overlapping);
    expect(
      issues.some((issue) => issue.kind === 'edges-not-a-partition' && issue.coverage === 2),
    ).toBe(true);
  });

  it('detecta un piquete fuera de su arista', () => {
    const piece = squarePiece();
    const hem = piece.edges[0];
    if (hem === undefined) return;

    const broken = {
      ...piece,
      notches: [
        { id: 'x' as never, edge: hem.id, arcLength: 500, type: 'single' as const, depth: 5 },
      ],
    };

    expect(validatePiece(broken).some((issue) => issue.kind === 'notch-out-of-range')).toBe(true);
  });

  it('detecta un margen negativo', () => {
    const piece = squarePiece();
    const broken = {
      ...piece,
      edges: piece.edges.map((edge, i) => (i === 0 ? { ...edge, seamAllowance: -5 } : edge)),
    };

    expect(validatePiece(broken).some((issue) => issue.kind === 'negative-allowance')).toBe(true);
  });

  it('los mensajes son legibles', () => {
    expect(describePieceIssue({ kind: 'not-simple' })).toContain('corta a sí mismo');
  });
});
