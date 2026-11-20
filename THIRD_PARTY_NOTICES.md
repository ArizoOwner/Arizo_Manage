# Third-party notices

Arizo Manage is proprietary software (see [LICENSE](LICENSE)). It includes or links to the open-source components below. Each component stays under its own licence; nothing in the Arizo Manage licence limits the rights those licences give you in them. Full licence texts ship with each package (`node_modules/<name>/LICENSE`, the Maven artifacts) and, for fonts, in [public/fonts/](public/fonts/).

## Fonts

| Font | Licence |
| --- | --- |
| Vazirmatn | SIL Open Font License 1.1 ([text](public/fonts/OFL-Vazirmatn.txt)) |
| Plus Jakarta Sans | SIL Open Font License 1.1 ([text](public/fonts/OFL-PlusJakartaSans.txt)) |

## Android native libraries

| Library | Version | Licence |
| --- | --- | --- |
| SQLCipher for Android (`net.zetetic:sqlcipher-android`) | 4.10.0 | BSD-3-Clause style (Zetetic LLC) |
| AndroidX (appcompat, core, webkit, biometric, sqlite, splashscreen, coordinatorlayout) | see `android/variables.gradle` | Apache-2.0 |
| Kotlin standard library | 2.1.21 | Apache-2.0 |
| Capacitor Android | 7.x | MIT |

## JavaScript packages shipped in the app

Generated from `package.json` dependencies and their dependencies (201 packages). Development-only tools (Vite, Vitest, Playwright, TypeScript, Tailwind CLI and others) are not shipped and are not listed.

| Package | Version | Licence | |
| --- | --- | --- | --- |
| `@babel/runtime` | 7.29.14 | MIT | [source](https://github.com/babel/babel) |
| `@capacitor/android` | 7.6.10 | MIT | [source](https://github.com/ionic-team/capacitor) |
| `@capacitor/core` | 7.6.10 | MIT | [source](https://github.com/ionic-team/capacitor) |
| `@capacitor/filesystem` | 7.1.9 | MIT | [source](https://github.com/ionic-team/capacitor-filesystem) |
| `@capacitor/haptics` | 7.0.5 | MIT | [source](https://github.com/ionic-team/capacitor-plugins) |
| `@capacitor/local-notifications` | 7.0.7 | MIT | [source](https://github.com/ionic-team/capacitor-plugins) |
| `@capacitor/share` | 7.0.4 | MIT | [source](https://github.com/ionic-team/capacitor-plugins) |
| `@capacitor/synapse` | 1.0.4 | ISC |  |
| `@fast-csv/format` | 4.3.5 | MIT | [source](https://github.com/C2FO/fast-csv) |
| `@fast-csv/parse` | 4.3.6 | MIT | [source](https://github.com/C2FO/fast-csv) |
| `@isaacs/nonrecursive-glob-match` | 1.1.0 | BlueOak-1.0.0 |  |
| `@tanstack/react-virtual` | 3.14.26 | MIT | [source](https://github.com/TanStack/virtual) |
| `@tanstack/virtual-core` | 3.19.11 | MIT | [source](https://github.com/TanStack/virtual) |
| `@types/node` | 26.6.6 | MIT | [source](https://github.com/DefinitelyTyped/DefinitelyTyped) |
| `archiver` | 5.3.2 | MIT | [source](https://github.com/archiverjs/node-archiver) |
| `archiver-utils` | 2.1.0 | MIT | [source](https://github.com/archiverjs/archiver-utils) |
| `array-buffer-byte-length` | 1.0.2 | MIT | [source](https://github.com/inspect-js/array-buffer-byte-length) |
| `arraybuffer.prototype.slice` | 1.0.4 | MIT | [source](https://github.com/es-shims/ArrayBuffer.prototype.slice) |
| `async` | 3.2.6 | MIT | [source](https://github.com/caolan/async) |
| `async-function` | 1.0.0 | MIT | [source](https://github.com/ljharb/async-function) |
| `available-typed-arrays` | 1.0.7 | MIT | [source](https://github.com/inspect-js/available-typed-arrays) |
| `balanced-match` | 4.0.4 | MIT | [source](https://github.com/juliangruber/balanced-match) |
| `base64-js` | 1.5.1 | MIT | [source](https://github.com/beatgammit/base64-js) |
| `big-integer` | 1.6.52 | Unlicense | [source](https://github.com/peterolson/BigInteger.js) |
| `binary` | 0.3.0 | MIT | [source](https://github.com/substack/node-binary) |
| `bl` | 4.1.0 | MIT | [source](https://github.com/rvagg/bl) |
| `bluebird` | 3.4.7 | MIT | [source](https://github.com/petkaantonov/bluebird) |
| `brace-expansion` | 5.0.13 | MIT | [source](https://github.com/juliangruber/brace-expansion) |
| `buffer` | 5.7.1 | MIT | [source](https://github.com/feross/buffer) |
| `buffer-crc32` | 0.2.13 | MIT | [source](https://github.com/brianloveswords/buffer-crc32) |
| `buffer-indexof-polyfill` | 1.0.2 | MIT | [source](https://github.com/sarosia/buffer-indexof-polyfill) |
| `buffers` | 0.1.1 | MIT/X11 | [source](https://github.com/substack/node-buffers) |
| `call-bind` | 1.0.9 | MIT | [source](https://github.com/ljharb/call-bind) |
| `call-bind-apply-helpers` | 1.0.2 | MIT | [source](https://github.com/ljharb/call-bind-apply-helpers) |
| `call-bound` | 1.0.4 | MIT | [source](https://github.com/ljharb/call-bound) |
| `chainsaw` | 0.1.0 | MIT/X11 | [source](https://github.com/substack/node-chainsaw) |
| `compress-commons` | 4.1.2 | MIT | [source](https://github.com/archiverjs/node-compress-commons) |
| `cookie` | 1.1.1 | MIT | [source](https://github.com/jshttp/cookie) |
| `crc-32` | 1.2.2 | Apache-2.0 | [source](https://github.com/SheetJS/js-crc32) |
| `crc32-stream` | 4.0.3 | MIT | [source](https://github.com/archiverjs/node-crc32-stream) |
| `data-view-buffer` | 1.0.2 | MIT | [source](https://github.com/inspect-js/data-view-buffer) |
| `data-view-byte-length` | 1.0.2 | MIT | [source](https://github.com/inspect-js/data-view-byte-length) |
| `data-view-byte-offset` | 1.0.1 | MIT | [source](https://github.com/inspect-js/data-view-byte-offset) |
| `dayjs` | 1.11.23 | MIT | [source](https://github.com/iamkun/dayjs) |
| `define-data-property` | 1.1.4 | MIT | [source](https://github.com/ljharb/define-data-property) |
| `define-properties` | 1.2.1 | MIT | [source](https://github.com/ljharb/define-properties) |
| `dexie` | 4.4.7 | Apache-2.0 | [source](https://github.com/dexie/Dexie.js) |
| `dunder-proto` | 1.0.1 | MIT | [source](https://github.com/es-shims/dunder-proto) |
| `duplexer2` | 0.1.4 | BSD-3-Clause | [source](https://github.com/deoxxa/duplexer2) |
| `end-of-stream` | 1.4.5 | MIT | [source](https://github.com/mafintosh/end-of-stream) |
| `es-abstract` | 1.24.2 | MIT | [source](https://github.com/ljharb/es-abstract) |
| `es-abstract-get` | 1.0.0 | MIT | [source](https://github.com/ljharb/es-abstract-get) |
| `es-define-property` | 1.0.1 | MIT | [source](https://github.com/ljharb/es-define-property) |
| `es-errors` | 1.3.0 | MIT | [source](https://github.com/ljharb/es-errors) |
| `es-object-atoms` | 1.1.2 | MIT | [source](https://github.com/ljharb/es-object-atoms) |
| `es-set-tostringtag` | 2.1.0 | MIT | [source](https://github.com/es-shims/es-set-tostringtag) |
| `es-to-primitive` | 1.3.4 | MIT | [source](https://github.com/ljharb/es-to-primitive) |
| `exceljs` | 4.4.0 | MIT | [source](https://github.com/exceljs/exceljs) |
| `fast-csv` | 4.3.6 | MIT | [source](https://github.com/C2FO/fast-csv) |
| `for-each` | 0.3.5 | MIT | [source](https://github.com/Raynos/for-each) |
| `framer-motion` | 12.43.0 | MIT | [source](https://github.com/motiondivision/motion/) |
| `fs-constants` | 1.0.0 | MIT | [source](https://github.com/mafintosh/fs-constants) |
| `fstream` | 1.0.12 | ISC | [source](https://github.com/npm/fstream) |
| `function-bind` | 1.1.2 | MIT | [source](https://github.com/Raynos/function-bind) |
| `function.prototype.name` | 1.2.0 | MIT | [source](https://github.com/es-shims/Function.prototype.name) |
| `functions-have-names` | 1.2.3 | MIT | [source](https://github.com/inspect-js/functions-have-names) |
| `generator-function` | 2.0.1 | MIT | [source](https://github.com/TimothyGu/generator-function) |
| `get-intrinsic` | 1.3.0 | MIT | [source](https://github.com/ljharb/get-intrinsic) |
| `get-proto` | 1.0.1 | MIT | [source](https://github.com/ljharb/get-proto) |
| `get-symbol-description` | 1.1.0 | MIT | [source](https://github.com/inspect-js/get-symbol-description) |
| `glob` | 14.0.6 | BlueOak-1.0.0 | [source](https://github.com/isaacs/node-glob) |
| `globalthis` | 1.0.4 | MIT | [source](https://github.com/ljharb/System.global) |
| `gopd` | 1.2.0 | MIT | [source](https://github.com/ljharb/gopd) |
| `graceful-fs` | 4.2.12 | BlueOak-1.0.0 | [source](https://github.com/isaacs/node-graceful-fs) |
| `has-bigints` | 1.1.0 | MIT | [source](https://github.com/ljharb/has-bigints) |
| `has-property-descriptors` | 1.0.2 | MIT | [source](https://github.com/inspect-js/has-property-descriptors) |
| `has-proto` | 1.2.0 | MIT | [source](https://github.com/inspect-js/has-proto) |
| `has-symbols` | 1.1.0 | MIT | [source](https://github.com/inspect-js/has-symbols) |
| `has-tostringtag` | 1.0.2 | MIT | [source](https://github.com/inspect-js/has-tostringtag) |
| `hash-wasm` | 4.13.0 | MIT | [source](https://github.com/Daninet/hash-wasm) |
| `hasown` | 2.0.4 | MIT | [source](https://github.com/inspect-js/hasOwn) |
| `html-parse-stringify` | 3.1.0 | MIT | [source](https://github.com/henrikjoreteg/html-parse-stringify) |
| `html-to-image` | 1.11.13 | MIT | [source](https://github.com/bubkoo/html-to-image) |
| `i18next` | 25.10.10 | MIT | [source](https://github.com/i18next/i18next) |
| `ieee754` | 1.2.1 | BSD-3-Clause | [source](https://github.com/feross/ieee754) |
| `immediate` | 3.0.6 | MIT | [source](https://github.com/calvinmetcalf/immediate) |
| `inherits` | 2.0.4 | ISC | [source](https://github.com/isaacs/inherits) |
| `internal-slot` | 1.1.0 | MIT | [source](https://github.com/ljharb/internal-slot) |
| `is-array-buffer` | 3.0.5 | MIT | [source](https://github.com/inspect-js/is-array-buffer) |
| `is-async-function` | 2.1.1 | MIT | [source](https://github.com/inspect-js/is-async-function) |
| `is-bigint` | 1.1.0 | MIT | [source](https://github.com/inspect-js/is-bigint) |
| `is-boolean-object` | 1.2.2 | MIT | [source](https://github.com/inspect-js/is-boolean-object) |
| `is-callable` | 1.2.7 | MIT | [source](https://github.com/inspect-js/is-callable) |
| `is-data-view` | 1.0.2 | MIT | [source](https://github.com/inspect-js/is-data-view) |
| `is-date-object` | 1.1.0 | MIT | [source](https://github.com/inspect-js/is-date-object) |
| `is-document.all` | 1.0.0 | MIT | [source](https://github.com/inspect-js/is-document.all) |
| `is-finalizationregistry` | 1.1.1 | MIT | [source](https://github.com/inspect-js/is-finalizationregistry) |
| `is-generator-function` | 1.1.2 | MIT | [source](https://github.com/inspect-js/is-generator-function) |
| `is-map` | 2.0.3 | MIT | [source](https://github.com/inspect-js/is-map) |
| `is-negative-zero` | 2.0.3 | MIT | [source](https://github.com/inspect-js/is-negative-zero) |
| `is-number-object` | 1.1.1 | MIT | [source](https://github.com/inspect-js/is-number-object) |
| `is-regex` | 1.2.1 | MIT | [source](https://github.com/inspect-js/is-regex) |
| `is-set` | 2.0.3 | MIT | [source](https://github.com/inspect-js/is-set) |
| `is-shared-array-buffer` | 1.0.4 | MIT | [source](https://github.com/inspect-js/is-shared-array-buffer) |
| `is-string` | 1.1.1 | MIT | [source](https://github.com/inspect-js/is-string) |
| `is-symbol` | 1.1.1 | MIT | [source](https://github.com/inspect-js/is-symbol) |
| `is-typed-array` | 1.1.15 | MIT | [source](https://github.com/inspect-js/is-typed-array) |
| `is-weakmap` | 2.0.2 | MIT | [source](https://github.com/inspect-js/is-weakmap) |
| `is-weakref` | 1.1.1 | MIT | [source](https://github.com/inspect-js/is-weakref) |
| `is-weakset` | 2.0.4 | MIT | [source](https://github.com/inspect-js/is-weakset) |
| `isarray` | 2.0.5 | MIT | [source](https://github.com/juliangruber/isarray) |
| `jalaali-js` | 1.2.8 | MIT | [source](https://github.com/jalaali/jalaali-js) |
| `jszip` | 3.10.2 | MIT (chosen from MIT OR GPL-3.0-or-later) | [source](https://github.com/Stuk/jszip) |
| `lazystream` | 1.0.1 | MIT | [source](https://github.com/jpommerening/node-lazystream) |
| `lie` | 3.3.0 | MIT | [source](https://github.com/calvinmetcalf/lie) |
| `listenercount` | 1.0.1 | ISC | [source](https://github.com/jden/node-listenercount) |
| `lodash.defaults` | 4.2.0 | MIT | [source](https://github.com/lodash/lodash) |
| `lodash.difference` | 4.5.0 | MIT | [source](https://github.com/lodash/lodash) |
| `lodash.escaperegexp` | 4.1.2 | MIT | [source](https://github.com/lodash/lodash) |
| `lodash.flatten` | 4.4.0 | MIT | [source](https://github.com/lodash/lodash) |
| `lodash.groupby` | 4.6.0 | MIT | [source](https://github.com/lodash/lodash) |
| `lodash.isboolean` | 3.0.3 | MIT | [source](https://github.com/lodash/lodash) |
| `lodash.isequal` | 4.5.0 | MIT | [source](https://github.com/lodash/lodash) |
| `lodash.isfunction` | 3.0.9 | MIT | [source](https://github.com/lodash/lodash) |
| `lodash.isnil` | 4.0.0 | MIT | [source](https://github.com/lodash/lodash) |
| `lodash.isplainobject` | 4.0.6 | MIT | [source](https://github.com/lodash/lodash) |
| `lodash.isundefined` | 3.0.1 | MIT | [source](https://github.com/lodash/lodash) |
| `lodash.union` | 4.6.0 | MIT | [source](https://github.com/lodash/lodash) |
| `lodash.uniq` | 4.5.0 | MIT | [source](https://github.com/lodash/lodash) |
| `lru-cache` | 5.1.1 | ISC | [source](https://github.com/isaacs/node-lru-cache) |
| `math-intrinsics` | 1.1.0 | MIT | [source](https://github.com/es-shims/math-intrinsics) |
| `minimatch` | 11.0.9 | BlueOak-1.0.0 | [source](https://github.com/isaacs/minimatch) |
| `minimist` | 1.2.8 | MIT | [source](https://github.com/minimistjs/minimist) |
| `minipass` | 7.1.3 | BlueOak-1.0.0 | [source](https://github.com/isaacs/minipass) |
| `mkdirp` | 0.5.6 | MIT | [source](https://github.com/substack/node-mkdirp) |
| `motion-dom` | 12.43.0 | MIT | [source](https://github.com/motiondivision/motion) |
| `motion-utils` | 12.39.0 | MIT | [source](https://github.com/motiondivision/motion) |
| `normalize-path` | 3.0.0 | MIT | [source](https://github.com/jonschlinkert/normalize-path) |
| `object-inspect` | 1.14.0 | MIT | [source](ssh://github.com/inspect-js/object-inspect) |
| `object-keys` | 1.1.1 | MIT | [source](https://github.com/ljharb/object-keys) |
| `object.assign` | 4.1.7 | MIT | [source](https://github.com/ljharb/object.assign) |
| `once` | 1.4.0 | ISC | [source](https://github.com/isaacs/once) |
| `own-keys` | 1.0.2 | MIT | [source](https://github.com/ljharb/own-keys) |
| `package-json-from-dist` | 1.0.1 | BlueOak-1.0.0 | [source](https://github.com/isaacs/package-json-from-dist) |
| `pako` | 1.0.11 | (MIT AND Zlib) | [source](https://github.com/nodeca/pako) |
| `path-scurry` | 3.0.0 | BlueOak-1.0.0 | [source](https://github.com/isaacs/path-scurry) |
| `possible-typed-array-names` | 1.1.0 | MIT | [source](https://github.com/ljharb/possible-typed-array-names) |
| `react` | 19.3.1 | MIT | [source](https://github.com/react/react) |
| `react-dom` | 19.3.1 | MIT | [source](https://github.com/react/react) |
| `react-i18next` | 15.7.4 | MIT | [source](https://github.com/i18next/react-i18next) |
| `react-router` | 7.18.6 | MIT | [source](https://github.com/remix-run/react-router) |
| `readable-stream` | 3.6.2 | MIT | [source](https://github.com/nodejs/readable-stream) |
| `readdir-glob` | 1.1.3 | Apache-2.0 | [source](https://github.com/Yqnn/node-readdir-glob) |
| `reflect.getprototypeof` | 1.0.10 | MIT | [source](https://github.com/es-shims/Reflect.getPrototypeOf) |
| `regexp.prototype.flags` | 1.5.4 | MIT | [source](https://github.com/es-shims/RegExp.prototype.flags) |
| `rimraf` | 6.1.4 | BlueOak-1.0.0 | [source](https://github.com/isaacs/rimraf) |
| `safe-array-concat` | 1.1.4 | MIT | [source](https://github.com/ljharb/safe-array-concat) |
| `safe-buffer` | 5.2.1 | MIT | [source](https://github.com/feross/safe-buffer) |
| `safe-push-apply` | 1.0.0 | MIT | [source](https://github.com/ljharb/safe-push-apply) |
| `safe-regex-test` | 1.1.0 | MIT | [source](https://github.com/ljharb/safe-regex-test) |
| `saxes` | 6.0.0 | ISC | [source](https://github.com/lddubeau/saxes) |
| `scheduler` | 0.28.0 | MIT | [source](https://github.com/react/react) |
| `set-cookie-parser` | 2.7.3 | MIT | [source](https://github.com/nfriedly/set-cookie-parser) |
| `set-function-length` | 1.2.2 | MIT | [source](https://github.com/ljharb/set-function-length) |
| `set-function-name` | 2.0.2 | MIT | [source](https://github.com/ljharb/set-function-name) |
| `set-proto` | 1.0.0 | MIT | [source](https://github.com/ljharb/set-proto) |
| `setimmediate` | 1.0.5 | MIT | [source](https://github.com/YuzuJS/setImmediate) |
| `side-channel` | 1.1.1 | MIT | [source](https://github.com/ljharb/side-channel) |
| `side-channel-list` | 1.0.1 | MIT | [source](https://github.com/ljharb/side-channel-list) |
| `side-channel-map` | 1.0.1 | MIT | [source](https://github.com/ljharb/side-channel-map) |
| `side-channel-weakmap` | 1.0.2 | MIT | [source](https://github.com/ljharb/side-channel-weakmap) |
| `stop-iteration-iterator` | 1.1.0 | MIT | [source](https://github.com/ljharb/stop-iteration-iterator) |
| `string_decoder` | 1.3.0 | MIT | [source](https://github.com/nodejs/string_decoder) |
| `string.prototype.trim` | 1.2.11 | MIT | [source](https://github.com/es-shims/String.prototype.trim) |
| `string.prototype.trimend` | 1.0.10 | MIT | [source](https://github.com/es-shims/String.prototype.trimEnd) |
| `string.prototype.trimstart` | 1.0.8 | MIT | [source](https://github.com/es-shims/String.prototype.trimStart) |
| `tar-stream` | 2.2.0 | MIT | [source](https://github.com/mafintosh/tar-stream) |
| `tmp` | 0.2.7 | MIT | [source](https://github.com/raszi/node-tmp) |
| `traverse` | 0.3.10 | MIT | [source](https://github.com/ljharb/js-traverse) |
| `tslib` | 2.9.1 | 0BSD | [source](https://github.com/Microsoft/tslib) |
| `typed-array-buffer` | 1.0.3 | MIT | [source](https://github.com/inspect-js/typed-array-buffer) |
| `typed-array-byte-length` | 1.0.3 | MIT | [source](https://github.com/inspect-js/typed-array-byte-length) |
| `typed-array-byte-offset` | 1.0.5 | MIT | [source](https://github.com/inspect-js/typed-array-byte-offset) |
| `typed-array-length` | 1.0.8 | MIT | [source](https://github.com/inspect-js/typed-array-length) |
| `typedarray.prototype.slice` | 1.0.6 | MIT | [source](https://github.com/es-shims/TypedArray.prototype.slice) |
| `unbox-primitive` | 1.1.0 | MIT | [source](https://github.com/ljharb/unbox-primitive) |
| `undici-types` | 8.9.0 | MIT | [source](https://github.com/nodejs/undici) |
| `unzipper` | 0.10.14 | MIT | [source](https://github.com/ZJONSSON/node-unzipper) |
| `uqr` | 0.1.3 | MIT | [source](https://github.com/unjs/uqr) |
| `util-deprecate` | 1.0.2 | MIT | [source](https://github.com/TooTallNate/util-deprecate) |
| `uuid` | 8.3.2 | MIT | [source](https://github.com/uuidjs/uuid) |
| `void-elements` | 3.1.0 | MIT | [source](https://github.com/pugjs/void-elements) |
| `which-boxed-primitive` | 1.1.1 | MIT | [source](https://github.com/inspect-js/which-boxed-primitive) |
| `which-builtin-type` | 1.2.1 | MIT | [source](https://github.com/inspect-js/which-builtin-type) |
| `which-collection` | 1.0.2 | MIT | [source](https://github.com/inspect-js/which-collection) |
| `which-typed-array` | 1.1.24 | MIT | [source](https://github.com/inspect-js/which-typed-array) |
| `wrappy` | 1.0.2 | ISC | [source](https://github.com/npm/wrappy) |
| `xmlchars` | 2.2.0 | MIT | [source](https://github.com/lddubeau/xmlchars) |
| `yallist` | 3.1.1 | ISC | [source](https://github.com/isaacs/yallist) |
| `zip-stream` | 4.1.1 | MIT | [source](https://github.com/archiverjs/node-zip-stream) |
| `zustand` | 5.1.0 | MIT | [source](https://github.com/pmndrs/zustand) |
