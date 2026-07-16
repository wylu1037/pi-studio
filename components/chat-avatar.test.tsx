import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatAvatar } from './chat-avatar'

test('renders notion-style user avatar presets through the avatar fallback', () => {
  const markup = renderToStaticMarkup(<ChatAvatar role="user" preset="notion-glasses" />)
  assert.match(markup, /data-slot="avatar"/)
  assert.match(markup, /data-slot="avatar-fallback"/)
  assert.match(markup, /<rect[^>]+x="20"[^>]+y="31"/)
})

test('renders pi and robot assistant avatar presets', () => {
  const pi = renderToStaticMarkup(<ChatAvatar role="assistant" preset="pi" />)
  const robot = renderToStaticMarkup(<ChatAvatar role="assistant" preset="robot" />)
  assert.match(pi, /viewBox="0 0 800 800"/)
  assert.match(robot, /viewBox="0 0 64 64"/)
  assert.match(robot, /<rect[^>]+x="15"[^>]+y="18"/)
})
