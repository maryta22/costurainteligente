import { describe, expect, it } from 'vitest';

import { contourToPolyline } from '@core/geometry/contour';
import { polygonArea, polygonIsSimple } from '@core/geometry/polygon';
import { evaluateParameters } from '@core/parametric/evaluate';
import { segmentLength } from '@core/geometry/segment';

import { STANDARD_GRADE_TABLE, applyGrade } from '@domain/grading/gradeTable';
import {
  GRADERS,
  createMeasurementDrivenGrader,
  findGrader,
  measurementDrivenGrader,
  standardTableGrader,
} from '@domain/grading/graders';
import { easeProfile } from '@domain/measurements/ease';
import type { FitPreset } from '@domain/measurements/ease';
import { FIT_PRESETS } from '@domain/measurements/ease';
import { buildInputScope } from '@domain/measurements/scope';
import { SIZE_CODES, standardMeasurements } from '@domain/measurements/standard';
import type { SizeCode } from '@domain/measurements/standard';
import { MEASUREMENT_DEFINITIONS } from '@domain/measurements/types';
import { measurementsAreValid, validateMeasurements } from '@domain/measurements/validate';
import { BLOCK_PARAMETERS } from '@domain/pattern/blockParameters';
import { edgeLength } from '@domain/pattern/edge';
import type { GarmentId } from '@domain/pattern/generators';
import { AVAILABLE_GARMENTS, generateGarment } from '@domain/pattern/generators';
import { allowanceAddsMaterial } from '@domain/pattern/seamAllowance';
import { describePieceIssue, validatePattern, validatePiece } from '@domain/pattern/validate';

/** Genera una prenda a partir de unas medidas concretas. */
function generate(garment: GarmentId, measurements: ReturnType<typeof standardMeasurements>, fit: FitPreset = 'semi-fitted') {
  const evaluation = evaluateParameters(
    BLOCK_PARAMETERS,
    buildInputScope(measurements, easeProfile(fit)),
  );
  expect(evaluation.issues).toEqual([]);

  const result = generateGarment(garment, { values: evaluation.values, overrides: new Map() });
  expect(result).not.toBeNull();
  if (result === null) throw new Error('sin generador');

  return result;
}

describe('tabla de graduación', () => {
  /*
   * Un cuerpo no crece proporcionalmente al subir de talla: crece sobre todo en
   * VOLUMEN. Escalar el patrón entero por un factor —el error intuitivo—
   * produciría tallas grandes con hombros de gigante y talles imposibles.
   */
  it('los contornos crecen mucho más que los largos', () => {
    expect(STANDARD_GRADE_TABLE.bust).toBeGreaterThan(STANDARD_GRADE_TABLE.napeToWaist * 5);
    expect(STANDARD_GRADE_TABLE.hip).toBeGreaterThan(STANDARD_GRADE_TABLE.height * 4);
  });

  it('los anchos crecen poco: son estructura ósea', () => {
    expect(STANDARD_GRADE_TABLE.shoulderLength).toBeLessThan(STANDARD_GRADE_TABLE.bust / 10);
  });

  it('todas las medidas tienen incremento definido', () => {
    for (const definition of MEASUREMENT_DEFINITIONS) {
      expect(Number.isFinite(STANDARD_GRADE_TABLE[definition.key])).toBe(true);
    }
  });

  it('graduar cero pasos no cambia nada', () => {
    const base = standardMeasurements('M');
    expect(applyGrade(base, 0)).toEqual(base);
  });

  it('graduar y desgraduar devuelve el original', () => {
    const base = standardMeasurements('M');
    const roundTrip = applyGrade(applyGrade(base, 3), -3);

    for (const definition of MEASUREMENT_DEFINITIONS) {
      expect(roundTrip[definition.key]).toBeCloseTo(base[definition.key], 9);
    }
  });
});

describe('graduadores', () => {
  const sizes = SIZE_CODES;

  it('los dos graduadores cubren el rango completo', () => {
    for (const grader of GRADERS) {
      const graded = grader.grade({ base: standardMeasurements('M'), baseSize: 'M', sizes });

      expect(graded).toHaveLength(sizes.length);
      expect(graded.map((entry) => entry.size)).toEqual([...sizes]);
      expect(graded.filter((entry) => entry.isBase)).toHaveLength(1);
    }
  });

  /*
   * El graduador POR MEDIDAS parte de las que se le den. Es el correcto para
   * llevar el bloque de una persona concreta a las tallas vecinas.
   */
  it('el graduador por medidas conserva la base intacta', () => {
    const base = { ...standardMeasurements('M'), bust: 913, waist: 688 };
    const graded = measurementDrivenGrader.grade({ base, baseSize: 'M', sizes });

    const atBase = graded.find((entry) => entry.isBase);
    expect(atBase?.measurements).toEqual(base);
  });

  it('el graduador por medidas aplica los incrementos por paso', () => {
    const base = standardMeasurements('M');
    const graded = measurementDrivenGrader.grade({ base, baseSize: 'M', sizes });

    const large = graded.find((entry) => entry.size === 'L');
    expect(large?.steps).toBe(1);
    expect(large?.measurements.bust).toBeCloseTo(base.bust + STANDARD_GRADE_TABLE.bust, 9);

    const extraSmall = graded.find((entry) => entry.size === 'XS');
    expect(extraSmall?.steps).toBe(-2);
    expect(extraSmall?.measurements.bust).toBeCloseTo(base.bust - 2 * STANDARD_GRADE_TABLE.bust, 9);
  });

  /*
   * El graduador POR TABLA ignora las medidas introducidas: usa las
   * antropométricas de referencia, que NO son lineales. Es el correcto para un
   * patrón industrial destinado a una tabla de tallas.
   */
  it('el graduador por tabla ignora la base y usa las de referencia', () => {
    const base = { ...standardMeasurements('M'), bust: 1200 };
    const graded = standardTableGrader.grade({ base, baseSize: 'M', sizes });

    for (const entry of graded) {
      expect(entry.measurements).toEqual(standardMeasurements(entry.size));
    }
  });

  /*
   * Y la diferencia entre ambos es real, no cosmética: la tabla estándar tiene
   * saltos progresivos —45 mm no es 40 ni 50— y ninguna tabla de incrementos
   * constantes la reproduce.
   */
  it('los dos graduadores dan resultados distintos en los extremos', () => {
    const base = standardMeasurements('M');

    const byMeasure = measurementDrivenGrader.grade({ base, baseSize: 'M', sizes });
    const byTable = standardTableGrader.grade({ base, baseSize: 'M', sizes });

    const bustOf = (list: typeof byMeasure, size: SizeCode): number =>
      list.find((entry) => entry.size === size)?.measurements.bust ?? 0;

    expect(bustOf(byMeasure, 'XL')).not.toBeCloseTo(bustOf(byTable, 'XL'), 1);
    // Pero coinciden en la base, donde no hay graduación que aplicar.
    expect(bustOf(byMeasure, 'M')).toBeCloseTo(bustOf(byTable, 'M'), 9);
  });

  it('se puede sustituir la tabla de incrementos', () => {
    const doubled = createMeasurementDrivenGrader({
      ...STANDARD_GRADE_TABLE,
      bust: STANDARD_GRADE_TABLE.bust * 2,
    });

    const base = standardMeasurements('M');
    const graded = doubled.grade({ base, baseSize: 'M', sizes: ['L'] });

    expect(graded[0]?.measurements.bust).toBeCloseTo(base.bust + STANDARD_GRADE_TABLE.bust * 2, 9);
  });

  it('los graduadores se localizan por su identificador', () => {
    for (const grader of GRADERS) {
      expect(findGrader(grader.id)).toBe(grader);
    }
    expect(findGrader('inexistente')).toBeUndefined();
  });
});

describe('CRITERIO DE SALIDA — ninguna talla produce geometría degenerada', () => {
  /*
   * Las tallas extremas son donde aparecen los problemas: en XS el pinzado
   * puede comerse el costado, y en XL una curva puede llegar a cruzarse con la
   * de al lado. Cada talla se traza entera para otro cuerpo, así que nada
   * garantiza a priori que el resultado sea válido — hay que comprobarlo.
   */
  it('las tres prendas validan en las cinco tallas y los cuatro ajustes', () => {
    for (const garment of AVAILABLE_GARMENTS) {
      for (const size of SIZE_CODES) {
        for (const fit of Object.keys(FIT_PRESETS) as FitPreset[]) {
          const result = generate(garment, standardMeasurements(size), fit);

          for (const piece of result.pieces) {
            expect(
              validatePiece(piece).map(describePieceIssue),
              `${garment} · ${piece.id} · ${size} · ${fit}`,
            ).toEqual([]);
          }

          const report = validatePattern([...result.pieces], [...result.seams]);
          expect(report.seamIssues, `${garment} · ${size} · ${fit}`).toEqual([]);
        }
      }
    }
  });

  /** Ningún segmento del contorno puede ser tan corto que deje de tener dirección. */
  it('ningún segmento degenera en un punto', () => {
    for (const garment of AVAILABLE_GARMENTS) {
      for (const size of SIZE_CODES) {
        const result = generate(garment, standardMeasurements(size));

        for (const piece of result.pieces) {
          for (const segment of piece.contour.segments) {
            expect(
              segmentLength(segment),
              `${garment} · ${piece.id} · ${size}`,
            ).toBeGreaterThan(0.5);
          }
        }
      }
    }
  });

  it('ninguna arista queda por debajo de un milímetro', () => {
    for (const garment of AVAILABLE_GARMENTS) {
      for (const size of SIZE_CODES) {
        const result = generate(garment, standardMeasurements(size));

        for (const piece of result.pieces) {
          for (const edge of piece.edges) {
            expect(edgeLength(piece, edge), `${garment} · ${edge.id} · ${size}`).toBeGreaterThan(1);
          }
        }
      }
    }
  });

  it('ningún contorno se corta a sí mismo ni pierde área', () => {
    for (const garment of AVAILABLE_GARMENTS) {
      for (const size of SIZE_CODES) {
        const result = generate(garment, standardMeasurements(size));

        for (const piece of result.pieces) {
          const outline = contourToPolyline(piece.contour, 0.2);

          expect(polygonIsSimple(outline), `${garment} · ${piece.id} · ${size}`).toBe(true);
          expect(polygonArea(outline)).toBeGreaterThan(100);
          expect(allowanceAddsMaterial(piece)).toBe(true);
        }
      }
    }
  });

  it('ninguna coordenada deja de ser finita', () => {
    for (const garment of AVAILABLE_GARMENTS) {
      for (const size of SIZE_CODES) {
        const result = generate(garment, standardMeasurements(size));

        for (const point of result.draft.points()) {
          expect(Number.isFinite(point.position.x), `${garment} · ${point.name}`).toBe(true);
          expect(Number.isFinite(point.position.y), `${garment} · ${point.name}`).toBe(true);
        }
      }
    }
  });
});

describe('las tallas evolucionan de forma regular', () => {
  /*
   * Superponer las tallas es lo que hace visible una graduación irregular. La
   * versión medible de «que las líneas queden paralelas» es que las magnitudes
   * crezcan de forma monótona: si una talla mayor tuviera una sisa más corta,
   * las curvas se cruzarían en el nido.
   */
  it('todas las magnitudes crecen al subir de talla', () => {
    const measure = (size: SizeCode) => {
      const result = generate('dress', standardMeasurements(size));
      const byId = new Map(result.pieces.map((p) => [String(p.id), p]));

      const lengthOf = (id: string, name: string): number => {
        const piece = byId.get(id);
        const edge = piece?.edges.find((e) => e.id.endsWith(`.${name}`));
        return piece === undefined || edge === undefined ? 0 : edgeLength(piece, edge);
      };

      return {
        armhole: lengthOf('dressFrontBodice', 'armhole'),
        shoulder: lengthOf('dressFrontBodice', 'shoulder'),
        hem: lengthOf('dressFrontSkirt', 'hem'),
        cap: lengthOf('dressSleeve', 'capFront'),
      };
    };

    for (let i = 1; i < SIZE_CODES.length; i++) {
      const previous = SIZE_CODES[i - 1];
      const current = SIZE_CODES[i];
      if (previous === undefined || current === undefined) continue;

      const before = measure(previous);
      const after = measure(current);

      for (const key of ['armhole', 'shoulder', 'hem', 'cap'] as const) {
        expect(after[key], `${key}: ${previous} → ${current}`).toBeGreaterThan(before[key]);
      }
    }
  });

  it('el área de tela crece de forma monótona', () => {
    let previous = 0;

    for (const size of SIZE_CODES) {
      const result = generate('skirt', standardMeasurements(size));
      const area = result.pieces.reduce(
        (sum, piece) => sum + polygonArea(contourToPolyline(piece.contour, 0.5)),
        0,
      );

      expect(area).toBeGreaterThan(previous);
      previous = area;
    }
  });
});

describe('medidas graduadas de una persona concreta', () => {
  /*
   * El caso de uso real del graduador por medidas: alguien introduce las suyas
   * y quiere las tallas vecinas. El resultado debe seguir siendo un cuerpo
   * plausible y un patrón válido.
   */
  const custom = { ...standardMeasurements('M'), bust: 905, waist: 742, hip: 968 };

  it('las tallas graduadas siguen siendo cuerpos plausibles', () => {
    const graded = measurementDrivenGrader.grade({
      base: custom,
      baseSize: 'M',
      sizes: SIZE_CODES,
    });

    for (const entry of graded) {
      expect(
        validateMeasurements(entry.measurements).filter((issue) => issue.kind !== 'inconsistent'),
        `talla ${entry.size}`,
      ).toEqual([]);
    }
  });

  it('producen patrones válidos en todo el rango', () => {
    const graded = measurementDrivenGrader.grade({
      base: custom,
      baseSize: 'M',
      sizes: SIZE_CODES,
    });

    for (const entry of graded) {
      for (const garment of AVAILABLE_GARMENTS) {
        const result = generate(garment, entry.measurements);

        for (const piece of result.pieces) {
          expect(
            validatePiece(piece).map(describePieceIssue),
            `${garment} · ${piece.id} · ${entry.size}`,
          ).toEqual([]);
        }
      }
    }
  });

  it('unas medidas base incoherentes se detectan antes de graduar', () => {
    const broken = { ...custom, underbust: custom.bust + 100 };
    expect(measurementsAreValid(broken)).toBe(false);
  });
});
