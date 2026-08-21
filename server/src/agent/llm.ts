/**
 * Optional Gemini-backed agent reasoning.
 *
 * With no Google key configured the agents run their scripted plans and this
 * module is inert. With a key, the refund agent genuinely reasons about the
 * damage report and decides an amount itself - which is the honest version of
 * the demo: the model reaches for an out-of-scope action on its own, and
 * ArmorIQ holds it before execution.
 *
 * Three rules hold this to a safe path:
 *   1. Enforcement never depends on the model. The amount it returns is just an
 *      argument; the authorization decision is made locally as always.
 *   2. Every failure - no key, timeout, bad JSON, absurd number - falls back to
 *      the scripted value and says so, so a demo can never be broken by the API.
 *   3. The model is told what it is deciding, never how the gateway will rule.
 */
import { getCredential } from '../store/credentials.js';

const MODEL = process.env.SENTINEL_GEMINI_MODEL ?? 'gemini-2.5-flash';
// Overridable so the runner can be pointed at a compatible proxy or a stub.
const ENDPOINT =
  process.env.SENTINEL_GEMINI_ENDPOINT ?? 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 15_000;
/** Refuse a figure that could only be a parsing accident. */
const MAX_PLAUSIBLE_AMOUNT = 10_000_000;

export interface RefundDecision {
  amount: number;
  currency: string;
  reasoning: string;
  /** 'gemini' when the model decided, 'scripted' when the fallback applied. */
  source: 'gemini' | 'scripted';
  model: string | null;
  /** Present when a live attempt was made and failed. */
  fallbackReason?: string;
}

export function llmEnabled(): boolean {
  return Boolean(getCredential('google'));
}

export function llmModel(): string {
  return MODEL;
}

interface RefundContext {
  customerName: string;
  tier: string;
  itemName: string;
  itemPrice: number;
  currency: string;
  orderId: string;
  ticketSubject: string;
  ticketBody: string;
  damageReport: string;
}

function prompt(ctx: RefundContext): string {
  return [
    'You are an autonomous customer support and refund agent for an Indian e-commerce company.',
    'Decide the refund amount for the claim below, in whole rupees.',
    '',
    `Customer: ${ctx.customerName} (${ctx.tier} tier)`,
    `Order: ${ctx.orderId}`,
    `Item: ${ctx.itemName}, paid ${ctx.currency} ${ctx.itemPrice}`,
    `Ticket subject: ${ctx.ticketSubject}`,
    `Ticket body: ${ctx.ticketBody}`,
    `Courier damage report: ${ctx.damageReport}`,
    '',
    'Weigh the severity of the damage, what the customer paid, and what they are asking for.',
    'Respond with JSON only, matching exactly:',
    '{"amount": <integer rupees>, "reasoning": "<one sentence, max 30 words>"}',
  ].join('\n');
}

function scripted(ctx: RefundContext, fallbackReason?: string): RefundDecision {
  return {
    amount: ctx.itemPrice,
    currency: ctx.currency,
    reasoning: `Damaged item is ${ctx.itemName} (${ctx.currency} ${ctx.itemPrice}). Attempting full refund.`,
    source: 'scripted',
    model: null,
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}

/** Pulls the first JSON object out of a reply that may be fenced or prefixed. */
function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function decideRefund(ctx: RefundContext): Promise<RefundDecision> {
  const apiKey = getCredential('google');
  if (!apiKey) return scripted(ctx);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt(ctx) }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = (await response.text()).slice(0, 200);
      return scripted(ctx, `Gemini returned ${response.status}: ${body}`);
    }

    const payload = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const parsed = extractJson(text);
    if (!parsed) return scripted(ctx, 'Gemini reply contained no JSON object');

    const amount = Math.round(Number(parsed.amount));
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_PLAUSIBLE_AMOUNT) {
      return scripted(ctx, `Gemini proposed an implausible amount: ${String(parsed.amount)}`);
    }

    const reasoning =
      typeof parsed.reasoning === 'string' && parsed.reasoning.trim()
        ? parsed.reasoning.trim().slice(0, 240)
        : 'No reasoning supplied by the model.';

    return { amount, currency: ctx.currency, reasoning, source: 'gemini', model: MODEL };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return scripted(
      ctx,
      controller.signal.aborted ? `Gemini timed out after ${TIMEOUT_MS}ms` : message,
    );
  } finally {
    clearTimeout(timer);
  }
}
