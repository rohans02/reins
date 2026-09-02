import Razorpay from 'razorpay'

/**
 * Razorpay Node SDK singleton. TEST MODE ONLY.
 *
 * Never import this from a client component — it holds the key secret.
 *
 * Constructed lazily so importing this module does not throw in environments
 * that never touch Razorpay (unit tests, the policy engine, a fresh clone with
 * no .env). The credentials are only required at first use.
 */
let client: Razorpay | undefined

export function razorpayClient(): Razorpay {
  if (client) return client

  const key_id = process.env.RAZORPAY_KEY_ID
  const key_secret = process.env.RAZORPAY_KEY_SECRET

  if (!key_id || !key_secret) {
    throw new Error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set (see .env.example)')
  }

  // A live key here would move real money. The prototype has no business
  // touching one, so refuse rather than trust the operator to have been careful.
  if (!key_id.startsWith('rzp_test_')) {
    throw new Error(`Refusing to run against a non-test Razorpay key (${key_id.slice(0, 9)}...)`)
  }

  client = new Razorpay({ key_id, key_secret })
  return client
}
