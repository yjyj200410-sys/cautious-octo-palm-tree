import { afterEach, describe, expect, it, vi } from 'vitest';

import { IdleResource } from '../../../src/main/db/idleResource';

afterEach(() => vi.useRealTimers());
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });
  return { promise, resolve, reject };
};

describe('database inactivity leases', () => {
  it('shares opening, closes once on idle, and reopens for the next operation', async () => {
    vi.useFakeTimers();
    const opening = deferred<{ id: number }>();
    const open = vi.fn().mockReturnValueOnce(opening.promise).mockResolvedValue({ id: 2 });
    const dispose = vi.fn().mockResolvedValue(undefined);
    const resource = new IdleResource(open, dispose, 100);
    const first = resource.with(async (value) => value.id);
    const second = resource.with(async (value) => value.id);
    expect(open).toHaveBeenCalledTimes(1);
    opening.resolve({ id: 1 });
    expect(await Promise.all([first, second])).toEqual([1, 1]);
    await vi.advanceTimersByTimeAsync(100);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(await resource.with(async (value) => value.id)).toBe(2);
    expect(open).toHaveBeenCalledTimes(2);
    await resource.close();
  });

  it('holds a lease through an entire transaction, including failure', async () => {
    vi.useFakeTimers();
    const pending = deferred<void>();
    const dispose = vi.fn().mockResolvedValue(undefined);
    const resource = new IdleResource(async () => ({}), dispose, 100);
    const result = resource.with(async () => {
      await pending.promise;
      throw new Error('rollback');
    });
    const assertion = expect(result).rejects.toThrow('rollback');
    await vi.advanceTimersByTimeAsync(1000);
    expect(dispose).not.toHaveBeenCalled();
    pending.resolve();
    await assertion;
    await vi.advanceTimersByTimeAsync(100);
    expect(dispose).toHaveBeenCalledTimes(1);
    await resource.close();
  });

  it('waits for flushing before reopening', async () => {
    vi.useFakeTimers();
    const flush = deferred<void>();
    const open = vi.fn().mockResolvedValue({});
    const resource = new IdleResource(open, () => flush.promise, 100);
    await resource.with(async () => undefined);
    await vi.advanceTimersByTimeAsync(100);
    const next = resource.with(async () => 'ready');
    await vi.advanceTimersByTimeAsync(100);
    expect(open).toHaveBeenCalledTimes(1);
    flush.resolve();
    expect(await next).toBe('ready');
    expect(open).toHaveBeenCalledTimes(2);
    await resource.close();
  });

  it('retries failed opens and waits for in-flight work during shutdown', async () => {
    const operation = deferred<void>();
    const open = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
    const dispose = vi.fn().mockResolvedValue(undefined);
    const resource = new IdleResource(open, dispose);
    await expect(resource.with(async () => undefined)).rejects.toThrow('offline');
    const work = resource.with(() => operation.promise);
    const closing = resource.close();
    await expect(resource.with(async () => undefined)).rejects.toThrow('shutting down');
    expect(dispose).not.toHaveBeenCalled();
    operation.resolve();
    await Promise.all([work, closing]);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
