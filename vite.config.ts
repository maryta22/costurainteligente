import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const resolvePath = (relative: string): string =>
  fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@core': resolvePath('./src/core'),
      '@domain': resolvePath('./src/domain'),
      '@state': resolvePath('./src/state'),
      '@export': resolvePath('./src/export'),
      '@editor2d': resolvePath('./src/editor2d'),
      '@editor3d': resolvePath('./src/editor3d'),
      '@components': resolvePath('./src/components'),
      '@app': resolvePath('./src/app'),
      '@utils': resolvePath('./src/utils'),

      /*
       * poly2tri declara como `main` su fuente sin empaquetar, que da por
       * supuesto el `global` que inyecta browserify. En el navegador ese
       * identificador no existe y el módulo revienta al cargarse, tumbando la
       * aplicación entera antes del primer render.
       *
       * El paquete trae el bundle UMD ya resuelto en `dist/`, que funciona
       * igual en navegador y en Node. Apuntar ahí es más preciso que declarar
       * `global` globalmente: arregla la dependencia que tiene el problema en
       * vez de cambiar el entorno de todo el proyecto.
       */
      poly2tri: resolvePath('./node_modules/poly2tri/dist/poly2tri.js'),
    },
  },
  test: {
    // El núcleo y el dominio son TypeScript puro: no necesitan DOM para testear.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    /*
     * Los cinco segundos por defecto se quedan cortos para los tests que
     * generan patrones completos: el de graduación traza sesenta —tres prendas
     * por cinco tallas por cuatro ajustes— y los valida uno a uno. Es cómputo
     * real, no un bloqueo, y recortarlo significaría dejar de comprobar
     * combinaciones.
     */
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/core/**', 'src/domain/**'],
    },
  },
});
