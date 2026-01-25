// eslint.config.js
const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const jestPlugin = require("eslint-plugin-jest");
const globals = require("globals");

module.exports = [
    // Basic recommended rules
    js.configs.recommended,
    ...tseslint.configs.recommended,

    // Global ignores
    {
        ignores: [
            "node_modules/**",
            "dist/**",
            "publish/**",
            "coverage/**",
        ],
    },

    // Main TypeScript & JavaScript files
    {
        files: ["src/**/*.{ts,tsx,js}", "tests/**/*.{ts,tsx,js}"],
        languageOptions: {
            parserOptions: {
                ecmaVersion: "latest",
                sourceType: "module",
            },
        },
        rules: {
            "@typescript-eslint/no-unused-vars": ["warn", {
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
                caughtErrorsIgnorePattern: "^_"
            }],
            "@typescript-eslint/no-explicit-any": "off", // Relaxed because of many mocks
            "no-useless-escape": "off",
        },
    },

    // Node.js scripts (webpack, config, etc.)
    {
        files: ["*.js", "scripts/**/*.js"],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
        rules: {
            "@typescript-eslint/no-require-imports": "off",
        }
    },

    // JS in src/ui/ (webview)
    {
        files: ["src/ui/**/*.js"],
        languageOptions: {
            globals: {
                ...globals.browser,
            },
        },
        // Inherits rules from above
    },

    // Jest tests specific
    {
        files: ["tests/**/*.{ts,tsx,js,jsx}"],
        plugins: {jest: jestPlugin},
        languageOptions: {
            globals: {
                ...globals.jest,
                ...globals.node, // Tests often use require or process
            },
        },
        rules: {
            "jest/no-focused-tests": "error",
            "jest/no-disabled-tests": "warn",
            "@typescript-eslint/no-require-imports": "off", // Common in tests
        },
    },
];
