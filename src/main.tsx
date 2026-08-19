import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@app/App';

import './styles/global.css';
import './styles/editor.css';

const container = document.getElementById('root');
if (container === null) throw new Error('No se encontró el contenedor #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
