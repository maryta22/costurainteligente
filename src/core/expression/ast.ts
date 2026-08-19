/**
 * Árbol sintáctico de una expresión paramétrica.
 *
 * Cada nodo guarda su POSICIÓN en el texto original. No es un adorno: es lo que
 * permite señalar con un cursor el punto exacto del error —«identificador
 * desconocido en la columna 12»— en lugar de decir «la expresión falla», que
 * obliga al usuario a adivinar.
 *
 * El árbol es también de donde salen GRATIS las dependencias: recorrer los
 * nodos `identifier` da la lista de parámetros de los que depende una fórmula,
 * y con ella se construye el grafo sin que nadie tenga que declararlas a mano.
 * Es la razón de escribir el parser en lugar de usar `eval` o una biblioteca
 * de cálculo simbólico.
 */

export type BinaryOperator = '+' | '-' | '*' | '/' | '%' | '^';
export type UnaryOperator = '+' | '-';

export interface NumberNode {
  readonly kind: 'number';
  readonly value: number;
  readonly start: number;
  readonly end: number;
}

export interface IdentifierNode {
  readonly kind: 'identifier';
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

export interface UnaryNode {
  readonly kind: 'unary';
  readonly operator: UnaryOperator;
  readonly operand: Expr;
  readonly start: number;
  readonly end: number;
}

export interface BinaryNode {
  readonly kind: 'binary';
  readonly operator: BinaryOperator;
  readonly left: Expr;
  readonly right: Expr;
  readonly start: number;
  readonly end: number;
}

export interface CallNode {
  readonly kind: 'call';
  readonly name: string;
  readonly args: readonly Expr[];
  readonly start: number;
  readonly end: number;
}

export type Expr = NumberNode | IdentifierNode | UnaryNode | BinaryNode | CallNode;

/** Recorre el árbol en profundidad, visitando cada nodo una vez. */
export function walk(node: Expr, visit: (node: Expr) => void): void {
  visit(node);

  switch (node.kind) {
    case 'unary':
      walk(node.operand, visit);
      return;
    case 'binary':
      walk(node.left, visit);
      walk(node.right, visit);
      return;
    case 'call':
      for (const arg of node.args) walk(arg, visit);
      return;
    default:
      return;
  }
}

/**
 * Identificadores de los que depende la expresión.
 *
 * Los nombres de función NO cuentan como dependencia: `min` no es un
 * parámetro. Por eso se recogen sólo los nodos `identifier`, que el parser
 * distingue de `call` en el momento de construirlos.
 */
export function collectIdentifiers(node: Expr): Set<string> {
  const names = new Set<string>();
  walk(node, (child) => {
    if (child.kind === 'identifier') names.add(child.name);
  });
  return names;
}

/** Funciones invocadas, para comprobar que existen antes de evaluar. */
export function collectCalls(node: Expr): Set<string> {
  const names = new Set<string>();
  walk(node, (child) => {
    if (child.kind === 'call') names.add(child.name);
  });
  return names;
}
