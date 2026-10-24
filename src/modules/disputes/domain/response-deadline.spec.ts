import { addBusinessDays, responseDueFor } from './response-deadline';

describe('addBusinessDays', () => {
  it('adds plain days in the middle of the week', () => {
    // Monday 2026-10-19 + 2 = Wednesday 2026-10-21
    expect(addBusinessDays(new Date('2026-10-19T10:00:00Z'), 2).toISOString()).toBe(
      '2026-10-21T10:00:00.000Z',
    );
  });

  it('skips the weekend', () => {
    // Thursday 2026-10-22 + 2 = Monday 2026-10-26
    expect(addBusinessDays(new Date('2026-10-22T10:00:00Z'), 2).toISOString()).toBe(
      '2026-10-26T10:00:00.000Z',
    );
  });

  it('counts from a weekend opening as if from the next business day', () => {
    // Saturday 2026-10-24 + 2 = Tuesday 2026-10-27
    expect(responseDueFor(new Date('2026-10-24T10:00:00Z')).toISOString()).toBe(
      '2026-10-27T10:00:00.000Z',
    );
  });
});
