/**
 * Orden topológico y detección de ciclos.
 *
 * Es la maquinaria que hace viable la decisión D2 de docs/ARCHITECTURE.md:
 * describir el patrón como un GRAFO EXPLÍCITO de dependencias en lugar de como
 * un sistema de restricciones resuelto numéricamente.
 *
 * La diferencia práctica es enorme. Un orden topológico es O(n), determinista,
 * y cuando falla puede decir exactamente POR QUÉ —«a depende de b, que depende
 * de a»—. Un solver de restricciones bidireccional, ante el mismo problema,
 * sólo puede informar de que no ha convergido.
 */

export interface DependencyGraph {
  /** Nombre → nombres de los que depende. */
  readonly dependencies: ReadonlyMap<string, ReadonlySet<string>>;
}

export type TopologicalResult =
  | { readonly ok: true; readonly order: readonly string[] }
  | { readonly ok: false; readonly cycle: readonly string[] };

/**
 * Ordena los nodos de forma que cada uno aparezca después de sus dependencias.
 *
 * Se usa recorrido en profundidad con marcas de tres estados en lugar del
 * algoritmo de Kahn, por un motivo concreto: al encontrar un ciclo, la pila de
 * recursión CONTIENE el camino que lo forma y se puede devolver tal cual. Kahn
 * detecta que sobran nodos pero no dice cuáles lo cierran, que es justo la
 * información que necesita quien tiene que arreglarlo.
 *
 * Las dependencias hacia nombres que no son nodos del grafo —las medidas de
 * entrada, por ejemplo— se ignoran aquí: no participan en el orden porque ya
 * tienen valor antes de empezar.
 */
export function topologicalOrder(graph: DependencyGraph): TopologicalResult {
  type Mark = 'pending' | 'visiting' | 'done';

  const marks = new Map<string, Mark>();
  const order: string[] = [];
  const stack: string[] = [];

  for (const name of graph.dependencies.keys()) marks.set(name, 'pending');

  const visit = (name: string): readonly string[] | null => {
    const mark = marks.get(name);

    if (mark === 'done') return null;

    if (mark === 'visiting') {
      // El ciclo son los nombres desde la primera aparición hasta el final,
      // más el propio nombre para cerrarlo visualmente: a → b → c → a
      const from = stack.indexOf(name);
      return [...stack.slice(from), name];
    }

    marks.set(name, 'visiting');
    stack.push(name);

    for (const dependency of graph.dependencies.get(name) ?? []) {
      // Sólo se recorren las dependencias que son nodos del grafo.
      if (!marks.has(dependency)) continue;

      const cycle = visit(dependency);
      if (cycle !== null) return cycle;
    }

    stack.pop();
    marks.set(name, 'done');
    order.push(name);
    return null;
  };

  for (const name of graph.dependencies.keys()) {
    const cycle = visit(name);
    if (cycle !== null) return { ok: false, cycle };
  }

  return { ok: true, order };
}

/** Nombres de los que depende `name`, directa o indirectamente. */
export function transitiveDependencies(
  graph: DependencyGraph,
  name: string,
): Set<string> {
  const result = new Set<string>();
  const pending = [...(graph.dependencies.get(name) ?? [])];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || result.has(current)) continue;

    result.add(current);
    for (const next of graph.dependencies.get(current) ?? []) {
      if (!result.has(next)) pending.push(next);
    }
  }

  return result;
}

/**
 * Nombres que dependen de `name`, directa o indirectamente.
 *
 * Es lo que hay que recalcular al cambiar una medida. En la Fase 5 permitirá
 * regenerar sólo la parte afectada del patrón en lugar de todo.
 */
export function transitiveDependents(graph: DependencyGraph, name: string): Set<string> {
  const reverse = new Map<string, Set<string>>();

  for (const [node, dependencies] of graph.dependencies) {
    for (const dependency of dependencies) {
      const bucket = reverse.get(dependency) ?? new Set<string>();
      bucket.add(node);
      reverse.set(dependency, bucket);
    }
  }

  const result = new Set<string>();
  const pending = [...(reverse.get(name) ?? [])];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || result.has(current)) continue;

    result.add(current);
    for (const next of reverse.get(current) ?? []) {
      if (!result.has(next)) pending.push(next);
    }
  }

  return result;
}

/** Descripción legible de un ciclo, para el mensaje de error. */
export const describeCycle = (cycle: readonly string[]): string => cycle.join(' → ');
