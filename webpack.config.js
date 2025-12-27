// webpack.config.js
const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');

/** @type {import('webpack').Configuration} */
module.exports = {
    mode: 'production',
    target: 'node', // Joplin plugin runtime (desktop); mobile runner

    // One entry - canonical for Joplin plugins
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

    // Important: the api is provided by Joplin, not Bandlit
    externals: {
        api: 'commonjs2 api',
    },

    plugins: [
        // Copy the manifest and UI statics
        new CopyWebpackPlugin({
            patterns: [
                { from: 'src/manifest.json', to: 'manifest.json' },
                {from: 'src/ui', to: 'ui'}, // calendar.js, calendar.css, icalImport.js
            ],
        }),

        // Fix for mobile: remove "module is not defined"
        new webpack.BannerPlugin({
            raw: true,
            banner:
                "if (typeof module === 'undefined') { var module = { exports: {} }; }\n" +
                "if (typeof exports === 'undefined') { var exports = module.exports; }\n",
        }),
    ],

    devtool: false,
};
