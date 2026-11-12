import { ZodTypeAny, z } from 'zod';

/**
 * Tidies a model's reply to fit the output schema before it is validated, so small
 * slips do not fail a whole run: text is trimmed and shortened at a word boundary when
 * over its limit, lists drop blank or too-short items and are cut to their maximum,
 * and fields the schema does not ask for are dropped. Anything genuinely missing or
 * too short is left alone, so validation still catches it and the model is asked to
 * fix it.
 */
export function fitToSchema(schema: ZodTypeAny, value: unknown): unknown {
  const inner = unwrap(schema);

  if (inner instanceof z.ZodString) {
    return typeof value === 'string' ? fitText(value, limit(inner, 'max')) : value;
  }

  if (inner instanceof z.ZodArray) {
    if (!Array.isArray(value)) return value;
    const item = inner.element as ZodTypeAny;
    const itemMin = unwrap(item) instanceof z.ZodString ? limit(unwrap(item), 'min') : undefined;
    const fitted = value
      .map((entry) => fitToSchema(item, entry))
      .filter((entry) => typeof entry !== 'string' || entry.length >= (itemMin ?? 1));
    const max = inner._def.maxLength?.value ?? inner._def.exactLength?.value;
    return max === undefined ? fitted : fitted.slice(0, max);
  }

  if (inner instanceof z.ZodObject) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const shape = inner.shape as Record<string, ZodTypeAny>;
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(shape)
        .filter(([key]) => key in source)
        .map(([key, field]) => [key, fitToSchema(field, source[key])]),
    );
  }

  return value;
}

/** The schema under optional/nullable/default/effects wrappers. */
function unwrap(schema: ZodTypeAny): ZodTypeAny {
  let current = schema;
  for (;;) {
    if (
      current instanceof z.ZodOptional ||
      current instanceof z.ZodNullable ||
      current instanceof z.ZodDefault
    ) {
      current = current._def.innerType as ZodTypeAny;
    } else if (current instanceof z.ZodEffects) {
      current = current._def.schema as ZodTypeAny;
    } else {
      return current;
    }
  }
}

function limit(schema: ZodTypeAny, kind: 'min' | 'max'): number | undefined {
  if (!(schema instanceof z.ZodString)) return undefined;
  const check = schema._def.checks.find((candidate) => candidate.kind === kind) as
    | { value: number }
    | undefined;
  return check?.value;
}

/** Trims, then shortens text over `max` at the last sentence or word break that fits. */
function fitText(text: string, max: number | undefined): string {
  const trimmed = text.trim();
  if (max === undefined || trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const sentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentenceEnd >= max * 0.6) return cut.slice(0, sentenceEnd + 1);
  const wordEnd = cut.lastIndexOf(' ');
  return (wordEnd >= max * 0.6 ? cut.slice(0, wordEnd) : cut).trimEnd();
}
