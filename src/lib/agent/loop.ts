import type Anthropic from '@anthropic-ai/sdk'
import { prisma } from '@/lib/db'
import { canonicalHash } from '@/lib/mandate/canonical'
import { MandateRulesSchema, type MandateRules, type MandateStatus } from '@/lib/mandate/schema'
import { evaluate, type LedgerState } from '@/lib/policy/engine'
import { append } from '@/lib/ledger/append'
import { executePayment } from '@/lib/razorpay/execute'
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
  const execute = opts.executePurchase ?? executePayment

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

      if (modelTurn.text) yield { type: 'text', text: modelTurn.text }

      if (modelTurn.stopReason !== 'tool_use' || modelTurn.toolUses.length === 0) break

      messages.push({ role: 'assistant', content: modelTurn.assistantContent })

      // Parallel tool_use blocks must all come back in ONE user message.
      // Splitting them teaches the model to stop making parallel calls.
      const results: Anthropic.ToolResultBlockParam[] = []

      for (const use of modelTurn.toolUses) {
        yield { type: 'tool_call', name: use.name, input: use.input }

        if (use.name === TOOL_NAMES.REQUEST_PURCHASE) {
          const outcome = yield* handlePurchase({ use, mandateId, rules, runId: run.id, now, execute })
          results.push(outcome.result)
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

async function* handlePurchase(args: {
  use: ToolUse
  mandateId: string
  rules: MandateRules
  runId: string
  now: () => Date
  execute: (decisionId: string) => Promise<{ razorpayOrderId: string }>
}): AsyncGenerator<AgentEvent, { result: Anthropic.ToolResultBlockParam; authorized: boolean }> {
  const { use, mandateId, rules, runId, now, execute } = args

  const action = {
    merchantId: String(use.input.merchantId),
    itemId: String(use.input.itemId),
    category: String(use.input.category),
    amountPaise: Number(use.input.amountPaise),
  }

  // Re-read the mandate on EVERY request. Revocation has to take effect on the
  // agent's very next action, so status must never be cached across turns —
  // that is exactly what the live revoke moment in the demo depends on.
  const current = await prisma.mandate.findUniqueOrThrow({ where: { id: mandateId } })
  const ledger = await loadLedgerState(mandateId)
  // Keyed on the REQUEST, not the action. Hashing {mandateId, action} would make
  // a legitimate repeat purchase of the same item next week look like a replay.
  // A genuine retry re-sends the same runId + toolUseId and is caught; buying
  // atta again in a later run is a different request and is allowed.
  const idempotencyKey = canonicalHash({ runId, toolUseId: use.id, action })

  const decision = evaluate({
    rules,
    signature: current.signature,
    status: current.status as MandateStatus,
    action,
    ledger,
    idempotencyKey,
    now: now(),
  })

  const { seq, id: decisionId } = await appendDecision({
    mandateId,
    runId,
    action,
    decision,
    idempotencyKey,
  })

  yield {
    type: 'decision',
    seq,
    decisionId,
    verdict: decision.verdict,
    reasonCodes: decision.reasonCodes,
    checks: decision.checks,
    merchantId: action.merchantId,
    itemId: action.itemId,
    amountPaise: action.amountPaise,
    latencyMs: decision.latencyMs,
  }

  if (decision.verdict !== 'ALLOW') {
    // A BLOCK is a legitimate policy outcome, not a tool malfunction, so it is
    // returned as a normal result rather than is_error. The agent is expected to
    // read the codes and adapt, which is the behaviour the demo shows.
    return {
      authorized: false,
      result: {
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify({
          authorized: false,
          reasonCodes: decision.reasonCodes,
          guidance:
            'This purchase was refused by the mandate policy engine. Adapt to the reason codes — ' +
            'retrying the identical request will be refused identically.',
        }),
      },
    }
  }

  try {
    const { razorpayOrderId } = await execute(decisionId)
    yield { type: 'purchase', razorpayOrderId, amountPaise: action.amountPaise }

    return {
      authorized: true,
      result: {
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify({ authorized: true, razorpayOrderId, amountPaise: action.amountPaise }),
      },
    }
  } catch (err) {
    // Authorization succeeded but execution failed. The mandate state is intact
    // and the decision is already recorded, so a retry is safe and idempotent.
    const message = err instanceof Error ? err.message : String(err)
    yield { type: 'error', message }

    return {
      authorized: false,
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

async function appendDecision(args: {
  mandateId: string
  runId: string
  action: { merchantId: string; itemId: string; category: string; amountPaise: number }
  decision: ReturnType<typeof evaluate>
  idempotencyKey: string
}) {
  const { mandateId, runId, action, decision, idempotencyKey } = args

  const { seq } = await append({
    mandateId,
    agentRunId: runId,
    action: 'PURCHASE',
    requestedAction: action,
    verdict: decision.verdict,
    reasonCodes: decision.reasonCodes,
    mandateSnapshotHash: decision.mandateSnapshotHash,
    idempotencyKey,
    latencyMs: decision.latencyMs,
  })

  const row = await prisma.decision.findUniqueOrThrow({ where: { seq }, select: { id: true } })
  return { seq, id: row.id }
}

/**
 * Spend counted against the cap is AUTHORIZED spend — the sum of ALLOW
 * decisions — not settled spend.
 *
 * This matters. Mandate.spentPaise is incremented by the Razorpay webhook when a
 * payment is actually captured, which can lag by seconds or never arrive. If the
 * engine enforced against that, an agent could authorize ten purchases inside
 * the lag window and blow the total cap while every individual check passed. We
 * reserve against the cap the moment we authorize.
 */
/**
 * Purchases already authorized under this mandate, newest last.
 *
 * Gives the agent a sense of what the person already has, so \"restock\" means
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

export async function loadLedgerState(mandateId: string): Promise<LedgerState> {
  const decisions = await prisma.decision.findMany({
    where: { mandateId },
    select: { verdict: true, action: true, requestedAction: true, createdAt: true, idempotencyKey: true },
  })

  let spentPaise = 0
  const recentTxnTimestamps: Date[] = []
  const seenIdempotencyKeys = new Set<string>()

  for (const d of decisions) {
    seenIdempotencyKeys.add(d.idempotencyKey)
    if (d.verdict === 'ALLOW' && d.action === 'PURCHASE') {
      const requested = JSON.parse(d.requestedAction) as { amountPaise?: number }
      spentPaise += requested.amountPaise ?? 0
      recentTxnTimestamps.push(d.createdAt)
    }
  }

  return { spentPaise, recentTxnTimestamps, seenIdempotencyKeys }
}
