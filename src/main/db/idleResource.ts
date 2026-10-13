/** A durable resource stays open during active work and releases after inactivity. */
export class IdleResource<T> {
  private value: T | null = null;
  private opening: Promise<T> | null = null;
  private closing: Promise<void> | null = null;
  private users = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private drained: (() => void)[] = [];
  private open: () => Promise<T>;
  private dispose: (value: T) => Promise<void>;
  private delayMs: number;
  private onReleased: () => void;
  private onError: (error: unknown) => void;

  constructor(
    open: () => Promise<T>,
    dispose: (value: T) => Promise<void>,
    delayMs = 10_000,
    onReleased: () => void = () => {},
    onError: (error: unknown) => void = () => {}
  ) {
    this.open = open;
    this.dispose = dispose;
    this.delayMs = delayMs;
    this.onReleased = onReleased;
    this.onError = onError;
  }

  async with<R>(operation: (value: T) => Promise<R>): Promise<R> {
    if (this.stopped) throw new Error('Resource is shutting down');
    clearTimeout(this.timer);
    this.users++;
    try {
      if (this.closing) await this.closing;
      if (!this.value) {
        if (!this.opening) {
          this.opening = this.open().then((value) => {
            this.value = value;
            return value;
          });
        }
        try {
          await this.opening;
        } finally {
          this.opening = null;
        }
      }
      return await operation(this.value!);
    } finally {
      this.users--;
      if (!this.users) {
        this.drained.splice(0).forEach((resolve) => resolve());
        if (!this.stopped) {
          this.timer = setTimeout(() => {
            void this.release().catch(this.onError);
          }, this.delayMs);
          this.timer.unref?.();
        }
      }
    }
  }

  private release(): Promise<void> {
    if (this.closing) return this.closing;
    if (this.users || !this.value) return Promise.resolve();
    const value = this.value;
    this.closing = this.dispose(value)
      .then(() => {
        this.value = null;
        // Wait until the dispose stack no longer holds the native instance.
        setImmediate(this.onReleased);
      })
      .finally(() => {
        this.closing = null;
      });
    return this.closing;
  }

  async close(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.users) await new Promise<void>((resolve) => this.drained.push(resolve));
    await this.release();
  }
}
