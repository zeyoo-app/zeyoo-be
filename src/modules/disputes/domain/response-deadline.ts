/** Support's commitment: a first reply within this many business days of a dispute opening. */
export const RESPONSE_BUSINESS_DAYS = 2;

const SATURDAY = 6;
const SUNDAY = 0;
const DAY_MS = 24 * 60 * 60 * 1_000;

/** The moment `days` business days (Monday to Friday, UTC) after `from`. */
export function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from.getTime());
  let remaining = days;
  while (remaining > 0) {
    result.setTime(result.getTime() + DAY_MS);
    const weekday = result.getUTCDay();
    if (weekday !== SATURDAY && weekday !== SUNDAY) {
      remaining -= 1;
    }
  }
  return result;
}

export function responseDueFor(openedAt: Date): Date {
  return addBusinessDays(openedAt, RESPONSE_BUSINESS_DAYS);
}
