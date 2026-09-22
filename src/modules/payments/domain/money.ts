const CURRENCY_PATTERN = /^[A-Z]{3}$/;

/**
 * An immutable monetary amount in integer minor units (e.g. cents) plus an ISO
 * 4217 currency code. Never uses floating point, and never mixes currencies.
 */
export class Money {
  private constructor(
    readonly amountMinor: number,
    readonly currencyCode: string,
  ) {}

  static of(amountMinor: number, currencyCode: string): Money {
    if (!Number.isInteger(amountMinor)) {
      throw new Error('Money amount must be an integer number of minor units.');
    }
    if (!CURRENCY_PATTERN.test(currencyCode)) {
      throw new Error('Currency must be a 3-letter ISO code.');
    }
    return new Money(amountMinor, currencyCode);
  }

  static zero(currencyCode: string): Money {
    return Money.of(0, currencyCode);
  }

  static min(first: Money, second: Money): Money {
    first.assertSameCurrency(second);
    return first.amountMinor <= second.amountMinor ? first : second;
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.amountMinor + other.amountMinor, this.currencyCode);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.amountMinor - other.amountMinor, this.currencyCode);
  }

  isZero(): boolean {
    return this.amountMinor === 0;
  }

  isNegative(): boolean {
    return this.amountMinor < 0;
  }

  isGreaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amountMinor > other.amountMinor;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currencyCode !== other.currencyCode) {
      throw new Error(
        `Cannot operate on mismatched currencies: ${this.currencyCode} and ${other.currencyCode}.`,
      );
    }
  }
}
