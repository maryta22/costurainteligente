import { useMemo, useState } from 'react';

import { rectHeight, rectWidth } from '@core/geometry/rect';
import { formatLength } from '@core/units';

import { GENERATORS } from '@domain/pattern/generators';

import { buildDrawing } from '@export/drawing';
import { drawingToPdf } from '@export/pdf';
import { drawingToSvg } from '@export/svg';
import { tilePages } from '@export/tiling';
import type { ExportOptions } from '@export/types';
import { PAGE_FORMATS, findPageFormat } from '@export/types';

import { useEditorStore } from '@state/editorStore';
import { useParametricStore } from '@state/parametricStore';
import { currentPattern, usePatternStore } from '@state/patternStore';

import { downloadBytes, downloadText, safeFilename } from '@utils/download';

const CONTENT_FLAGS = [
  { key: 'includeSeamLine', label: 'Línea de costura' },
  { key: 'includeCutLine', label: 'Línea de corte' },
  { key: 'includeNotches', label: 'Piquetes' },
  { key: 'includeGrainLine', label: 'Línea de hilo' },
  { key: 'includeLabels', label: 'Etiquetas' },
  { key: 'includeCalibration', label: 'Cuadrado de comprobación' },
] as const;

export function ExportPanel() {
  const garment = usePatternStore((state) => state.garment);
  const size = useParametricStore((state) => state.size);
  const unit = useEditorStore((state) => state.displayUnit);

  const [formatId, setFormatId] = useState('a4');
  const [busy, setBusy] = useState(false);
  const [content, setContent] = useState<ExportOptions>({
    includeSeamLine: true,
    includeCutLine: true,
    includeNotches: true,
    includeGrainLine: true,
    includeLabels: true,
    includeCalibration: true,
  });

  const title = `${GENERATORS[garment]?.name ?? garment} · talla ${size}`;

  const drawing = useMemo(
    () => buildDrawing(currentPattern()?.pieces ?? [], { ...content, title }),
    [content, title, garment, size],
  );

  const format = findPageFormat(formatId);
  const tiling = format === undefined ? null : tilePages(drawing.bounds, format, content);

  const basename = safeFilename(title);

  const exportSvg = (): void => {
    downloadText(drawingToSvg(drawing), `${basename}.svg`, 'image/svg+xml');
  };

  const exportPdf = (): void => {
    if (format === undefined) return;

    setBusy(true);
    void drawingToPdf(drawing, format, content)
      .then((bytes) => downloadBytes(bytes, `${basename}-${format.id}.pdf`, 'application/pdf'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="panel">
      <section className="panel__section">
        <h3 className="panel__heading">Qué se exporta</h3>
        {CONTENT_FLAGS.map(({ key, label }) => (
          <label key={key} className="field field--check">
            <input
              type="checkbox"
              checked={content[key] !== false}
              onChange={(event) => setContent({ ...content, [key]: event.target.checked })}
            />
            {label}
          </label>
        ))}
      </section>

      <section className="panel__section">
        <h3 className="panel__heading">Tamaño del patrón</h3>
        <dl className="readout">
          <dt>Ancho</dt>
          <dd>{formatLength(rectWidth(drawing.bounds), unit)}</dd>
          <dt>Alto</dt>
          <dd>{formatLength(rectHeight(drawing.bounds), unit)}</dd>
        </dl>
      </section>

      <section className="panel__section">
        <h3 className="panel__heading">Papel</h3>

        <label className="field field--stack">
          <span className="field__label">Formato</span>
          <select value={formatId} onChange={(event) => setFormatId(event.target.value)}>
            {PAGE_FORMATS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>

        {tiling !== null && (
          <dl className="readout">
            <dt>Páginas</dt>
            <dd>
              {tiling.pages.length} ({tiling.rows} × {tiling.columns})
            </dd>
          </dl>
        )}

        {/*
          La advertencia va aquí y no en un manual: es el fallo más frecuente y
          más destructivo de imprimir un patrón, y el único momento en que el
          usuario puede evitarlo es justo antes de darle a imprimir.
        */}
        <p className="panel__hint">
          Imprime al <strong>100 %</strong>, sin «ajustar a página». Después comprueba con una
          regla el cuadrado de 100 mm: si no mide 100, la impresión ha escalado.
        </p>
      </section>

      <section className="panel__section">
        <button type="button" className="btn" onClick={exportSvg}>
          Exportar SVG
        </button>
        <button type="button" className="btn" onClick={exportPdf} disabled={busy}>
          {busy ? 'Generando…' : 'Exportar PDF'}
        </button>
      </section>
    </div>
  );
}
