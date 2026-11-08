import { parsePartialJson } from './partial-json';

describe('parsePartialJson', () => {
  it.each([
    ['', undefined],
    ['no json yet', undefined],
    ['{"brief": "Hel', { brief: 'Hel' }],
    ['{"brief": "Hello", "go', { brief: 'Hello' }],
    ['{"brief": "Hello", "goals":', { brief: 'Hello' }],
    ['{"brief": "Hello",', { brief: 'Hello' }],
    ['{"tags": ["#a", "#b', { tags: ['#a', '#b'] }],
    ['{"ideas": [{"title": "One", "hook": "Wa', { ideas: [{ title: 'One', hook: 'Wa' }] }],
    ['{"q": "say \\"hi', { q: 'say "hi' }],
    ['{"q": "line\\', { q: 'line' }],
    ['```json\n{"a": 1}', { a: 1 }],
  ])('parses %j', (input, expected) => {
    expect(parsePartialJson(input)).toEqual(expected);
  });

  it('parses a complete document as-is', () => {
    expect(parsePartialJson('{"a":[1,2],"b":{"c":true}}')).toEqual({ a: [1, 2], b: { c: true } });
  });
});
