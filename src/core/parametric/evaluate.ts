import type { Expr } from '../expression/ast';
import { collectIdentifiers } from '../expression/ast';
import { evaluate } from '../expression/evaluate';
import { CONSTANTS, isKnownFunction } from '../expression/functions';
import { parseExpression } from '../expression/parser';

import type { DependencyGraph } from './graph';
import { topologicalOrder } from './graph';
import type { ParameterDefinition, ParameterEvaluation, ParametricIssue } from './types';

/**
 * Evalúa un conjunto de parámetros sobre unas entradas.
 *
 * ── El flujo completo, en cuatro pasos ─────────────────────────────────────
 *
 *   1. ANALIZAR cada fórmula → árbol sintáctico.
 *   2. EXTRAER las dependencias recorriendo cada árbol. Nadie las declara.
 *   3. ORDENAR topológicamente. Si hay ciclo, se informa del camino exacto.
 *   4. EVALUAR en ese orden, con el ámbito creciendo a cada paso.
 *
 * ── Por qué se acumulan los problemas en vez de abortar ────────────────────
 *
 * Editar fórmulas es un proceso en el que el estado roto es normal: mientras se
 * teclea, la mitad de las expresiones no compilan. Abortar al primer error
 * dejaría el panel en blanco y obligaría a arreglar los fallos de uno en uno.
 * Aquí se evalúa todo lo que se pueda y se devuelven todos los problemas
 * juntos, cada uno señalando su posición en su fórmula.
 */
export function evaluateParameters(
  definitions: readonly ParameterDefinition[],
  inputs: ReadonlyMap<string, number>,
): ParameterEvaluation {
  const issues: ParametricIssue[] = [];
  const values = new Map<string, number>(inputs);

  const parsed = parseAll(definitions, inputs, issues);
  const graph = buildGraph(parsed);

  const sorted = topologicalOrder(graph);
  if (!sorted.ok) {
    issues.push({ kind: 'cycle', path: sorted.cycle });
    return { values, order: [], issues, ok: false };
  }

  const order: string[] = [];

  for (const name of sorted.order) {
    const entry = parsed.get(name);
    if (entry === undefined) continue;

    /*
     * Una referencia a algo que no existe se detecta ANTES de evaluar y con el
     * nombre concreto. El evaluador también lo detectaría, pero diría
     * «identificador desconocido» sin distinguir una errata de una dependencia
     * que aún no se ha definido.
     */
    const missing = findUnknownReference(entry.ast, values, parsed);
    if (missing !== null) {
      issues.push({
        kind: 'unknown-reference',
        parameter: name,
        reference: missing.name,
        issue: { message: `«${missing.name}» no está definido`, start: missing.start, end: missing.end },
        source: entry.definition.expression,
      });
      continue;
    }

    const result = evaluate(entry.ast, values);
    if (!result.ok) {
      issues.push({
        kind: 'evaluation',
        parameter: name,
        issue: result.issue,
        source: entry.definition.expression,
      });
      continue;
    }

    values.set(name, result.value);
    order.push(name);
  }

  return { values, order, issues, ok: issues.length === 0 };
}

interface ParsedParameter {
  readonly definition: ParameterDefinition;
  readonly ast: Expr;
  readonly dependencies: ReadonlySet<string>;
}

function parseAll(
  definitions: readonly ParameterDefinition[],
  inputs: ReadonlyMap<string, number>,
  issues: ParametricIssue[],
): Map<string, ParsedParameter> {
  const parsed = new Map<string, ParsedParameter>();

  for (const definition of definitions) {
    if (parsed.has(definition.name)) {
      issues.push({ kind: 'duplicate', parameter: definition.name });
      continue;
    }

    /*
     * Un parámetro derivado no puede llamarse como una medida de entrada. Si se
     * permitiera, la fórmula `bust = bust + 60` parecería razonable y sería un
     * ciclo disfrazado, o peor: una sobrescritura silenciosa de la medida real.
     */
    if (inputs.has(definition.name)) {
      issues.push({ kind: 'shadows-input', parameter: definition.name });
      continue;
    }

    const result = parseExpression(definition.expression);
    if (!result.ok) {
      issues.push({
        kind: 'syntax',
        parameter: definition.name,
        issue: result.issue,
        source: definition.expression,
      });
      continue;
    }

    parsed.set(definition.name, {
      definition,
      ast: result.ast,
      dependencies: collectIdentifiers(result.ast),
    });
  }

  return parsed;
}

function buildGraph(parsed: ReadonlyMap<string, ParsedParameter>): DependencyGraph {
  const dependencies = new Map<string, ReadonlySet<string>>();
  for (const [name, entry] of parsed) dependencies.set(name, entry.dependencies);
  return { dependencies };
}

interface MissingReference {
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

function findUnknownReference(
  ast: Expr,
  values: ReadonlyMap<string, number>,
  parsed: ReadonlyMap<string, ParsedParameter>,
): MissingReference | null {
  let missing: MissingReference | null = null;

  const visit = (node: Expr): void => {
    if (missing !== null) return;

    if (node.kind === 'identifier') {
      const known = values.has(node.name) || parsed.has(node.name) || CONSTANTS.has(node.name);

      if (!known) missing = { name: node.name, start: node.start, end: node.end };
      return;
    }

    if (node.kind === 'call') {
      if (!isKnownFunction(node.name)) {
        missing = { name: node.name, start: node.start, end: node.end };
        return;
      }
      for (const arg of node.args) visit(arg);
      return;
    }

    if (node.kind === 'unary') visit(node.operand);
    if (node.kind === 'binary') {
      visit(node.left);
      visit(node.right);
    }
  };

  visit(ast);
  return missing;
}

/** Descripción legible de un problema, para la interfaz y los tests. */
export function describeParametricIssue(issue: ParametricIssue): string {
  switch (issue.kind) {
    case 'syntax':
      return `${issue.parameter}: ${issue.issue.message}`;
    case 'evaluation':
      return `${issue.parameter}: ${issue.issue.message}`;
    case 'unknown-reference':
      return `${issue.parameter}: «${issue.reference}» no está definido`;
    case 'cycle':
      return `Dependencia circular: ${issue.path.join(' → ')}`;
    case 'duplicate':
      return `El parámetro «${issue.parameter}» está definido dos veces`;
    case 'shadows-input':
      return `El parámetro «${issue.parameter}» tiene el nombre de una medida de entrada`;
  }
}
