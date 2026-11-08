/**
 * Best-effort parse of a JSON document that is still streaming in, so the UI can show
 * fields as they are written. Closes any open string, array or object and drops a
 * trailing key or comma that has no value yet. Returns undefined when nothing usable
 * has arrived. Never used for the final result, which is parsed strictly.
 */
export function parsePartialJson(text: string): unknown {
  const start = text.search(/[{[]/);
  if (start < 0) {
    return undefined;
  }
  const source = text.slice(start);
  try {
    return JSON.parse(source);
  } catch {
    // Still streaming: repair below.
  }

  const closers: string[] = [];
  let inString = false;
  let escaped = false;
  for (const char of source) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      closers.push('}');
    } else if (char === '[') {
      closers.push(']');
    } else if (char === '}' || char === ']') {
      closers.pop();
    }
  }

  let repaired = source;
  if (inString) {
    // A dangling escape would swallow the closing quote.
    repaired = (escaped ? repaired.slice(0, -1) : repaired) + '"';
  }
  // Each pass removes one incomplete tail (`,` or `"key":` or `"key"`), then retries.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return JSON.parse(repaired + [...closers].reverse().join(''));
    } catch {
      const trimmed = repaired
        .replace(/,\s*$/, '')
        .replace(/[{,]\s*"(?:[^"\\]|\\.)*"\s*:?\s*$/, (match) => (match.startsWith('{') ? '{' : ''))
        .replace(/:\s*$/, '');
      if (trimmed === repaired) {
        return undefined;
      }
      repaired = trimmed;
    }
  }
  return undefined;
}
