import type { EdgeId, NotchId, PieceId, SeamId } from './types';

/**
 * Identificadores del patrón.
 *
 * A diferencia de los del boceto, aquí los identificadores son LEGIBLES y
 * derivados del significado (`front.armhole`), no correlativos. La razón es
 * práctica: son los que aparecen en los mensajes del validador, en los
 * diagnósticos del grafo de costuras y en el documento serializado. Un aviso
 * que dice «la arista front.armhole no casa con sleeve.cap» se entiende; uno
 * que dice «e17 no casa con e42» obliga a abrir el depurador.
 */
export const pieceId = (name: string): PieceId => name as PieceId;

export const edgeId = (piece: string, role: string): EdgeId => `${piece}.${role}` as EdgeId;

export const seamId = (from: EdgeId, to: EdgeId): SeamId => `${from}~${to}` as SeamId;

export const notchId = (edge: EdgeId, index: number): NotchId => `${edge}#${index}` as NotchId;
