// @ts-check
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
    {
        ignores: ['lib/**', 'node_modules/**', 'coverage/**'],
    },
    ...tseslint.configs.recommended,
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/no-require-imports': ['error', { allowAsImport: true }],
        },
    },
);
