// webpack.config.js
const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');

module.exports = {
    mode: 'production',
    entry: {
        index: './src/index.ts',
        'main/pluginMain': './src/main/pluginMain.ts',
    },
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].js',
        library: {
            type: 'umd',
            name: 'mycalendarPlugin',
        },
        globalObject: 'this',
    },
    resolve: { extensions: ['.ts', '.js'] },
    module: {
        rules: [{ test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/ }],
    },
    externals: {
        api: 'commonjs api',
    },
    plugins: [
        new CopyWebpackPlugin({
            patterns: [
                { from: 'src/ui', to: 'ui' },
                { from: 'src/manifest.json', to: '.' },
            ],
        }),
    ],
    // devtool: 'source-map',
};
