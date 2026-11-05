import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

// Written rules (CLAUDE.md, .claude/rules/, ADRs) enforced here. Every message names its source and
// what to do instead. In flat config a later block that sets the same rule replaces its options
// for the files it matches, so blocks that narrow a rule (renderer, hex colors) repeat the broader
// entries through the shared lists below.

const coreDeepImports = {
  group: ['@ovd/core/*', '**/packages/core/**'],
  message:
    'Import @ovd/core through its entry, never a deep path (ADR 0001, .claude/rules/architecture.md).'
}

/** Patterns that stop one surface from importing another (.claude/rules/architecture.md). */
const otherSurfaces = (...names) => ({
  group: names.flatMap((name) => [
    `@ovd/${name}`,
    `@ovd/${name}/*`,
    `**/apps/${name}/**`,
    `**/${name}/src/**`
  ]),
  message:
    'Surfaces never import each other (.claude/rules/architecture.md). Move shared logic into @ovd/core.'
})

const noDefaultExport = {
  selector: 'ExportDefaultDeclaration',
  message:
    'Named exports only (CLAUDE.md, Code style). Use `export function X` or `export const X`.'
}

const hexColorMessage =
  'No hex colors in components (.claude/rules/gui.md, Design). Use a token class (bg-panel, text-muted…); a missing value becomes a new token in src/renderer/src/assets/main.css.'
const hexColor = /#[0-9a-fA-F]{3,8}\b/.source
const noHexColors = [
  { selector: `Literal[value=/${hexColor}/]`, message: hexColorMessage },
  { selector: `TemplateElement[value.raw=/${hexColor}/]`, message: hexColorMessage }
]

const sourceFiles = '**/*.{ts,tsx,mts,cts,js,mjs,cjs}'

export default tseslint.config(
  { ignores: ['**/node_modules', '**/dist', '**/out', '**/release', '**/coverage', 'fixtures'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // CLAUDE.md, Code style: no non-null `!` without a comment explaining why it is safe. Narrow
      // the value instead, or justify it with
      // `// eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- <why it's safe>`.
      '@typescript-eslint/no-non-null-assertion': 'error'
    }
  },
  // Named exports only (CLAUDE.md, Code style). Tool config files need a default export.
  {
    files: [
      `apps/*/src/${sourceFiles}`,
      `packages/*/src/${sourceFiles}`,
      `e2e/{cli,gui,harness,fake-sdk}/${sourceFiles}`
    ],
    ignores: ['**/*.config.*'],
    rules: {
      'no-restricted-syntax': ['error', noDefaultExport]
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
              message:
                'Core never imports from apps (ADR 0001). Move the code into core, or keep it in the surface.'
            }
          ]
        }
      ]
    }
  },
  // Core never touches the process (.claude/rules/architecture.md, Core): surfaces own I/O.
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'console',
          message:
            'Core never writes to stdout/stderr (.claude/rules/architecture.md). Return typed data or a typed error; the surface prints it.'
        },
        ...['stdout', 'stderr'].map((property) => ({
          object: 'process',
          property,
          message:
            'Core never writes to stdout/stderr (.claude/rules/architecture.md). Return typed data or a typed error; the surface prints it.'
        })),
        {
          object: 'process',
          property: 'argv',
          message:
            'Core never reads process.argv (.claude/rules/architecture.md). Take the value as a parameter from the surface.'
        },
        {
          object: 'process',
          property: 'exit',
          message:
            'Core never calls process.exit (.claude/rules/architecture.md). Throw an OvdError; the surface picks the exit code.'
        }
      ]
    }
  },
  // Surfaces use core's public entry only, and never import each other.
  {
    files: ['apps/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [coreDeepImports] }]
    }
  },
  {
    files: ['apps/cli/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [coreDeepImports, otherSurfaces('gui', 'mcp')] }
      ]
    }
  },
  {
    files: ['apps/gui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [coreDeepImports, otherSurfaces('cli', 'mcp')] }
      ]
    }
  },
  // The renderer has no Node access and never runs core (ADR 0004). This block replaces the
  // apps/gui one for renderer files, so it repeats its patterns.
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
              message:
                'The renderer talks to core through the preload bridge (ADR 0004). Use `import type`, or call window.ovd.'
            }
          ],
          patterns: [
            coreDeepImports,
            otherSurfaces('cli', 'mcp'),
            {
              group: ['electron', 'node:*'],
              message:
                'No Node or Electron APIs in the renderer (ADR 0004). Do the work in src/main/ and expose it over the preload bridge.'
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
      ...reactRefresh.configs.vite.rules,
      // CLAUDE.md, Code style: one React component per file. Move the extra component into its own
      // PascalCase.tsx file.
      'react/no-multi-comp': ['error', { ignoreStateless: false }]
    }
  },
  // Components use token classes only (.claude/rules/gui.md, Design). Replaces the named-exports
  // block for these files, so it repeats that selector.
  {
    files: ['apps/gui/src/renderer/src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', noDefaultExport, ...noHexColors]
    }
  },
  prettier
)
