/**
 * Money helpers. INVARIANT: every amount in this codebase is an integer of PAISE.
 * Never a float. Never a rupee value. Never a string. Floats lose money.
 */
export type Paise = number

export function formatINR(paise: Paise): string {
  const rupees = paise / 100
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(rupees)
}

export function rupeesToPaise(rupees: number): Paise {
  return Math.round(rupees * 100)
}

export function assertPaise(value: unknown): asserts value is Paise {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`Invalid paise amount: ${String(value)} (must be a non-negative integer)`)
  }
}
