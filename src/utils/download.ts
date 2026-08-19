/**
 * Descarga de archivos generados en el navegador.
 *
 * Vive fuera de `src/export` a propósito: ese módulo produce bytes y cadenas
 * sin saber a dónde van, lo que permite reutilizarlo desde Node —para pruebas o
 * para un futuro exportador en servidor— sin arrastrar el DOM.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // Liberar de inmediato aborta la descarga en algunos navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const downloadText = (text: string, filename: string, mime: string): void =>
  downloadBlob(new Blob([text], { type: mime }), filename);

export const downloadBytes = (bytes: Uint8Array, filename: string, mime: string): void => {
  const copy = new Uint8Array(bytes);
  downloadBlob(new Blob([copy], { type: mime }), filename);
};

/** Nombre de archivo sin caracteres problemáticos. */
export const safeFilename = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
