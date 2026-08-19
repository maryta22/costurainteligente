import type { BinaryOperator, Expr, UnaryOperator } from './ast';
import type { Token } from './lexer';
import { tokenize } from './lexer';

export interface ExpressionIssue {
  readonly message: string;
  readonly start: number;
  readonly end: number;
}

export type ParseResult =
  | { readonly ok: true; readonly ast: Expr }
  | { readonly ok: false; readonly issue: ExpressionIssue };

/**
 * Precedencia de los operadores binarios. Mayor número, más fuerte.
 *
 * `^` NO aparece aquí: se resuelve en `parsePower`, por encima del menos
 * unario. La razón es el convenio matemático, que difiere del orden ingenuo:
 *
 *     −2^2 = −(2^2) = −4        y no  (−2)^2 = 4
 *
 * Tratar `^` como un binario más lo dejaría por debajo del unario y daría el
 * signo cambiado. Es un error silencioso: la fórmula parece razonable y el
 * resultado es plausible.
 */
const PRECEDENCE: Readonly<Record<string, number>> = {
  '+': 1,
  '-': 1,
  '*': 2,
  '/': 2,
  '%': 2,
};

/**
 * Analizador sintáctico descendente recursivo.
 *
 * ── Por qué se escribe en lugar de usar una biblioteca ─────────────────────
 *
 * Son doscientas líneas y a cambio se obtienen tres cosas que ninguna
 * alternativa da a la vez:
 *
 *   · SEGURIDAD. `eval` o `new Function` ejecutarían código arbitrario
 *     procedente de un documento; aquí una expresión sólo puede hacer
 *     aritmética.
 *   · DEPENDENCIAS GRATIS. Recorrer el árbol da la lista de parámetros de los
 *     que depende cada fórmula, y con ella se construye el grafo sin que nadie
 *     las declare a mano.
 *   · ERRORES CON POSICIÓN. Cada nodo conoce su sitio en el texto, así que se
 *     puede señalar la columna exacta del fallo.
 *
 * Una biblioteca de cálculo simbólico pesa más que todo el núcleo y no
 * resolvería mejor ninguna de las tres.
 */
export function parseExpression(source: string): ParseResult {
  const lexed = tokenize(source);
  if (!lexed.ok) return { ok: false, issue: lexed.issue };

  const parser = new Parser(lexed.tokens);
  return parser.parseAll();
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parseAll(): ParseResult {
    if (this.peek().kind === 'end') {
      return {
        ok: false,
        issue: { message: 'La expresión está vacía', start: 0, end: 0 },
      };
    }

    let ast: Expr;
    try {
      ast = this.parseBinary(0);
    } catch (error) {
      return { ok: false, issue: asIssue(error) };
    }

    const trailing = this.peek();
    if (trailing.kind !== 'end') {
      return {
        ok: false,
        issue: {
          message: `Sobra «${trailing.text}» al final de la expresión`,
          start: trailing.start,
          end: trailing.end,
        },
      };
    }

    return { ok: true, ast };
  }

  private peek(): Token {
    const token = this.tokens[this.index];
    if (token === undefined) throw new ParseFailure('Fin inesperado', 0, 0);
    return token;
  }

  private advance(): Token {
    const token = this.peek();
    this.index++;
    return token;
  }

  /**
   * Escalada de precedencia: un solo bucle resuelve todos los niveles, en vez
   * de una función recursiva por nivel.
   */
  private parseBinary(minimumPrecedence: number): Expr {
    let left = this.parseUnary();

    for (;;) {
      const token = this.peek();
      if (token.kind !== 'operator') break;

      const operator = token.text as BinaryOperator;
      const precedence = PRECEDENCE[operator];
      if (precedence === undefined || precedence < minimumPrecedence) break;

      this.advance();

      // Todos los binarios de esta tabla asocian por la izquierda.
      const right = this.parseBinary(precedence + 1);

      left = {
        kind: 'binary',
        operator,
        left,
        right,
        start: left.start,
        end: right.end,
      };
    }

    return left;
  }

  private parseUnary(): Expr {
    const token = this.peek();

    if (token.kind === 'operator' && (token.text === '-' || token.text === '+')) {
      this.advance();
      const operand = this.parseUnary();
      return {
        kind: 'unary',
        operator: token.text as UnaryOperator,
        operand,
        start: token.start,
        end: operand.end,
      };
    }

    return this.parsePower();
  }

  /**
   * Potenciación: por encima del menos unario y asociativa por la derecha.
   *
   *   −2^2   → −(2^2) = −4       el unario se aplica al resultado
   *   2^3^2  → 2^(3^2) = 512     asociatividad derecha, como en matemáticas
   *   2^-3   → admite exponente negativo
   *
   * El exponente se analiza con `parseUnary` y no con `parsePower`: así se
   * consiguen a la vez la asociatividad derecha y el exponente con signo.
   */
  private parsePower(): Expr {
    const base = this.parsePrimary();

    const token = this.peek();
    if (token.kind !== 'operator' || token.text !== '^') return base;

    this.advance();
    const exponent = this.parseUnary();

    return {
      kind: 'binary',
      operator: '^',
      left: base,
      right: exponent,
      start: base.start,
      end: exponent.end,
    };
  }

  private parsePrimary(): Expr {
    const token = this.advance();

    if (token.kind === 'number') {
      return { kind: 'number', value: token.value ?? 0, start: token.start, end: token.end };
    }

    if (token.kind === 'identifier') {
      // Un identificador seguido de paréntesis es una llamada; si no, una
      // referencia a otro parámetro. La distinción se hace aquí para que el
      // recolector de dependencias no confunda `min` con un parámetro.
      if (this.peek().kind === 'lparen') return this.parseCall(token);
      return { kind: 'identifier', name: token.text, start: token.start, end: token.end };
    }

    if (token.kind === 'lparen') {
      const inner = this.parseBinary(0);
      const closing = this.advance();
      if (closing.kind !== 'rparen') {
        throw new ParseFailure('Falta el paréntesis de cierre', closing.start, closing.end);
      }
      return inner;
    }

    if (token.kind === 'end') {
      throw new ParseFailure('La expresión termina antes de tiempo', token.start, token.end);
    }

    throw new ParseFailure(`No se esperaba «${token.text}»`, token.start, token.end);
  }

  private parseCall(name: Token): Expr {
    this.advance(); // '('
    const args: Expr[] = [];

    if (this.peek().kind !== 'rparen') {
      for (;;) {
        args.push(this.parseBinary(0));
        if (this.peek().kind !== 'comma') break;
        this.advance();
      }
    }

    const closing = this.advance();
    if (closing.kind !== 'rparen') {
      throw new ParseFailure(
        `Falta el paréntesis de cierre de ${name.text}(`,
        closing.start,
        closing.end,
      );
    }

    return { kind: 'call', name: name.text, args, start: name.start, end: closing.end };
  }
}

class ParseFailure extends Error {
  constructor(
    message: string,
    readonly start: number,
    readonly end: number,
  ) {
    super(message);
    this.name = 'ParseFailure';
  }
}

function asIssue(error: unknown): ExpressionIssue {
  if (error instanceof ParseFailure) {
    return { message: error.message, start: error.start, end: error.end };
  }
  return {
    message: error instanceof Error ? error.message : 'Error al analizar la expresión',
    start: 0,
    end: 0,
  };
}

/**
 * Mensaje de error con el texto y un cursor bajo el punto exacto del fallo.
 *
 * Es la diferencia entre «la expresión falla» y saber dónde mirar:
 *
 *     bust / 4 + fooo
 *                ^^^^
 *     Identificador desconocido «fooo»
 */
export function formatExpressionIssue(source: string, issue: ExpressionIssue): string {
  const width = Math.max(1, issue.end - issue.start);
  const caret = ' '.repeat(Math.max(0, issue.start)) + '^'.repeat(width);
  return `${source}\n${caret}\n${issue.message}`;
}
