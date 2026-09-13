import { setTimeout as sleep } from 'node:timers/promises';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
export type ModelPart = { text?: string; thought?: boolean; thoughtSignature?: string; functionCall?: { name: string; args?: Record<string, unknown>; id?: string }; functionResponse?: { name: string; id?: string; response: Record<string, unknown> } };
export type ModelContent = { role: 'user' | 'model'; parts: ModelPart[] };
export interface AgentModel { generate(history: ModelContent[], tools: Tool[], instruction: string, signal: AbortSignal): Promise<ModelContent> }
type Runtime = { fetch: typeof fetch; now: () => number; wait: (ms: number, signal: AbortSignal) => Promise<void> };
export class GeminiModel implements AgentModel {
  private nextRequestAt = 0;
  constructor(private key: string, private model: string, private runtime: Runtime = {
    fetch, now: Date.now, wait: async (ms, signal) => { await sleep(ms, undefined, { signal }); },
  }) {}
  async generate(history: ModelContent[], tools: Tool[], instruction: string, signal: AbortSignal) {
    // The playground already allows one run at a time. Space requests across runs too.
    // 4.5 seconds leaves a small margin below the configured 15 requests/minute quota.
    signal.throwIfAborted();
    const pause = Math.max(0, this.nextRequestAt - this.runtime.now());
    if (pause) await this.runtime.wait(pause, signal);
    signal.throwIfAborted();
    this.nextRequestAt = this.runtime.now() + 4500;
    const response = await this.runtime.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.key },
      signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instruction }] }, contents: history,
        ...(tools.length ? { tools: [{ functionDeclarations: tools.map(tool => ({ name: tool.name, description: tool.description ?? tool.name, parametersJsonSchema: tool.inputSchema })) }] } : {}),
        generationConfig: { maxOutputTokens: 4096 },
      }),
    });
    if (!response.ok) throw new Error(response.status === 429
      ? 'Gemini quota reached. Please check your project limits before starting another run. Any completed payment and tool results remain in the console.'
      : `Gemini request failed (HTTP ${response.status}). Check the server model and API key settings.`);
    const body = await response.json() as { candidates?: { content?: ModelContent }[] };
    const content = body.candidates?.[0]?.content;
    if (!content?.parts?.length) throw new Error('Gemini returned no usable response. Try a more specific on-chain data request.');
    // Preserve function-call metadata and thought signatures for subsequent model turns.
    return content;
  }
}
