const path = require('path');
const webpack = require('webpack');

module.exports = {
  resolve: {
    extensions: ['.js', '.ts'],
    symlinks: false
  },

  module: {
    rules: [{
      test: /\.ts$/,
      loader: "awesome-typescript-loader",
      include: path.join(__dirname, 'src')
    }]
  },

  entry: ['./src/index'],

  output: {
    path: path.join(__dirname, 'dist'),
    filename: 'bundle.js',
    publicPath: '/'
  },

  plugins: [
    new webpack.DefinePlugin({
      __BUILD__: JSON.stringify(new Date().toUTCString())
    })
  ]
};
