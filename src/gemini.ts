import type { Tool } from '@modelcontextprotocol/sdk/types.js';
export type ModelPart = { text?: string; thought?: boolean; thoughtSignature?: string; functionCall?: { name: string; args?: Record<string, unknown>; id?: string }; functionResponse?: { name: string; id?: string; response: Record<string, unknown> } };
export type ModelContent = { role: 'user' | 'model'; parts: ModelPart[] };
export interface AgentModel { generate(history: ModelContent[], tools: Tool[], instruction: string, signal: AbortSignal): Promise<ModelContent> }

export class GeminiModel implements AgentModel {
  constructor(private key: string, private model: string) {}
  async generate(history: ModelContent[], tools: Tool[], instruction: string, signal: AbortSignal) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.key },
      signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instruction }] }, contents: history,
        tools: [{ functionDeclarations: tools.map(tool => ({ name: tool.name, description: tool.description ?? tool.name, parametersJsonSchema: tool.inputSchema })) }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
      }),
    });
    if (!response.ok) throw new Error(response.status === 429 ? 'Gemini quota is exhausted or rate limited. Try again later.' : `Gemini request failed (HTTP ${response.status}). Check the server model and API key settings.`);
    const body = await response.json() as { candidates?: { content?: ModelContent; finishReason?: string }[] };
    const content = body.candidates?.[0]?.content;
    if (!content?.parts?.length) throw new Error('Gemini returned no usable response. Try a more specific on-chain data request.');
    // Preserve complete model content, including function-call IDs and thought signatures, in history.
    return content;
  }
}
