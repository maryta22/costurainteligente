import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { collectCalls, collectIdentifiers } from '@core/expression/ast';
import { evaluate } from '@core/expression/evaluate';
import { formatExpressionIssue, parseExpression } from '@core/expression/parser';
import { tokenize } from '@core/expression/lexer';
import { MM_PER_INCH } from '@core/units';

/** Evalúa una expresión sobre un ámbito, devolviendo el número o lanzando. */
function value(source: string, scope: Record<string, number> = {}): number {
  const parsed = parseExpression(source);
  if (!parsed.ok) throw new Error(`no analiza: ${parsed.issue.message}`);

  const result = evaluate(parsed.ast, new Map(Object.entries(scope)));
  if (!result.ok) throw new Error(`no evalúa: ${result.issue.message}`);

  return result.value;
}

function failure(source: string, scope: Record<string, number> = {}) {
  const parsed = parseExpression(source);
  if (!parsed.ok) return parsed.issue;

  const result = evaluate(parsed.ast, new Map(Object.entries(scope)));
  if (result.ok) throw new Error('se esperaba un fallo');

  return result.issue;
}

describe('aritmética', () => {
  it('resuelve las operaciones básicas', () => {
    expect(value('2 + 3')).toBe(5);
    expect(value('10 - 4')).toBe(6);
    expect(value('6 * 7')).toBe(42);
    expect(value('9 / 2')).toBe(4.5);
    expect(value('7 % 3')).toBe(1);
    expect(value('2 ^ 10')).toBe(1024);
  });

  it('respeta la precedencia', () => {
    expect(value('2 + 3 * 4')).toBe(14);
    expect(value('(2 + 3) * 4')).toBe(20);
    expect(value('2 * 3 ^ 2')).toBe(18);
    expect(value('-2 ^ 2')).toBe(-4);
  });

  /*
   * La potenciación asocia por la DERECHA, como en matemáticas: 2^3^2 es
   * 2^(3^2) = 512, no (2^3)^2 = 64.
   */
  it('la potencia asocia por la derecha', () => {
    expect(value('2 ^ 3 ^ 2')).toBe(512);
  });

  it('la resta asocia por la izquierda', () => {
    expect(value('10 - 3 - 2')).toBe(5);
  });

  it('admite unarios encadenados', () => {
    expect(value('--5')).toBe(5);
    expect(value('-+-5')).toBe(5);
  });

  it('ignora los espacios', () => {
    expect(value('  2   +\t3  ')).toBe(5);
  });
});

describe('unidades', () => {
  /*
   * El modelo trabaja en milímetros, pero las reglas de patronaje están
   * escritas en las unidades del taller. Poder escribir `1.5cm` evita el error
   * de factor 10 que produce traducirlas a mano.
   */
  it('convierte los sufijos a milímetros', () => {
    expect(value('10mm')).toBe(10);
    expect(value('2cm')).toBe(20);
    expect(value('1.5cm')).toBe(15);
    expect(value('1m')).toBe(1000);
    expect(value('1in')).toBeCloseTo(MM_PER_INCH, 9);
  });

  it('las unidades se combinan con el resto de la expresión', () => {
    expect(value('bust / 4 + 1cm', { bust: 880 })).toBe(230);
  });

  it('una unidad desconocida se señala con su posición', () => {
    const issue = failure('5 + 3leguas');
    expect(issue.message).toContain('Unidad desconocida');
    expect(issue.start).toBe(5);
  });

  it('el exponente admite signo y la potencia asocia bien con el unario', () => {
    expect(value('2 ^ -2')).toBe(0.25);
    expect(value('-(2 ^ 2)')).toBe(-4);
  });
});

describe('identificadores y funciones', () => {
  it('lee valores del ámbito', () => {
    expect(value('bust + easeBust', { bust: 880, easeBust: 80 })).toBe(960);
  });

  it('conoce las constantes', () => {
    expect(value('PI')).toBeCloseTo(Math.PI, 12);
    expect(value('TAU')).toBeCloseTo(Math.PI * 2, 12);
  });

  it('aplica funciones', () => {
    expect(value('min(3, 7, 2)')).toBe(2);
    expect(value('max(3, 7, 2)')).toBe(7);
    expect(value('clamp(15, 20, 40)')).toBe(20);
    expect(value('abs(-8)')).toBe(8);
    expect(value('round(2.6)')).toBe(3);
    expect(value('hypot(3, 4)')).toBe(5);
  });

  /*
   * La trigonometría trabaja EN GRADOS. Los ángulos de un patrón se escriben
   * así —una caída de hombro de 22°— y envolver cada uno en una conversión
   * multiplica las ocasiones de equivocarse.
   */
  it('la trigonometría usa grados', () => {
    expect(value('sin(90)')).toBeCloseTo(1, 12);
    expect(value('cos(0)')).toBe(1);
    expect(value('atan2(1, 1)')).toBeCloseTo(45, 9);
    expect(value('acos(0)')).toBeCloseTo(90, 9);
  });

  it('rechaza una función con el número de argumentos equivocado', () => {
    expect(failure('clamp(1, 2)').message).toContain('espera 3 argumentos');
  });

  it('rechaza una función inexistente', () => {
    expect(failure('inventada(2)').message).toContain('Función desconocida');
  });

  it('un identificador ausente se señala con su nombre', () => {
    expect(failure('bust + foo', { bust: 10 }).message).toContain('«foo»');
  });
});

describe('dependencias extraídas del árbol', () => {
  /*
   * ES LA RAZÓN DE ESCRIBIR EL PARSER.
   *
   * Recorrer el árbol da la lista de parámetros de los que depende cada
   * fórmula, sin que nadie tenga que declararlas. Con esa lista se construye el
   * grafo, se ordena topológicamente y se detectan los ciclos.
   */
  it('recoge los identificadores y no los nombres de función', () => {
    const parsed = parseExpression('max(bust / 4, waist / 4) + easeBust');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect([...collectIdentifiers(parsed.ast)].sort()).toEqual(['bust', 'easeBust', 'waist']);
    expect([...collectCalls(parsed.ast)]).toEqual(['max']);
  });

  it('no repite un identificador usado varias veces', () => {
    const parsed = parseExpression('bust + bust * bust');
    if (!parsed.ok) return;
    expect(collectIdentifiers(parsed.ast).size).toBe(1);
  });

  it('atraviesa paréntesis y unarios', () => {
    const parsed = parseExpression('-(a + (b * -c))');
    if (!parsed.ok) return;
    expect([...collectIdentifiers(parsed.ast)].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('errores con posición', () => {
  it('señala un paréntesis sin cerrar', () => {
    const issue = failure('(2 + 3');
    expect(issue.message).toContain('paréntesis');
  });

  it('señala texto sobrante', () => {
    const issue = failure('2 + 3 4');
    expect(issue.message).toContain('Sobra');
    expect(issue.start).toBe(6);
  });

  it('rechaza una expresión vacía', () => {
    expect(failure('   ').message).toContain('vacía');
  });

  it('rechaza un operador sin operando', () => {
    expect(failure('2 +').message).toContain('termina antes de tiempo');
  });

  /*
   * El formato con cursor es lo que convierte «la fórmula falla» en saber
   * dónde mirar sin releerla entera.
   */
  it('el mensaje formateado sitúa el cursor bajo el fallo', () => {
    const source = 'bust / 4 + fooo';
    const issue = failure(source, { bust: 880 });
    const text = formatExpressionIssue(source, issue);
    const [, caret] = text.split('\n');

    expect(caret).toBeDefined();
    expect(caret?.indexOf('^')).toBe(source.indexOf('fooo'));
    expect(caret?.replace(/ /g, '')).toBe('^'.repeat(4));
  });
});

describe('valores no finitos', () => {
  /*
   * La división por cero se trata como ERROR y no como infinito. Propagarlo
   * daría una pieza con coordenadas no finitas cuyo origen sería imposible de
   * rastrear tres fases después.
   */
  it('la división por cero es un error, no un infinito', () => {
    const issue = failure('10 / 0');
    expect(issue.message).toContain('División por cero');
  });

  it('un NaN intermedio se detiene donde se produce', () => {
    expect(failure('sqrt(-1)').message).toContain('no es un número');
  });

  it('un desbordamiento se detiene', () => {
    expect(failure('10 ^ 400').message).toContain('infinito');
  });
});

describe('seguridad', () => {
  /*
   * Una expresión sólo puede hacer aritmética. No hay forma de alcanzar el
   * ámbito de JavaScript desde el texto de una fórmula, que es lo que hace
   * seguro abrir el documento de un tercero — algo que `eval` no puede ofrecer
   * a ningún precio.
   */
  it('no alcanza el ámbito de JavaScript', () => {
    expect(failure('Math').message).toContain('desconocido');
    expect(failure('globalThis').message).toContain('desconocido');
    expect(failure('constructor').message).toContain('desconocido');
    expect(() => parseExpression('a.b')).not.toThrow();
  });

  it('los caracteres no válidos se rechazan en el análisis léxico', () => {
    const result = tokenize('2 + $x');
    expect(result.ok).toBe(false);
  });
});

describe('propiedades', () => {
  it('la suma es conmutativa', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        fc.double({ min: -1e4, max: 1e4, noNaN: true }),
        (a, b) => {
          expect(value('a + b', { a, b })).toBeCloseTo(value('b + a', { a, b }), 9);
        },
      ),
    );
  });

  it('todo número literal se recupera intacto', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e6, noNaN: true }), (n) => {
        expect(value(String(n))).toBeCloseTo(n, 9);
      }),
    );
  });
});
