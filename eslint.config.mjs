import prettier from 'eslint-config-prettier';

import apify from '@apify/eslint-config/ts.js';
import globals from 'globals';
import tsEslint from 'typescript-eslint';

// eslint-disable-next-line import-x/no-default-export
export default [
    { ignores: ['**/dist', '**/test', 'eslint.config.mjs'] },
    ...apify,
    prettier,
    {
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.jest,
            },
        },
        rules: {
            'no-console': 0,
        },
    },
    {
        files: ['**/*.{ts,tsx,mts,cts}'],
        languageOptions: {
            parser: tsEslint.parser,
            parserOptions: {
                // Each file uses the tsconfig that includes it (root src/, mcp/src/).
                // A single parserOptions.project cannot see files outside tsconfig.json.
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            '@typescript-eslint': tsEslint.plugin,
        },
    },
];
