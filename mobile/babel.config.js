module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Required for react-native-worklets-core and vision-camera frame processors.
      // This transpiles functions marked with 'worklet' so they run on a
      // background thread without JS-bridge overhead.
      'react-native-worklets-core/plugin',
    ],
  };
};
