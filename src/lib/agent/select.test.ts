import { afterEach, describe, expect, it } from 'vitest'
import { selectProvider } from './select'

/**
 * Provider selection has to fail SAFE. Getting it wrong sends a run to a live
 * client with a placeholder key and returns a 401, which reads like a broken
 * product rather than an unconfigured one — that exact bug shipped once already.
 */

const KEYS = ['DEMO_MODE', 'AGENT_PROVIDER', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_API_KEY']
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))

function setEnv(env: Record<string, string | undefined>) {
  for (const k of KEYS) delete process.env[k]
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v
}

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

const REAL_GEMINI = 'AIzaSyEXAMPLEEXAMPLEEXAMPLEEXAMPLE'
const REAL_ANTHROPIC = 'sk-ant-api03-EXAMPLEEXAMPLEEXAMPLE'

describe('provider selection', () => {
  it('falls back to scripted when nothing is configured', () => {
    setEnv({})
    expect(selectProvider()).toBe('scripted')
  })

  it('treats the .env.example placeholders as unconfigured', () => {
    setEnv({ ANTHROPIC_API_KEY: 'sk-ant-...', GEMINI_API_KEY: '...' })
    expect(selectProvider()).toBe('scripted')
  })

  it('prefers gemini when both keys are present, because it has a free tier', () => {
    setEnv({ GEMINI_API_KEY: REAL_GEMINI, ANTHROPIC_API_KEY: REAL_ANTHROPIC })
    expect(selectProvider()).toBe('gemini')
  })

  it('uses anthropic when only that key is present', () => {
    setEnv({ ANTHROPIC_API_KEY: REAL_ANTHROPIC })
    expect(selectProvider()).toBe('anthropic')
  })

  it('accepts GOOGLE_API_KEY as an alias', () => {
    setEnv({ GOOGLE_API_KEY: REAL_GEMINI })
    expect(selectProvider()).toBe('gemini')
  })

  it('honours an explicit AGENT_PROVIDER override', () => {
    setEnv({ AGENT_PROVIDER: 'anthropic', GEMINI_API_KEY: REAL_GEMINI, ANTHROPIC_API_KEY: REAL_ANTHROPIC })
    expect(selectProvider()).toBe('anthropic')
  })

  it('falls back to scripted if the forced provider has no usable key', () => {
    setEnv({ AGENT_PROVIDER: 'gemini', ANTHROPIC_API_KEY: REAL_ANTHROPIC })
    expect(selectProvider()).toBe('scripted')
  })

  it('lets DEMO_MODE=scripted win over every configured key', () => {
    setEnv({ DEMO_MODE: 'scripted', GEMINI_API_KEY: REAL_GEMINI, ANTHROPIC_API_KEY: REAL_ANTHROPIC })
    expect(selectProvider()).toBe('scripted')
  })
})
