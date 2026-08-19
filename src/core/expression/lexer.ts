import { MM_PER_INCH } from '../units';

export type TokenKind =
  | 'number'
  | 'identifier'
  | 'operator'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'end';

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /** Sólo en `number`, ya convertido a milímetros si llevaba unidad. */
  readonly value?: number;
}

export interface LexIssue {
  readonly message: string;
  readonly start: number;
  readonly end: number;
}

export type LexResult =
  | { readonly ok: true; readonly tokens: readonly Token[] }
  | { readonly ok: false; readonly issue: LexIssue };

/**
 * Sufijos de unidad admitidos, con su factor a MILÍMETROS.
 *
 * Permitir `2cm` o `0.5in` en una fórmula no es azúcar: el modelo trabaja en
 * milímetros (decisión D3), pero las reglas de patronaje están escritas en las
 * unidades del taller. Obligar a traducirlas a mano en cada fórmula es una
 * fuente de errores de factor 10 que además no deja rastro de la intención.
 */
const UNIT_FACTORS: Readonly<Record<string, number>> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: MM_PER_INCH,
};

const OPERATORS = new Set(['+', '-', '*', '/', '%', '^']);

const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';
const isIdentifierStart = (ch: string): boolean =>
  (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
const isIdentifierPart = (ch: string): boolean => isIdentifierStart(ch) || isDigit(ch);

/**
 * Convierte el texto en una secuencia de componentes léxicos.
 *
 * Toda posición se conserva para que los errores puedan señalarse en el texto
 * original.
 */
export function tokenize(source: string): LexResult {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const ch = source[index];
    if (ch === undefined) break;

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      index++;
      continue;
    }

    if (isDigit(ch) || (ch === '.' && isDigit(source[index + 1] ?? ''))) {
      const scanned = scanNumber(source, index);
      if (!scanned.ok) return scanned;
      tokens.push(scanned.token);
      index = scanned.token.end;
      continue;
    }

    if (isIdentifierStart(ch)) {
      const start = index;
      while (index < source.length && isIdentifierPart(source[index] ?? '')) index++;
      tokens.push({
        kind: 'identifier',
        text: source.slice(start, index),
        start,
        end: index,
      });
      continue;
    }

    if (OPERATORS.has(ch)) {
      tokens.push({ kind: 'operator', text: ch, start: index, end: index + 1 });
      index++;
      continue;
    }

    if (ch === '(' || ch === ')' || ch === ',') {
      const kind: TokenKind = ch === '(' ? 'lparen' : ch === ')' ? 'rparen' : 'comma';
      tokens.push({ kind, text: ch, start: index, end: index + 1 });
      index++;
      continue;
    }

    return {
      ok: false,
      issue: { message: `Carácter inesperado «${ch}»`, start: index, end: index + 1 },
    };
  }

  tokens.push({ kind: 'end', text: '', start: source.length, end: source.length });
  return { ok: true, tokens };
}

type ScanResult =
  | { readonly ok: true; readonly token: Token }
  | { readonly ok: false; readonly issue: LexIssue };

function scanNumber(source: string, start: number): ScanResult {
  let index = start;

  while (index < source.length && isDigit(source[index] ?? '')) index++;

  if (source[index] === '.') {
    index++;
    while (index < source.length && isDigit(source[index] ?? '')) index++;
  }

  // Exponente: 1e3, 2.5e-4
  if (source[index] === 'e' || source[index] === 'E') {
    const afterExponent = index + 1;
    const sign = source[afterExponent] === '+' || source[afterExponent] === '-' ? 1 : 0;
    if (isDigit(source[afterExponent + sign] ?? '')) {
      index = afterExponent + sign;
      while (index < source.length && isDigit(source[index] ?? '')) index++;
    }
  }

  const digits = source.slice(start, index);
  const magnitude = Number(digits);
  if (!Number.isFinite(magnitude)) {
    return { ok: false, issue: { message: `Número no válido «${digits}»`, start, end: index } };
  }

  // Sufijo de unidad, opcional.
  let unitEnd = index;
  while (unitEnd < source.length && isIdentifierPart(source[unitEnd] ?? '')) unitEnd++;

  if (unitEnd === index) {
    return {
      ok: true,
      token: { kind: 'number', text: digits, start, end: index, value: magnitude },
    };
  }

  const unit = source.slice(index, unitEnd);
  const factor = UNIT_FACTORS[unit];

  if (factor === undefined) {
    return {
      ok: false,
      issue: {
        message: `Unidad desconocida «${unit}». Se admiten mm, cm, m e in`,
        start: index,
        end: unitEnd,
      },
    };
  }

  return {
    ok: true,
    token: {
      kind: 'number',
      text: source.slice(start, unitEnd),
      start,
      end: unitEnd,
      value: magnitude * factor,
    },
  };
}
