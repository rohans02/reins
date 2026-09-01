// Tests are hermetic: they never read .env. A fixed signing key keeps every
// signature assertion reproducible on any machine, including a judge's clone.
process.env.MANDATE_SIGNING_KEY ??= 'test-signing-key-not-for-production'
