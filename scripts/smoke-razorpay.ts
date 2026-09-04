import 'dotenv/config'
import Razorpay from 'razorpay'

/**
 * Day-2 gate de-risker: proves the Razorpay Orders API works with these test-mode
 * keys BEFORE the agent depends on it. Creates one throwaway test-mode order
 * (no real money, no real merchant impact) and reads it back.
 *
 * Run: npx tsx scripts/smoke-razorpay.ts
 */
async function main() {
  const key_id = process.env.RAZORPAY_KEY_ID
  const key_secret = process.env.RAZORPAY_KEY_SECRET
  if (!key_id || !key_secret) throw new Error('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set')
  if (!key_id.startsWith('rzp_test_')) {
    throw new Error(`Refusing to run: key_id is not a test key (${key_id.slice(0, 9)}...)`)
  }

  const rzp = new Razorpay({ key_id, key_secret })

  console.log('1. Creating test-mode order (Rs 285.00 = 28500 paise)...')
  const order = await rzp.orders.create({
    amount: 28500, // paise — matches our money invariant
    currency: 'INR',
    receipt: `smoke-${Date.now()}`,
    notes: { source: 'reins-smoke-test' },
  })
  console.log(`   OK  id=${order.id}  status=${order.status}  amount=${order.amount}`)

  console.log('2. Fetching it back...')
  const fetched = await rzp.orders.fetch(order.id)
  console.log(`   OK  id=${fetched.id}  status=${fetched.status}`)

  console.log('\nORDERS API IS CLEAR — the Day-2 critical path is not blocked by KYC.')
}

main().catch((e: unknown) => {
  const err = e as { statusCode?: number; error?: { code?: string; description?: string } }
  console.error('\nSMOKE TEST FAILED')
  if (err.statusCode) console.error(`  HTTP ${err.statusCode}`)
  if (err.error?.code) console.error(`  code: ${err.error.code}`)
  if (err.error?.description) console.error(`  description: ${err.error.description}`)
  if (!err.statusCode && !err.error) console.error(' ', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
