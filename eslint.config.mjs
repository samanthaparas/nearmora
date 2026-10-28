/**
 * Lint rules for the whole project (`npm run lint`).
 * The type-aware rules catch mistakes the compiler allows, like forgotten promises or unsafe `any`.
 */

import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out/', 'release/', 'node_modules/', 'playwright-report/', 'test-results/'] },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      // projectService finds the right tsconfig for each file, so type-aware rules work everywhere.
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Type-only imports must say so, which keeps Zod and Node modules out of the bundles that can't use them.
      '@typescript-eslint/consistent-type-imports': 'error',
      // `void promise` is our explicit "fire and forget" marker; anything else must be awaited or handled.
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
    },
  },

  // Renderer code runs in the browser and uses React hooks.
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },

  // Plain JS config files (like this one) aren't covered by a tsconfig, so skip type-aware rules there.
  {
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
)
