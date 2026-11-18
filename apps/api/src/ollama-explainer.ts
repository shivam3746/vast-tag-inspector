import { z } from 'zod';
import { explanationJsonSchema } from './explainer.ts';
import type { LlmClient } from './explainer.ts';

export const localExplanationModel = 'qwen3:4b';
const responseSchema = z.object({
  done: z.boolean(),
  done_reason: z.string().optional(),
  message: z.object({ content: z.string() }),
  prompt_eval_count: z.number().int().nonnegative().optional(),
  eval_count: z.number().int().nonnegative().optional(),
});

export function createOllamaClient(): LlmClient {
  return {
    model: `ollama/${localExplanationModel}`,
    async complete({ instructions, evidence, maxOutputTokens }) {
      const response = await fetch('http://127.0.0.1:11434/api/chat', {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({
          model: localExplanationModel,
          stream: false,
          think: false,
          format: explanationJsonSchema,
          options: { temperature: 0, num_predict: maxOutputTokens },
          messages: [
            { role: 'system', content: instructions },
            {
              role: 'user',
              content: `<evidence>\n${JSON.stringify(evidence)}\n</evidence>`,
            },
          ],
        }),
      });
      if (!response.ok) throw new Error('Local Ollama request failed.');
      const data = responseSchema.parse(await response.json());
      return {
        text:
          data.done && data.done_reason !== 'length'
            ? data.message.content
            : null,
        inputTokens: data.prompt_eval_count ?? null,
        outputTokens: data.eval_count ?? null,
        costUsd: 0,
      };
    },
  };
}
