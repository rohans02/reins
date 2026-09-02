import { anthropicModel, scriptedModel, type ModelClient } from './model'
import { DEMO_SCRIPT } from './demo-script'

/**
 * Picks the model the console will run against.
 *
 * Scripted when explicitly requested (DEMO_MODE=scripted, the on-camera
 * fallback) or when no API key is configured — so the product is fully
 * demonstrable before anyone has bought credit, rather than showing an error.
 *
 * Either way the policy engine, the ledger and Razorpay are real. The only thing
 * that changes is who decides what to shop for.
 */
/**
 * A key is only usable if it looks like one. The placeholder shipped in
 * .env.example ("sk-ant-...") is truthy, so a bare presence check sends the run
 * to the real client and returns a 401 — which reads like a broken product
 * rather than an unconfigured one.
 */
function hasUsableApiKey(): boolean {
  const key = process.env.ANTHROPIC_API_KEY
  return Boolean(key && key.startsWith('sk-ant-') && key.length > 24 && !key.includes('...'))
}

export function selectModel(): { model: ModelClient; scripted: boolean } {
  const scripted = process.env.DEMO_MODE === 'scripted' || !hasUsableApiKey()

  // Paced so the run is watchable and leaves a window to hit Revoke mid-run.
  const delayMs = Number(process.env.DEMO_TURN_DELAY_MS ?? 1600)

  return scripted
    ? { model: scriptedModel(DEMO_SCRIPT, { delayMs }), scripted: true }
    : { model: anthropicModel(), scripted: false }
}
