// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'prisma/migrations/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'warn',
        { allowExpressions: true },
      ],
      // Module boundaries: another module may only be imported through its
      // *.public barrel. Deep imports into a module's internals are forbidden.
      // Cross-module imports always use the @modules alias; relative paths stay
      // within a single module.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@modules/*/!(*.public)', '@modules/*/*/**'],
              message:
                'Import another module only through its *.public barrel, never its internals.',
            },
          ],
        },
      ],
    },
  },
);
