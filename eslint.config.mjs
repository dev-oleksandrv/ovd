import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['**/node_modules', '**/dist', '**/out', '**/release', '**/coverage', 'fixtures'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  // Core is surface-agnostic (ADR 0001): it never imports from apps.
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@ovd/cli', '@ovd/gui', '@ovd/mcp', '**/apps/**'],
              message: 'Core never imports from apps (ADR 0001).'
            }
          ]
        }
      ]
    }
  },
  // Surfaces use core's public entry only.
  {
    files: ['apps/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@ovd/core/*', '**/packages/core/**'],
              message: 'Import @ovd/core through its entry (ADR 0001).'
            }
          ]
        }
      ]
    }
  },
  // The renderer has no Node access and never runs core (ADR 0004).
  {
    files: ['apps/gui/src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@ovd/core',
              allowTypeImports: true,
              message: 'The renderer talks to core through the preload bridge (ADR 0004).'
            }
          ],
          patterns: [
            {
              group: ['electron', 'node:*', '@ovd/core/*'],
              message: 'No Node or Electron APIs in the renderer (ADR 0004).'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['apps/gui/**/*.tsx'],
    ...react.configs.flat.recommended,
    ...react.configs.flat['jsx-runtime'],
    settings: { react: { version: 'detect' } },
    plugins: { react, 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      ...reactRefresh.configs.vite.rules
    }
  },
  prettier
)
