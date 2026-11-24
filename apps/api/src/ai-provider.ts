import { BadGatewayException, HttpException, HttpStatus, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { z } from 'zod';
import { db } from './database.js';

const key = process.env.OPENAI_API_KEY?.trim();
const model = process.env.OPENAI_MODEL?.trim() || 'gpt-5.4-mini';
const officialEndpoint = 'https://api.openai.com/v1/responses';
const dayUtc = "(now() AT TIME ZONE 'UTC')::date";
const configuredLimit = Number(process.env.AI_DAILY_LIMIT || 12);
const dailyLimit = Number.isInteger(configuredLimit) && configuredLimit > 0 && configuredLimit <= 2147483647 ? configuredLimit : 12;

function endpoint() {
  const testUrl = process.env.NODE_ENV === 'production' ? undefined : process.env.OPENAI_TEST_BASE_URL;
  if (!testUrl) return officialEndpoint;
  try {
    const url = new URL(testUrl);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'http:' || !local || url.username || url.password || url.search || url.hash) return undefined;
    return url.href.replace(/\/+$/, '') + '/responses';
  } catch {
    return undefined;
  }
}

const responsesEndpoint = endpoint();
export const aiConfigured = Boolean(key && responsesEndpoint);

export async function aiAvailability(member: string) {
  if (!key || !responsesEndpoint) return { available: false, remaining: 0, dailyLimit };
  const { rows: [row] } = await db.query<{ requests: number }>(`SELECT requests FROM ai_daily_usage WHERE user_id=$1 AND day=${dayUtc}`, [member]);
  return { available: true, remaining: Math.max(0, dailyLimit - (row?.requests ?? 0)), dailyLimit };
}

async function reserveRequest(member: string) {
  const { rows: [row] } = await db.query<{ requests: number }>(`INSERT INTO ai_daily_usage(user_id,day,requests) VALUES($1,${dayUtc},1)
    ON CONFLICT(user_id,day) DO UPDATE SET requests=ai_daily_usage.requests+1 WHERE ai_daily_usage.requests<$2 RETURNING requests`,
  [member, dailyLimit]);
  if (!row) throw new HttpException('You have used all AI requests for today. Your allowance resets at midnight UTC.', HttpStatus.TOO_MANY_REQUESTS);
  return dailyLimit - row.requests;
}

const responseEnvelope = z.object({
  status: z.literal('completed'),
  output: z.array(z.object({
    type: z.string(),
    role: z.string().optional(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional()
  }))
});

type Generation<T> = {
  instructions: string; input: object; schemaName: string; schema: object; validate: z.ZodType<T>; tokens: number;
};

export async function requestAi<T>(member: string, configuration: Generation<T>) {
  if (!key || !responsesEndpoint) throw new ServiceUnavailableException('AI generation is available once the site administrator configures OpenAI.');
  const remaining = await reserveRequest(member);
  let response: Response;
  try {
    response = await fetch(responsesEndpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(25000),
      redirect: 'error',
      body: JSON.stringify({
        model, instructions: configuration.instructions, input: JSON.stringify(configuration.input), store: false,
        max_output_tokens: configuration.tokens,
        text: { format: { type: 'json_schema', name: configuration.schemaName, strict: true, schema: configuration.schema } }
      })
    });
  } catch {
    throw new ServiceUnavailableException('The AI provider is unavailable or took too long. Try again shortly.');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new ServiceUnavailableException(response.status === 429
      ? 'The AI provider is busy. Try again shortly.' : 'The AI provider is unavailable. Try again shortly.');
  }

  const envelope = responseEnvelope.safeParse(await response.json().catch(() => null));
  if (!envelope.success) throw new BadGatewayException('The AI response was incomplete. Try a shorter request.');
  const content = envelope.data.output.filter((entry) => entry.type === 'message' && entry.role === 'assistant').flatMap((entry) => entry.content ?? []);
  if (content.some((entry) => entry.type === 'refusal')) {
    throw new UnprocessableEntityException('AI couldn’t generate a response for this request. Try different details.');
  }
  const output = content.filter((entry) => entry.type === 'output_text').map((entry) => entry.text ?? '').join('');
  let decoded: unknown;
  try { decoded = JSON.parse(output); }
  catch { throw new BadGatewayException('The AI response could not be read. Try again.'); }
  const checked = configuration.validate.safeParse(decoded);
  if (!checked.success) throw new BadGatewayException('The AI response did not fit this tool. Try a shorter request.');
  return { output: checked.data, remaining };
}
