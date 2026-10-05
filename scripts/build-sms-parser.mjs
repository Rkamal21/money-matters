#!/usr/bin/env node
/**
 * Builds android/app/src/main/assets/sms-parser.js — the transaction parser
 * (src/domain/transactions/ingest) compiled for the Android SMS receiver, which
 * evaluates it in a JavaScriptSandbox when an SMS arrives, even with the app
 * closed. Same TypeScript as the app's parser: there is no second parser.
 *
 * Run by `npm run build:sms-parser` and `npm run cap:sync`. The output is
 * generated and gitignored (android/.gitignore); the receiver treats a missing
 * file as "detection unavailable", never as a crash.
 *
 * `buildSmsParser({ write: false })` returns the bundle in memory, which is how
 * src/platform/sms/nativeBundle.test.ts checks the exact code the phone runs.
 */
import { fileURLToPath } from 'node:url'

import { build } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

export async function buildSmsParser({ write = true } = {}) {
  const output = await build({
    configFile: false,
    root: ROOT,
    logLevel: write ? 'info' : 'silent',
    publicDir: false,
    resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
    build: {
      lib: {
        entry: 'src/platform/sms/nativeEntry.ts',
        formats: ['iife'],
        name: 'MoneyMattersSmsBundle',
        fileName: () => 'sms-parser.js',
      },
      outDir: 'android/app/src/main/assets',
      emptyOutDir: false,
      copyPublicDir: false,
      write,
      minify: true,
      sourcemap: false,
      target: 'es2020',
    },
  })
  const results = Array.isArray(output) ? output : [output]
  const chunk = results
    .flatMap((result) => ('output' in result ? result.output : []))
    .find((item) => item.type === 'chunk')
  if (chunk === undefined) throw new Error('build-sms-parser: no bundle produced')
  return chunk.code
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const code = await buildSmsParser()
  console.log(`build-sms-parser: ${(code.length / 1024).toFixed(1)} KB`)
}
