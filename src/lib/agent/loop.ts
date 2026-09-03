import type Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/db'
import { canonicalHash } from '@/lib/mandate/canonical'
import { MandateRulesSchema, type ProposedAction } from '@/lib/mandate/schema'
import { append } from '@/lib/ledger/append'
import { authorizeAndExecute, loadLedgerState } from '@/lib/authorize'
import { AGENT_TOOLS, TOOL_NAMES } from './tools'
import { buyerAgentSystemPrompt, wrapUntrusted, type PastPurchase } from './prompts'
import type { CheckResult } from '@/lib/policy/engine'
import type { ModelClient, ToolUse } from './model'

/**
 * The buyer agent loop. Hand-written on purpose — not LangGraph (Python-first,
 * wrong stack) and not the SDK tool runner, because a loop you can walk a panel
 * through line by line is the stronger signal, and because every turn has to
 * emit a ledger row and a UI event anyway.
 *
 * GUARDRAILS ON THE AGENT ITSELF, distinct from the guardrails on the money:
 *   - MAX_TURNS caps reasoning steps
 *   - MAX_WALL_CLOCK_MS caps elapsed time
 * A runaway loop is its own failure mode, separate from overspend, and a demo
 * that hangs is a demo that failed.
 */

/**
 * One entry in a run's persisted transcript.
 *
 * Verdicts are stored as a `seq` reference rather than a copy — the ledger is
 * the record of what was decided, and duplicating it here would create a second
 * version of the truth that could drift.
 */
export type TranscriptEntry =
  | { t: 'say'; text: string }
  | { t: 'tool'; name: string; input: Record<string, unknown> }
  | { t: 'verdict'; seq: number }
  | { t: 'system'; text: string }

export const MAX_TURNS = 12
export const MAX_WALL_CLOCK_MS = 90_000

export type AgentEvent =
  | { type: 'started'; runId: string; model: string }
  | { type: 'text'; text: string }
  | { type: 'tool_call'; name: string; input: Record<string, unknown> }
  | {
      type: 'decision'
      seq: number
      decisionId: string
      verdict: string
      reasonCodes: string[]
      /** Every check that ran, passed and failed — drives the pipeline strip. */
      checks: CheckResult[]
      merchantId: string
      itemId: string
      amountPaise: number
      latencyMs: number
    }
  | { type: 'purchase'; razorpayOrderId: string; amountPaise: number }
  | { type: 'error'; message: string }
  | {
      type: 'done'
      reason: 'completed' | 'turn_cap' | 'wall_clock' | 'error'
      purchases: number
      blocked: number
      authorizedPaise: number
    }

export interface RunAgentOptions {
  mandateId: string
  task: string
  model: ModelClient
  /** Seam so tests can run the full loop without touching Razorpay. */
  executePurchase?: (decisionId: string) => Promise<{ razorpayOrderId: string }>
  now?: () => Date
}

export async function* runAgent(opts: RunAgentOptions): AsyncGenerator<AgentEvent> {
  const { mandateId, task, model } = opts
  const now = opts.now ?? (() => new Date())

  const mandate = await prisma.mandate.findUniqueOrThrow({ where: { id: mandateId } })
  const rules = MandateRulesSchema.parse(JSON.parse(mandate.rules))

  const run = await prisma.agentRun.create({
    data: { mandateId, task, status: 'RUNNING' },
  })

  yield { type: 'started', runId: run.id, model: model.name }

  // Loaded once, before the loop. The system prompt is the cached prefix, so
  // rebuilding it every turn would throw prompt caching away — and within a run
  // the agent already sees its own purchases in the conversation history, so
  // repeating them here would be redundant anyway.
  const history = await loadPurchaseHistory(mandateId)
  const system = buyerAgentSystemPrompt(rules, history, now())

  // Flushed on every entry rather than at the end, so switching tabs or
  // reloading mid-run does not lose what the agent said.
  const transcript: TranscriptEntry[] = []
  const record = async (entry: TranscriptEntry) => {
    transcript.push(entry)
    await prisma.agentRun.update({
      where: { id: run.id },
      data: { transcript: JSON.stringify(transcript) },
    })
  }

  const startedAt = Date.now()
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: task }]

  let purchases = 0
  let blocked = 0
  let reason: 'completed' | 'turn_cap' | 'wall_clock' | 'error' = 'completed'

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (Date.now() - startedAt > MAX_WALL_CLOCK_MS) {
        reason = 'wall_clock'
        break
      }

      const modelTurn = await model.next({
        system,
        messages,
        tools: AGENT_TOOLS,
      })

      if (modelTurn.text) {
        await record({ t: 'say', text: modelTurn.text })
        yield { type: 'text', text: modelTurn.text }
      }

      if (modelTurn.stopReason !== 'tool_use' || modelTurn.toolUses.length === 0) break

      messages.push({ role: 'assistant', content: modelTurn.assistantContent })

      // Parallel tool_use blocks must all come back in ONE user message.
      // Splitting them teaches the model to stop making parallel calls.
      const results: Anthropic.ToolResultBlockParam[] = []

      for (const use of modelTurn.toolUses) {
        await record({ t: 'tool', name: use.name, input: use.input })
        yield { type: 'tool_call', name: use.name, input: use.input }

        if (use.name === TOOL_NAMES.REQUEST_PURCHASE) {
          const outcome = yield* handlePurchase({
            use,
            mandateId,
            runId: run.id,
            now,
            execute: opts.executePurchase,
          })
          results.push(outcome.result)
          await record({ t: 'verdict', seq: outcome.seq })
          if (outcome.authorized) purchases++
          else blocked++
        } else {
          results.push(await handleReadOnlyTool(use))
        }
      }

      messages.push({ role: 'user', content: results })

      if (turn === MAX_TURNS - 1) reason = 'turn_cap'
    }
  } catch (err) {
    reason = 'error'
    const message = err instanceof Error ? err.message : String(err)
    yield { type: 'error', message }

    // An agent crash must never leave the ledger ambiguous about what happened.
    await append({
      mandateId,
      agentRunId: run.id,
      action: 'AGENT_ERROR',
      requestedAction: { error: message },
      verdict: 'BLOCK',
      reasonCodes: [],
      mandateSnapshotHash: canonicalHash(rules),
      idempotencyKey: canonicalHash({ runId: run.id, error: message, at: now().toISOString() }),
      latencyMs: 0,
    })
  }

  await prisma.agentRun.update({
    where: { id: run.id },
    data: { status: reason === 'error' ? 'ERROR' : 'COMPLETED', endedAt: now() },
  })

  const { spentPaise } = await loadLedgerState(mandateId)
  yield { type: 'done', reason, purchases, blocked, authorizedPaise: spentPaise }
}

// ---------------------------------------------------------------------------

/**
 * Adapts one `request_purchase` tool call onto the shared authorization path.
 *
 * Everything that decides anything lives in `authorizeAndExecute`. This function
 * only translates: tool input in, UI events and a tool result out. Keeping the
 * decision logic out of here is what lets a second caller — an MCP server, say —
 * reuse the identical path instead of reimplementing it.
 */
async function* handlePurchase(args: {
  use: ToolUse
  mandateId: string
  runId: string
  now: () => Date
  execute?: (decisionId: string) => Promise<{ razorpayOrderId: string }>
}): AsyncGenerator<
  AgentEvent,
  { result: Anthropic.ToolResultBlockParam; authorized: boolean; seq: number }
> {
  const { use, mandateId, runId, now, execute } = args

  const action: ProposedAction = {
    merchantId: String(use.input.merchantId),
    itemId: String(use.input.itemId),
    category: String(use.input.category),
    amountPaise: Number(use.input.amountPaise),
  }

  const outcome = await authorizeAndExecute({
    mandateId,
    action,
    // The same tool call retried is the same request. A different tool call for
    // the same item is a new purchase, which is why buying atta again next week
    // is allowed rather than flagged as a replay.
    requestId: `${runId}:${use.id}`,
    agentRunId: runId,
    now,
    execute,
  })

  yield {
    type: 'decision',
    seq: outcome.seq,
    decisionId: outcome.decisionId,
    verdict: outcome.verdict,
    reasonCodes: outcome.reasonCodes,
    checks: outcome.checks,
    merchantId: action.merchantId,
    itemId: action.itemId,
    amountPaise: action.amountPaise,
    latencyMs: outcome.latencyMs,
  }

  if (outcome.verdict !== 'ALLOW') {
    // A refusal is a legitimate policy outcome, not a tool malfunction, so it
    // comes back as a normal result rather than is_error. The agent is expected
    // to read the codes and adapt, which is the behaviour the demo shows.
    return {
      authorized: false,
      seq: outcome.seq,
      result: {
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify({
          authorized: false,
          reasonCodes: outcome.reasonCodes,
          guidance:
            'This purchase was refused by the mandate policy engine. Adapt to the reason codes. ' +
            'Retrying the identical request will be refused identically.',
        }),
      },
    }
  }

  if (outcome.executionError) {
    yield { type: 'error', message: outcome.executionError }
    return {
      authorized: false,
      seq: outcome.seq,
      result: {
        type: 'tool_result',
        tool_use_id: use.id,
        is_error: true,
        content: JSON.stringify({
          authorized: true,
          executed: false,
          error: 'Payment execution failed after authorization. Do not re-request this item.',
        }),
      },
    }
  }

  yield {
    type: 'purchase',
    razorpayOrderId: outcome.razorpayOrderId!,
    amountPaise: action.amountPaise,
  }

  return {
    authorized: true,
    seq: outcome.seq,
    result: {
      type: 'tool_result',
      tool_use_id: use.id,
      content: JSON.stringify({
        authorized: true,
        razorpayOrderId: outcome.razorpayOrderId,
        amountPaise: action.amountPaise,
      }),
    },
  }
}

async function handleReadOnlyTool(use: ToolUse): Promise<Anthropic.ToolResultBlockParam> {
  try {
    if (use.name === TOOL_NAMES.SEARCH_CATALOG) {
      const items = await prisma.catalogItem.findMany({
        where: {
          inStock: true,
          ...(use.input.category ? { category: String(use.input.category) } : {}),
          ...(use.input.merchantId ? { merchantId: String(use.input.merchantId) } : {}),
          ...(use.input.query ? { name: { contains: String(use.input.query) } } : {}),
          ...(use.input.maxPricePaise ? { pricePaise: { lte: Number(use.input.maxPricePaise) } } : {}),
        },
        take: 20,
      })
      return {
        type: 'tool_result',
        tool_use_id: use.id,
        content: wrapUntrusted('CATALOG', JSON.stringify(items)),
      }
    }

    if (use.name === TOOL_NAMES.GET_ITEM) {
      const item = await prisma.catalogItem.findUnique({ where: { id: String(use.input.itemId) } })
      if (!item) {
        return {
          type: 'tool_result',
          tool_use_id: use.id,
          is_error: true,
          content: `No catalog item ${String(use.input.itemId)}`,
        }
      }
      return {
        type: 'tool_result',
        tool_use_id: use.id,
        content: wrapUntrusted('CATALOG ITEM', JSON.stringify(item)),
      }
    }

    return {
      type: 'tool_result',
      tool_use_id: use.id,
      is_error: true,
      content: `Unknown tool ${use.name}`,
    }
  } catch (err) {
    return {
      type: 'tool_result',
      tool_use_id: use.id,
      is_error: true,
      content: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Purchases already authorized under this mandate, newest last.
 *
 * Gives the agent a sense of what the person already has, so "restock" means
 * topping up rather than buying the same list again. This is our own ledger
 * data, not third-party content, so it is trusted input.
 */
export async function loadPurchaseHistory(
  mandateId: string,
  limit = 15,
): Promise<PastPurchase[]> {
  const rows = await prisma.decision.findMany({
    where: { mandateId, verdict: 'ALLOW', action: 'PURCHASE' },
    orderBy: { seq: 'desc' },
    take: limit,
  })

  const itemIds = rows.map((r) => (JSON.parse(r.requestedAction) as { itemId?: string }).itemId ?? '')
  const items = await prisma.catalogItem.findMany({ where: { id: { in: itemIds } } })
  const nameById = new Map(items.map((i) => [i.id, i.name]))

  return rows
    .map((r) => {
      const req = JSON.parse(r.requestedAction) as {
        itemId?: string
        merchantId?: string
        amountPaise?: number
      }
      return {
        itemId: req.itemId ?? 'unknown',
        name: nameById.get(req.itemId ?? '') ?? req.itemId ?? 'unknown item',
        merchantId: req.merchantId ?? 'unknown',
        amountPaise: req.amountPaise ?? 0,
        at: r.createdAt,
      }
    })
    .reverse()
}

// loadLedgerState now lives in @/lib/authorize alongside the path that uses it.
// Re-exported here so existing callers keep working.
export { loadLedgerState } from '@/lib/authorize'
