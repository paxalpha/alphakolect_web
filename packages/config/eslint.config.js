// Shared ESLint flat-config preset for AlphaKolect workspace packages.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Never lint the quarantined legacy app or build output.
    ignores: ['legacy/**', '**/dist/**', '**/coverage/**', '**/node_modules/**', '**/.next/**', '**/generated/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Module boundaries (OPEN-19): nothing may depend on the legacy app.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/legacy/**'], message: 'legacy/ is a read-only reference; do not import from it.' },
          ],
        },
      ],
      'no-console': 'error', // use the pino logger
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['**/*.test.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
