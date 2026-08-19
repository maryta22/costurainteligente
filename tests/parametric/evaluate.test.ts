import { describe, expect, it } from 'vitest';

import { describeParametricIssue, evaluateParameters } from '@core/parametric/evaluate';
import {
  describeCycle,
  topologicalOrder,
  transitiveDependencies,
  transitiveDependents,
} from '@core/parametric/graph';
import type { ParameterDefinition } from '@core/parametric/types';

const inputs = (values: Record<string, number>): Map<string, number> =>
  new Map(Object.entries(values));

const define = (name: string, expression: string): ParameterDefinition => ({ name, expression });

describe('evaluación en orden topológico', () => {
  /*
   * El orden NO es el de declaración. Se deduce de las dependencias, así que un
   * parámetro puede escribirse antes que aquellos de los que depende sin que
   * nada falle: es lo que permite editar las fórmulas en cualquier orden.
   */
  it('resuelve cadenas de dependencias declaradas al revés', () => {
    const result = evaluateParameters(
      [
        define('quarter', 'finished / 4'),
        define('finished', 'bust + easeBust'),
        define('frontQuarter', 'quarter + 5'),
      ],
      inputs({ bust: 880, easeBust: 80 }),
    );

    expect(result.ok).toBe(true);
    expect(result.values.get('finished')).toBe(960);
    expect(result.values.get('quarter')).toBe(240);
    expect(result.values.get('frontQuarter')).toBe(245);

    expect(result.order.indexOf('finished')).toBeLessThan(result.order.indexOf('quarter'));
    expect(result.order.indexOf('quarter')).toBeLessThan(result.order.indexOf('frontQuarter'));
  });

  it('las entradas quedan disponibles en el resultado', () => {
    const result = evaluateParameters([define('a', 'bust * 2')], inputs({ bust: 100 }));
    expect(result.values.get('bust')).toBe(100);
    expect(result.values.get('a')).toBe(200);
  });

  /*
   * CRITERIO DE SALIDA DE LA FASE 4: cambiar una medida reevalúa el DAG y
   * actualiza todos los parámetros que dependen de ella, directa o
   * indirectamente.
   */
  it('cambiar una medida propaga a todos los derivados', () => {
    const definitions = [
      define('finished', 'bust + easeBust'),
      define('quarter', 'finished / 4'),
      define('front', 'quarter + 5'),
      define('unrelated', 'waist / 4'),
    ];

    const before = evaluateParameters(
      definitions,
      inputs({ bust: 880, easeBust: 80, waist: 700 }),
    );
    const after = evaluateParameters(
      definitions,
      inputs({ bust: 1000, easeBust: 80, waist: 700 }),
    );

    expect(before.values.get('front')).toBe(245);
    expect(after.values.get('front')).toBe(275);
    // Lo que no depende del pecho no se mueve.
    expect(after.values.get('unrelated')).toBe(before.values.get('unrelated'));
  });
});

describe('detección de ciclos', () => {
  /*
   * Es la ventaja concreta del grafo explícito sobre un solver de restricciones
   * bidireccional (decisión D2): se puede decir EXACTAMENTE qué depende de qué
   * y cerrar el círculo, en lugar de informar de que no ha convergido.
   */
  it('informa del camino exacto de un ciclo', () => {
    const result = evaluateParameters(
      [define('a', 'b + 1'), define('b', 'c + 1'), define('c', 'a + 1')],
      inputs({}),
    );

    expect(result.ok).toBe(false);

    const cycle = result.issues.find((issue) => issue.kind === 'cycle');
    expect(cycle).toBeDefined();
    if (cycle === undefined || cycle.kind !== 'cycle') return;

    // El camino se cierra: el primer nombre se repite al final.
    expect(cycle.path[0]).toBe(cycle.path.at(-1));
    expect(cycle.path).toHaveLength(4);
    expect(new Set(cycle.path)).toEqual(new Set(['a', 'b', 'c']));
    expect(describeCycle(cycle.path)).toContain('→');
  });

  it('detecta un ciclo de un solo paso', () => {
    const result = evaluateParameters([define('a', 'a + 1')], inputs({}));
    const cycle = result.issues.find((issue) => issue.kind === 'cycle');

    expect(cycle).toBeDefined();
    if (cycle?.kind !== 'cycle') return;
    expect(cycle.path).toEqual(['a', 'a']);
  });

  it('el mensaje del ciclo es legible', () => {
    const result = evaluateParameters(
      [define('waist', 'hip - 100'), define('hip', 'waist + 100')],
      inputs({}),
    );

    const cycle = result.issues.find((issue) => issue.kind === 'cycle');
    expect(cycle).toBeDefined();
    if (cycle === undefined) return;

    const message = describeParametricIssue(cycle);
    expect(message).toContain('circular');
    expect(message).toContain('→');
  });

  it('un grafo sin ciclos ordena correctamente', () => {
    const result = topologicalOrder({
      dependencies: new Map([
        ['c', new Set(['b'])],
        ['b', new Set(['a'])],
        ['a', new Set<string>()],
      ]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order).toEqual(['a', 'b', 'c']);
  });

  it('las dependencias hacia fuera del grafo no estorban', () => {
    const result = topologicalOrder({
      dependencies: new Map([['a', new Set(['bust', 'waist'])]]),
    });

    expect(result.ok).toBe(true);
  });
});

describe('recorrido del grafo', () => {
  const graph = {
    dependencies: new Map([
      ['finished', new Set(['bust', 'easeBust'])],
      ['quarter', new Set(['finished'])],
      ['front', new Set(['quarter'])],
      ['other', new Set(['waist'])],
    ]),
  };

  it('transitiveDependencies recorre hacia atrás', () => {
    expect(transitiveDependencies(graph, 'front')).toEqual(
      new Set(['quarter', 'finished', 'bust', 'easeBust']),
    );
  });

  /*
   * Lo que hay que recalcular al cambiar una medida. Hoy se reevalúa todo —son
   * microsegundos— pero en la Fase 5, con la geometría colgando del grafo, esto
   * permitirá regenerar sólo la parte afectada del patrón.
   */
  it('transitiveDependents recorre hacia delante', () => {
    expect(transitiveDependents(graph, 'bust')).toEqual(
      new Set(['finished', 'quarter', 'front']),
    );
    expect(transitiveDependents(graph, 'waist')).toEqual(new Set(['other']));
  });
});

describe('errores acumulados', () => {
  /*
   * Editar fórmulas es un proceso en el que el estado roto es normal. Abortar
   * al primer error dejaría el panel en blanco y obligaría a arreglarlos de uno
   * en uno; aquí se evalúa todo lo posible y se informa de todo lo que falla.
   */
  it('un parámetro roto no impide calcular los demás', () => {
    const result = evaluateParameters(
      [define('bueno', 'bust * 2'), define('malo', 'bust +'), define('otro', 'bust / 2')],
      inputs({ bust: 100 }),
    );

    expect(result.ok).toBe(false);
    expect(result.values.get('bueno')).toBe(200);
    expect(result.values.get('otro')).toBe(50);
    expect(result.values.has('malo')).toBe(false);
  });

  it('acumula varios problemas a la vez', () => {
    const result = evaluateParameters(
      [define('a', 'bust +'), define('b', 'inexistente * 2'), define('c', '1 / 0')],
      inputs({ bust: 100 }),
    );

    expect(result.issues).toHaveLength(3);
    expect(result.issues.map((issue) => issue.kind).sort()).toEqual([
      'evaluation',
      'syntax',
      'unknown-reference',
    ]);
  });

  it('el error de sintaxis conserva la fórmula y la posición', () => {
    const result = evaluateParameters([define('a', 'bust / 4 + )')], inputs({ bust: 100 }));
    const issue = result.issues[0];

    expect(issue?.kind).toBe('syntax');
    if (issue?.kind !== 'syntax') return;
    expect(issue.source).toBe('bust / 4 + )');
    expect(issue.issue.start).toBe(11);
  });

  it('una referencia a algo inexistente da el nombre concreto', () => {
    const result = evaluateParameters([define('a', 'bust + inventado')], inputs({ bust: 1 }));
    const issue = result.issues[0];

    expect(issue?.kind).toBe('unknown-reference');
    if (issue?.kind !== 'unknown-reference') return;
    expect(issue.reference).toBe('inventado');
  });

  it('rechaza nombres duplicados', () => {
    const result = evaluateParameters([define('a', '1'), define('a', '2')], inputs({}));
    expect(result.issues.some((issue) => issue.kind === 'duplicate')).toBe(true);
  });

  /*
   * Un parámetro no puede llamarse como una medida. `bust = bust + 60` parece
   * razonable y es un ciclo disfrazado — o peor, una sobrescritura silenciosa
   * de la medida real.
   */
  it('rechaza un parámetro que eclipsa una medida', () => {
    const result = evaluateParameters([define('bust', 'bust + 60')], inputs({ bust: 880 }));

    expect(result.issues.some((issue) => issue.kind === 'shadows-input')).toBe(true);
    expect(result.values.get('bust')).toBe(880);
  });
});
