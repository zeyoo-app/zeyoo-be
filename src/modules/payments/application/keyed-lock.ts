/**
 * Runs work one at a time per key, in arrival order. Wallet spends are check-then-post
 * (read the balance, then debit it); serialising them per brand stops two concurrent
 * fundings from both passing the balance check. Process-local: the API runs as a single
 * instance. Moving to several instances needs a database lock instead.
 */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(work);
    const tail = result.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await result;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
