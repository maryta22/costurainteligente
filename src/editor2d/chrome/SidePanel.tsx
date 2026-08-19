import { useState } from 'react';

import { ExportPanel } from './ExportPanel';
import { Inspector } from './Inspector';
import { MeasurementsPanel } from './MeasurementsPanel';
import { ParametersPanel } from './ParametersPanel';

const TABS = [
  { id: 'measurements', label: 'Medidas' },
  { id: 'parameters', label: 'Parámetros' },
  { id: 'export', label: 'Exportar' },
  { id: 'inspector', label: 'Selección' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function SidePanel() {
  const [active, setActive] = useState<TabId>('measurements');

  return (
    <aside className="sidepanel">
      <div className="sidepanel__tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            className={`sidepanel__tab${active === tab.id ? ' sidepanel__tab--active' : ''}`}
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="sidepanel__body">
        {active === 'measurements' && <MeasurementsPanel />}
        {active === 'parameters' && <ParametersPanel />}
        {active === 'export' && <ExportPanel />}
        {active === 'inspector' && <Inspector />}
      </div>
    </aside>
  );
}
