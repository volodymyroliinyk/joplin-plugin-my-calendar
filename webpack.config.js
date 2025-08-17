const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

/** @type {import('webpack').Configuration} */
module.exports = {
    mode: 'production',
    target: 'node', // важливо для main
    entry: {
        index: './src/index.ts',
        'main/pluginMain': './src/main/pluginMain.ts',
    },
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].js',
        libraryTarget: 'commonjs2', // <— ключ
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
    plugins: [
        new CopyWebpackPlugin({
            patterns: [
                { from: 'src/manifest.json', to: 'manifest.json' },
                { from: 'src/ui', to: 'ui' }, // calendar.js, calendar.css
            ],
        }),
    ],
    devtool: false,
};
