import { z } from 'zod';
import { explanationJsonSchema } from './explainer.ts';
import type { LlmClient } from './explainer.ts';

const model = 'gemini-3.1-flash-lite';
const tokenCount = z.number().int().nonnegative();
const responseSchema = z.object({
  candidates: z
    .array(
      z.object({
        finishReason: z.string().optional(),
        content: z
          .object({
            parts: z
              .array(
                z.object({
                  text: z.string().optional(),
                  thought: z.boolean().optional(),
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  usageMetadata: z
    .object({
      promptTokenCount: tokenCount.optional(),
      candidatesTokenCount: tokenCount.optional(),
      thoughtsTokenCount: tokenCount.optional(),
    })
    .optional(),
});

export function createGeminiClient(apiKey: string): LlmClient {
  return {
    model: `gemini/${model}`,
    async complete({ instructions, evidence, maxOutputTokens }) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          redirect: 'error',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          signal: AbortSignal.timeout(12_000),
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: instructions }] },
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: `<evidence>\n${JSON.stringify(evidence)}\n</evidence>`,
                  },
                ],
              },
            ],
            generationConfig: {
              maxOutputTokens,
              responseMimeType: 'application/json',
              responseJsonSchema: explanationJsonSchema,
            },
          }),
        },
      );
      if (!response.ok) throw new Error('Gemini request failed.');
      const { candidates, usageMetadata } = responseSchema.parse(
        await response.json(),
      );
      const first = candidates?.[0];
      const candidateTokens = usageMetadata?.candidatesTokenCount;
      return {
        text:
          first?.finishReason === 'STOP'
            ? (first.content?.parts
                ?.filter(({ thought }) => !thought)
                .map(({ text }) => text ?? '')
                .join('') ?? null)
            : null,
        inputTokens: usageMetadata?.promptTokenCount ?? null,
        outputTokens:
          candidateTokens === undefined
            ? null
            : candidateTokens + (usageMetadata?.thoughtsTokenCount ?? 0),
        // Usage alone cannot distinguish a free-tier project from a paid project.
        costUsd: null,
      };
    },
  };
}
