export class TaskQueue {
  private readonly limit: number;
  private activeCount = 0;
  private readonly pending: Array<() => void> = [];
  private idleResolvers: Array<() => void> = [];

  constructor(limit = 1) {
    this.limit = Math.max(1, limit);
  }

  add<T>(task: () => Promise<T> | T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.activeCount += 1;
        Promise.resolve()
          .then(task)
          .then(resolve, reject)
          .finally(() => {
            this.activeCount -= 1;
            this.drain();
          });
      };

      if (this.activeCount < this.limit) {
        run();
        return;
      }

      this.pending.push(run);
    });
  }

  async onIdle(): Promise<void> {
    if (this.activeCount === 0 && this.pending.length === 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  private drain(): void {
    while (this.activeCount < this.limit && this.pending.length > 0) {
      const next = this.pending.shift();
      next?.();
    }

    if (this.activeCount === 0 && this.pending.length === 0) {
      const resolvers = this.idleResolvers.splice(0, this.idleResolvers.length);
      for (const resolve of resolvers) {
        resolve();
      }
    }
  }
}
