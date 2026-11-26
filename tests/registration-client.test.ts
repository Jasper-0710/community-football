import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { buildSync } from 'esbuild'
import { parseFileLink } from '../src/domain/registration'

const compiled = buildSync({ entryPoints: ['src/domain/registration.ts'], bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text
const nativeModule = { exports: {} as typeof import('../src/domain/registration') }
vm.runInNewContext(compiled, { module: nativeModule, exports: nativeModule.exports })
const link = {
  url: 'https://bucket.example.test/registration-materials/material.pdf?sign=abc%2F123%2B456&expires=1795708800',
  name: '参赛材料.pdf',
  extension: 'pdf',
}

for (const [runtime, parse] of [['browser', parseFileLink], ['native without URL', nativeModule.exports.parseFileLink]] as const) {
  test(`${runtime}: registration attachment links preserve signed URLs for all supported formats`, () => {
    for (const extension of ['pdf', 'png', 'jpg', 'jpeg', 'docx', 'xlsx']) {
      const input = { ...link, extension, name: `参赛材料.${extension}` }
      const result = parse(input)
      assert.equal(result.url, input.url)
      assert.equal(result.name, input.name)
      assert.equal(result.extension, extension)
    }
  })

  test(`${runtime}: registration attachment links reject unsafe addresses`, () => {
    for (const url of [
      'http://example.test/a', 'javascript:alert(1)', 'https://user:secret@example.test/a',
      'https://example.test/a#fragment', 'https://example.test:99999/a',
      'https://example.test\\@other.test/a', 'https://example.test/a\n', '',
    ]) assert.throws(() => parse({ ...link, url }), { code: 'INVALID_RESPONSE' })
  })

  test(`${runtime}: malformed attachment links return a consistent service error`, () => {
    for (const input of [null, undefined, [], {}, { ...link, url: 1 }, { ...link, name: '' }, { ...link, name: ' ' }, { ...link, extension: 'exe' }]) {
      assert.throws(() => parse(input), { code: 'INVALID_RESPONSE' })
    }
  })
}
