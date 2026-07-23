import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inferSkillName, parseSkillsAddCommand } from './parse-command'

test('parses a full npx skills add command with --skill', () => {
  const parsed = parseSkillsAddCommand(
    'npx skills add https://github.com/larashero3-dotcom/lieflat-charts --skill lieflat-charts',
  )
  assert.deepEqual(parsed, {
    package: 'https://github.com/larashero3-dotcom/lieflat-charts',
    skill: 'lieflat-charts',
    global: false,
  })
})

test('parses a bare skills add command', () => {
  const parsed = parseSkillsAddCommand('skills add owner/repo')
  assert.deepEqual(parsed, { package: 'owner/repo', skill: undefined, global: false })
})

test('supports the `a` alias and `-s` short flag', () => {
  const parsed = parseSkillsAddCommand('skills a owner/repo -s my-skill')
  assert.equal(parsed?.package, 'owner/repo')
  assert.equal(parsed?.skill, 'my-skill')
})

test('supports --skill=value and -s=value forms', () => {
  assert.equal(parseSkillsAddCommand('skills add owner/repo --skill=alpha')?.skill, 'alpha')
  assert.equal(parseSkillsAddCommand('skills add owner/repo -s=beta')?.skill, 'beta')
})

test('skips runner flags before the binary (npx -y skills)', () => {
  const parsed = parseSkillsAddCommand('npx -y skills add owner/repo --skill gamma')
  assert.equal(parsed?.package, 'owner/repo')
  assert.equal(parsed?.skill, 'gamma')
})

test('handles pnpm dlx runner', () => {
  const parsed = parseSkillsAddCommand('pnpm dlx skills add owner/repo')
  assert.equal(parsed?.package, 'owner/repo')
})

test('detects the global flag', () => {
  assert.equal(parseSkillsAddCommand('skills add owner/repo -g')?.global, true)
  assert.equal(parseSkillsAddCommand('skills add owner/repo --global')?.global, true)
  assert.equal(parseSkillsAddCommand('skills add owner/repo')?.global, false)
})

test('does not treat a value-flag argument as the package spec', () => {
  const parsed = parseSkillsAddCommand('skills add --skill my-skill owner/repo --copy -y')
  assert.equal(parsed?.package, 'owner/repo')
  assert.equal(parsed?.skill, 'my-skill')
})

test('keeps quoted metadata intact and ignores it', () => {
  const parsed = parseSkillsAddCommand(
    'skills add owner/repo --metadata \'{"channel":"beta"}\' --skill x',
  )
  assert.equal(parsed?.package, 'owner/repo')
  assert.equal(parsed?.skill, 'x')
})

test('returns null for non skills-add commands', () => {
  assert.equal(parseSkillsAddCommand('skills find charts'), null)
  assert.equal(parseSkillsAddCommand('npm install foo'), null)
  assert.equal(parseSkillsAddCommand(''), null)
  assert.equal(parseSkillsAddCommand('skills add'), null)
})

test('inferSkillName prefers the --skill selector', () => {
  const parsed = parseSkillsAddCommand(
    'skills add https://github.com/owner/repo --skill chosen-one',
  )
  assert.equal(inferSkillName(parsed!), 'chosen-one')
})

test('inferSkillName falls back to the repo name', () => {
  assert.equal(
    inferSkillName({ package: 'https://github.com/owner/lieflat-charts', global: false }),
    'lieflat-charts',
  )
  assert.equal(inferSkillName({ package: 'owner/repo.git', global: false }), 'repo')
  assert.equal(inferSkillName({ package: 'owner/repo/', global: false }), 'repo')
})
