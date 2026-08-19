import type { Expr } from './ast';
import { CONSTANTS, FUNCTIONS } from './functions';
import type { ExpressionIssue } from './parser';

export type Scope = ReadonlyMap<string, number>;

export type EvaluationOutcome =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly issue: ExpressionIssue };

/**
 * Evalúa un árbol ya analizado sobre un ámbito de valores.
 *
 * Los errores se DEVUELVEN, no se lanzan. Una expresión mal escrita es un
 * estado normal de la interfaz mientras el usuario teclea, no una excepción:
 * el panel debe poder mostrar el problema y seguir funcionando con el resto de
 * parámetros.
 */
export function evaluate(node: Expr, scope: Scope): EvaluationOutcome {
  switch (node.kind) {
    case 'number':
      return { ok: true, value: node.value };

    case 'identifier':
      return evaluateIdentifier(node.name, node.start, node.end, scope);

    case 'unary': {
      const operand = evaluate(node.operand, scope);
      if (!operand.ok) return operand;
      return finite(node.operator === '-' ? -operand.value : operand.value, node);
    }

    case 'binary':
      return evaluateBinary(node, scope);

    case 'call':
      return evaluateCall(node, scope);
  }
}

function evaluateIdentifier(
  name: string,
  start: number,
  end: number,
  scope: Scope,
): EvaluationOutcome {
  const fromScope = scope.get(name);
  if (fromScope !== undefined) return { ok: true, value: fromScope };

  const constant = CONSTANTS.get(name);
  if (constant !== undefined) return { ok: true, value: constant };

  return {
    ok: false,
    issue: { message: `Identificador desconocido «${name}»`, start, end },
  };
}

function evaluateBinary(
  node: Extract<Expr, { kind: 'binary' }>,
  scope: Scope,
): EvaluationOutcome {
  const left = evaluate(node.left, scope);
  if (!left.ok) return left;

  const right = evaluate(node.right, scope);
  if (!right.ok) return right;

  switch (node.operator) {
    case '+':
      return finite(left.value + right.value, node);
    case '-':
      return finite(left.value - right.value, node);
    case '*':
      return finite(left.value * right.value, node);
    case '^':
      return finite(Math.pow(left.value, right.value), node);

    /*
     * La división por cero se trata como ERROR y no como infinito. En una
     * fórmula de patronaje sólo puede venir de una medida sin rellenar o de una
     * errata, y propagar un infinito produciría una pieza con coordenadas no
     * finitas cuyo origen sería imposible de rastrear tres fases después.
     */
    case '/':
      if (right.value === 0) {
        return {
          ok: false,
          issue: { message: 'División por cero', start: node.right.start, end: node.right.end },
        };
      }
      return finite(left.value / right.value, node);

    case '%':
      if (right.value === 0) {
        return {
          ok: false,
          issue: { message: 'Resto de una división por cero', start: node.right.start, end: node.right.end },
        };
      }
      return finite(left.value % right.value, node);
  }
}

function evaluateCall(
  node: Extract<Expr, { kind: 'call' }>,
  scope: Scope,
): EvaluationOutcome {
  const definition = FUNCTIONS.get(node.name);

  if (definition === undefined) {
    return {
      ok: false,
      issue: { message: `Función desconocida «${node.name}»`, start: node.start, end: node.end },
    };
  }

  if (node.args.length < definition.minArgs || node.args.length > definition.maxArgs) {
    const expected =
      definition.minArgs === definition.maxArgs
        ? `${definition.minArgs}`
        : `entre ${definition.minArgs} y ${definition.maxArgs}`;

    return {
      ok: false,
      issue: {
        message: `${node.name}() espera ${expected} argumentos y recibe ${node.args.length}`,
        start: node.start,
        end: node.end,
      },
    };
  }

  const values: number[] = [];
  for (const arg of node.args) {
    const result = evaluate(arg, scope);
    if (!result.ok) return result;
    values.push(result.value);
  }

  return finite(definition.apply(values), node);
}

/**
 * Detiene la propagación de `NaN` e `Infinity` en el punto donde se producen.
 *
 * Sin esta comprobación, un `sqrt(-1)` intermedio recorrería el resto del grafo
 * en silencio y aparecería mucho más tarde como una pieza invisible o una malla
 * rota, sin ninguna pista de dónde se originó.
 */
function finite(value: number, node: Expr): EvaluationOutcome {
  if (Number.isFinite(value)) return { ok: true, value };

  return {
    ok: false,
    issue: {
      message: Number.isNaN(value) ? 'El resultado no es un número' : 'El resultado es infinito',
      start: node.start,
      end: node.end,
    },
  };
}
