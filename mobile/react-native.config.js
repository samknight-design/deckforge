// onnxruntime-react-native's Android ReactPackage isn't picked up by Expo's
// autolinking (it compiles the native code but never registers OnnxruntimePackage,
// so NativeModules.Onnxruntime is null at runtime). Register it explicitly.
module.exports = {
  dependencies: {
    'onnxruntime-react-native': {
      platforms: {
        android: {
          packageImportPath: 'import ai.onnxruntime.reactnative.OnnxruntimePackage;',
          packageInstance: 'new OnnxruntimePackage()',
        },
      },
    },
  },
};
