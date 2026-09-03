import { anthropicModel, scriptedModel, type ModelClient } from './model'
import { geminiModel } from './gemini'
import { DEMO_SCRIPT } from './demo-script'

/**
 * Picks the model the console runs against.
 *
 * Order of preference:
 *   1. DEMO_MODE=scripted            the on-camera fallback, always wins
 *   2. AGENT_PROVIDER, if set        explicit override: "gemini" or "anthropic"
 *   3. whichever key is present      Gemini first, since it has a free tier
 *   4. scripted                      so the product is demonstrable with no keys
 *
 * Whatever is chosen, the policy engine, the ledger and the Razorpay orders are
 * real. The only thing that changes is who decides what to shop for.
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

function geminiKey(): boolean {
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
  return Boolean(key && key.length > 20 && !key.includes('...'))
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
  const delayMs = Number(process.env.DEMO_TURN_DELAY_MS ?? 1600)
  return { model: scriptedModel(DEMO_SCRIPT, { delayMs }), scripted: true, provider }
}
