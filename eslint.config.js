import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // TypeScript ya resuelve la existencia de identificadores globales.
      'no-undef': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  /*
   * Frontera de capas (§1 de docs/ARCHITECTURE.md).
   *
   * El núcleo (L1) y el dominio (L2) no pueden depender de React, del estado,
   * ni de la capa de presentación. Las dependencias van siempre hacia abajo.
   */
  {
    files: ['src/core/**/*.ts', 'src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            'react',
            'react-dom',
            'zustand',
            'three',
            '@react-three/fiber',
            '@react-three/drei',
          ],
          patterns: [
            '@state/*',
            '@editor2d/*',
            '@app/*',
            '**/state/**',
            '**/editor2d/**',
            '**/editor3d/**',
            '**/app/**',
          ],
        },
      ],
    },
  },

  // El núcleo, además, no depende del dominio.
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['@domain/*', '**/domain/**', '@state/*', '@editor2d/*', '@app/*'] },
      ],
    },
  },
);
