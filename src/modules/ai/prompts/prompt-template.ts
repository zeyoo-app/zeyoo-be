import { zodToOpenAPI } from 'nestjs-zod';
import { ZodType, ZodTypeDef } from 'zod';

export type AiLanguage = 'en' | 'ar';

/**
 * A versioned prompt. Bump `version` whenever the wording or output shape changes;
 * every logged request records the id and version that produced it.
 */
export interface PromptTemplate<TContext, TOutput> {
  id: string;
  version: number;
  /** Stable instructions: the role, the rules and the output contract. */
  system: string;
  /** The task for this request, built only from the context it is given. */
  renderTask(context: TContext): string;
  output: ZodType<TOutput, ZodTypeDef, unknown>;
  temperature: number;
}

/** The JSON Schema sent to providers for structured output, derived from the Zod schema. */
export function jsonSchemaOf(template: PromptTemplate<unknown, unknown>): Record<string, unknown> {
  return zodToOpenAPI(template.output) as Record<string, unknown>;
}

export function templateKey(template: { id: string; version: number }): string {
  return `${template.id}@v${template.version}`;
}

const LANGUAGE_NAMES: Record<AiLanguage, string> = { en: 'English', ar: 'Arabic' };

export function languageInstruction(language: AiLanguage): string {
  return `Write every text value in ${LANGUAGE_NAMES[language]}. Hashtags have no spaces; join words with underscores if needed.`;
}
