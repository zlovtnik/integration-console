import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';
import solid from 'eslint-plugin-solid';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    plugins: {
      solid,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...solid.configs.typescript.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'jsx-a11y/label-has-associated-control': 'off',
      'jsx-a11y/no-redundant-roles': 'off',
    },
  },
];
