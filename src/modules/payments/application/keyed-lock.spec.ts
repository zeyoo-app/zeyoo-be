import { KeyedLock } from './keyed-lock';

describe('KeyedLock', () => {
  it('runs work for the same key one at a time, in order', async () => {
    const lock = new KeyedLock();
    const events: string[] = [];
    const slow = (name: string, ms: number) => () =>
      new Promise<void>((resolve) => {
        events.push(`${name}:start`);
        setTimeout(() => {
          events.push(`${name}:end`);
          resolve();
        }, ms);
      });

    await Promise.all([lock.run('org', slow('a', 20)), lock.run('org', slow('b', 1))]);

    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('keeps going after a failed task', async () => {
    const lock = new KeyedLock();

    await expect(lock.run('org', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(lock.run('org', () => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});
