// tesseract.js-core ships no types: its Emscripten factory takes module options and resolves the module.
declare module 'tesseract.js-core/tesseract-core-simd-lstm.js' {
  const factory: (options: object) => Promise<unknown>;
  export default factory;
}
