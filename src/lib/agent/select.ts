import { anthropicModel, scriptedModel, type ModelClient } from './model'
import { geminiConfigured, geminiModel } from './gemini'
import { DEMO_SCRIPT } from './demo-script'

/**
 * Picks the model the console runs against.
 */

/**
 * A key is only usable if it looks like one. The placeholders in .env.example are
 * truthy, and a bare presence check would send the run to a live client and
 * return a 401, which reads like a broken product rather than an unconfigured one.
 */
function anthropicKey(): boolean {
  const key = process.env.ANTHROPIC_API_KEY
  return Boolean(key && key.startsWith('sk-ant-') && key.length > 24 && !key.includes('...'))
}

// Either an AI Studio API key or a Vertex AI project counts as configured.
function geminiKey(): boolean {
  return geminiConfigured()
}

export type Provider = 'scripted' | 'gemini' | 'anthropic'

export function selectProvider(): Provider {
  if (process.env.DEMO_MODE === 'scripted') return 'scripted'

  const forced = process.env.AGENT_PROVIDER
  if (forced === 'gemini') return geminiKey() ? 'gemini' : 'scripted'
  if (forced === 'anthropic') return anthropicKey() ? 'anthropic' : 'scripted'

  if (geminiKey()) return 'gemini'
  if (anthropicKey()) return 'anthropic'
  return 'scripted'
}

export function selectModel(): { model: ModelClient; scripted: boolean; provider: Provider } {
  const provider = selectProvider()

  if (provider === 'gemini') {
    return { model: geminiModel(), scripted: false, provider }
  }

  if (provider === 'anthropic') {
    return { model: anthropicModel(), scripted: false, provider }
  }

  // Paced so the run is watchable and leaves a window to hit Revoke mid-run.
  // 1400, not 1600: the plan turn added a step, and the whole run has to stay
  // comfortably inside twenty seconds.
  const delayMs = Number(process.env.DEMO_TURN_DELAY_MS ?? 1400)
  return { model: scriptedModel(DEMO_SCRIPT, { delayMs }), scripted: true, provider }
}
