export const AI_PROVIDER = 'AiProviderPort';

export interface AiGenerateInput {
  system: string;
  prompt: string;
}

/** Outbound port for the LLM provider. Implemented by the Anthropic adapter. */
export interface AiProviderPort {
  generate(input: AiGenerateInput): Promise<string>;
}
