const webpack = require('webpack');
const merge = require('webpack-merge');
const common = require('./webpack.core.js');

module.exports = merge(common, {
  mode: 'development',
  devtool: 'cheap-module-eval-source-map',
  devServer: {
    contentBase: './dist',
    compress: true,
    disableHostCheck: true,
    host: '0.0.0.0',
    port: 3000
  },
  plugins: [
    // apply this plugin only to .ts files - the rest is taken care of
    new webpack.SourceMapDevToolPlugin({
      filename: null,
      exclude: [/node_modules/],
      test: /\.ts($|\?)/i
    })
  ]
})
