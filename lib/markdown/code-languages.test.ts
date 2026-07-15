import assert from 'node:assert/strict'
import test from 'node:test'
import { codeLanguageLabel, normalizeCodeLanguage } from './code-languages'

test('normalizes common fenced-code language aliases', () => {
  assert.equal(normalizeCodeLanguage('js'), 'javascript')
  assert.equal(normalizeCodeLanguage('TS'), 'typescript')
  assert.equal(normalizeCodeLanguage('language-py'), 'python')
  assert.equal(normalizeCodeLanguage('c++'), 'cpp')
  assert.equal(normalizeCodeLanguage('shell'), 'bash')
  assert.equal(normalizeCodeLanguage('yml'), 'yaml')
})

test('falls back to plain text for missing and unsupported languages', () => {
  assert.equal(normalizeCodeLanguage(), 'text')
  assert.equal(normalizeCodeLanguage('unknown-language'), 'text')
  assert.equal(codeLanguageLabel(), 'Plain text')
  assert.equal(codeLanguageLabel('unknown-language'), 'unknown-language')
})

test('uses readable labels for normalized languages', () => {
  assert.equal(codeLanguageLabel('ts'), 'TypeScript')
  assert.equal(codeLanguageLabel('c#'), 'C#')
  assert.equal(codeLanguageLabel('graphql'), 'GraphQL')
})
