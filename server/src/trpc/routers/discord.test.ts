import assert from 'node:assert/strict'
import { test } from 'node:test'
import { presenceInput } from './discord.js'

const parse = async (value: unknown) => {
  const result = await presenceInput()['~standard'].validate(value)
  assert.ok('value' in result)
  return result.value
}

test('the presence input keeps the known fields and drops the rest', async () => {
  const parsed = await parse({
    title: 'Show',
    episodeLabel: 'S01E02',
    isPlaying: true,
    isAdult: false,
    currentTime: 12.5,
    duration: '90',
    thumbnails: ['a', '', 'b'],
    sessionId: 'abc',
    somethingElse: 'dropped',
  })
  assert.deepEqual(parsed, {
    title: 'Show',
    episodeLabel: 'S01E02',
    isPlaying: true,
    isAdult: false,
    currentTime: 12.5,
    duration: 90,
    thumbnails: ['a', 'b'],
    sessionId: 'abc',
  })
})

test('the presence input takes an empty object and never a number', async () => {
  assert.deepEqual(await parse({}), {})
  assert.deepEqual(await parse(undefined), {})
  const bad = await presenceInput()['~standard'].validate(42)
  assert.ok('issues' in bad)
})
