import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SPRITE_KEYS, spriteFrame, spriteKeyOf } from '../hooks/sprites.ts'

test('every sprite composes an 18x32 frame with opaque pixels', () => {
  assert.equal(SPRITE_KEYS.length, 9)
  for (const key of SPRITE_KEYS) {
    const f = spriteFrame(key)
    assert.equal(f.w, 18)
    assert.equal(f.h, 32)
    assert.equal(f.data.length, 18 * 32 * 4)
    let opaque = 0
    for (let i = 3; i < f.data.length; i += 4) if (f.data[i] === 255) opaque++
    assert.ok(opaque > 100)
  }
})

test('sprites differ from one another', () => {
  const seen = new Set(SPRITE_KEYS.map(k => Array.from(spriteFrame(k).data).join(',')))
  assert.equal(seen.size, 9)
})

test('frames are cached', () => {
  assert.equal(spriteFrame('implementer'), spriteFrame('implementer'))
})

test('agent types map to sprites, everything unknown to other', () => {
  assert.equal(spriteKeyOf('main'), 'boss')
  assert.equal(spriteKeyOf('implementer'), 'implementer')
  assert.equal(spriteKeyOf('device-checker'), 'device-checker')
  assert.equal(spriteKeyOf('Explore'), 'other')
  assert.equal(spriteKeyOf('general-purpose'), 'other')
  assert.equal(spriteKeyOf(''), 'other')
})
