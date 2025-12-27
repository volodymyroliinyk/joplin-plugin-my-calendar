// webpack.config.js
const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');

/** @type {import('webpack').Configuration} */
module.exports = {
    mode: 'production',
    target: 'node', // Joplin plugin runtime (desktop); mobile runner теж ок

    // Один entry - canonical для Joplin plugins
    entry: {
        index: './src/index.ts',
    },

    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].js',
        libraryTarget: 'commonjs2',
        clean: true,
    },

    resolve: {
        extensions: ['.ts', '.tsx', '.js'],
    },

    module: {
        rules: [
            { test: /\.tsx?$/, loader: 'ts-loader', exclude: /node_modules/ },
        ],
    },

    // Важливо: api надається Joplin'ом, не бандлити
    externals: {
        api: 'commonjs2 api',
        // Якщо десь лишився joplin.require('fs-extra') - це не імпорт, externals не потрібен.
        // Але якщо є `import fs from "fs-extra"`, тоді розкоментуй:
        // 'fs-extra': 'commonjs2 fs-extra',
    },

    plugins: [
        // Копіюємо manifest і UI-статику
        new CopyWebpackPlugin({
            patterns: [
                { from: 'src/manifest.json', to: 'manifest.json' },
                {from: 'src/ui', to: 'ui'}, // calendar.js, calendar.css, icalImport.js
            ],
        }),

        // Фікс для mobile: прибрати "module is not defined"
        new webpack.BannerPlugin({
            raw: true,
            banner:
                "if (typeof module === 'undefined') { var module = { exports: {} }; }\n" +
                "if (typeof exports === 'undefined') { var exports = module.exports; }\n",
        }),
    ],

    devtool: false,
};
