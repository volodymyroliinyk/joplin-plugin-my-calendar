/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',

    testMatch: [
        '<rootDir>/tests/**/*.test.ts'
    ],

    moduleFileExtensions: ['ts', 'js'],

    clearMocks: true,
    restoreMocks: true,

    // so that Jest does not crawl into dist
    testPathIgnorePatterns: ['/node_modules/', '/dist/', '/publish/'],
};
