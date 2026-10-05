import { parseForNative } from './parserBridge'

/**
 * Entry point of android/app/src/main/assets/sms-parser.js, built by
 * scripts/build-sms-parser.mjs and evaluated by the SMS receiver in a
 * JavaScriptSandbox. Not part of the web app.
 *
 * The sandbox is plain ECMAScript. If its engine was built without ICU,
 * `String.prototype.normalize` is missing; parsing then goes ahead without
 * NFKC folding (full-width digits stay unfolded) rather than failing outright.
 */
if (typeof String.prototype.normalize !== 'function') {
  Object.defineProperty(String.prototype, 'normalize', {
    value(this: string) {
      return String(this)
    },
  })
}

Object.defineProperty(globalThis, 'MoneyMattersSms', {
  value: Object.freeze({ version: 1, parse: parseForNative }),
})
