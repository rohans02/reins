import 'dotenv/config'
import { GoogleGenAI } from '@google/genai'
import {
  geminiApiKey,
  geminiLocation,
  geminiModelId,
  geminiVertexProject,
} from '../src/lib/agent/gemini'
import { selectProvider } from '../src/lib/agent/select'

/**
 * Smallest possible live call, to prove the model provider is reachable before
 * anything depends on it.
 *
 * Run: npm run smoke:gemini
 *
 * Kept separate from the agent smoke tests on purpose. When a run fails you want
 * to know immediately whether it was the credentials, the project, the region or
 * your own prompt, and this answers the first three in one call.
 */
async function main() {
  const apiKey = geminiApiKey()
  const project = geminiVertexProject()
  const location = geminiLocation()
  const model = geminiModelId()

  console.log('provider selected :', selectProvider())
  console.log('transport         :', apiKey ? 'AI Studio API key' : 'Vertex AI (ADC)')
  if (!apiKey) {
    console.log('project           :', project ?? '(none)')
    console.log('location          :', location)
  }
  console.log('model             :', model)
  console.log()

  if (!apiKey && !project) {
    console.error(
      'Nothing is configured.\n\n' +
        '  Free tier : set GEMINI_API_KEY from https://aistudio.google.com/apikey\n' +
        '  Vertex AI : set GOOGLE_CLOUD_PROJECT and run\n' +
        '              gcloud auth application-default login\n',
    )
    process.exit(1)
  }

  const ai = apiKey
    ? new GoogleGenAI({ apiKey })
    : new GoogleGenAI({ vertexai: true, project, location })

  const startedAt = Date.now()
  const res = await ai.models.generateContent({
    model,
    contents: 'Reply with exactly: Reins connectivity check OK',
  })
  const elapsed = Date.now() - startedAt

  console.log('response          :', (res.text ?? '').trim())
  console.log('round trip        :', elapsed + 'ms')
  console.log('\nGEMINI OK — the provider is reachable.')
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error('\nGEMINI CHECK FAILED\n')
  console.error(message + '\n')

  // The three failures that actually happen, and what each one means.
  if (/could not load the default credentials|Unable to authenticate/i.test(message)) {
    console.error(
      'Application Default Credentials are missing. Run:\n' +
        '  gcloud auth application-default login\n',
    )
  } else if (/SERVICE_DISABLED|has not been used in project|aiplatform/i.test(message)) {
    console.error(
      'The Vertex AI API is not enabled on this project. Run:\n' +
        '  gcloud services enable aiplatform.googleapis.com\n',
    )
  } else if (/not found|NOT_FOUND|is not supported|was not found/i.test(message)) {
    console.error(
      `Model "${geminiModelId()}" is not available here.\n` +
        'Set GEMINI_MODEL in .env to one your project serves, or try a different\n' +
        'GOOGLE_CLOUD_LOCATION (us-central1 is a safe bet if "global" fails).\n',
    )
  }

  process.exit(1)
})
