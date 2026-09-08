import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

test('briefing uses loaded metric date rather than an unapplied filter', async () => {
  const source = readFileSync(
    new URL('../src/components/BossSummary.vue', import.meta.url),
    'utf8',
  )
  const method = source.slice(
    source.indexOf('async function generate()'),
    source.indexOf('\nfunction open('),
  )
  const js = ts.transpileModule(method, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const data = { value: { date: '2026-09-08' } },
    day = { value: '2026-09-07' }
  const briefing = { value: null },
    calls = []
  const api = async (path, method, body) => {
    calls.push({ path, method, body })
    return { date: body.date, text: 'test' }
  }
  const generate = new Function(
    'data',
    'day',
    'loading',
    'generating',
    'notice',
    'briefing',
    'api',
    js + ';return generate',
  )(data, day, { value: false }, { value: false }, { value: '' }, briefing, api)
  await generate()
  assert.equal(calls[0].body.date, data.value.date)
  assert.equal(briefing.value.date, data.value.date)
})
