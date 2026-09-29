type Job = { id: string; run: (signal: AbortSignal) => Promise<void>; controller: AbortController };

/** One scheduler is shared by every selection and paste batch. */
export class UploadQueue {
  private pending: Job[] = [];
  private active = new Map<string, Job>();

  constructor(private readonly concurrency = 3) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("无效的上传并发数");
  }

  add(id: string, run: Job["run"]) {
    this.pending.push({ id, run, controller: new AbortController() });
    this.drain();
  }

  cancel(id: string) {
    this.pending = this.pending.filter(job => job.id !== id);
    this.active.get(id)?.controller.abort();
  }

  cancelAll() {
    this.pending = [];
    this.active.forEach(job => job.controller.abort());
  }

  private drain() {
    while (this.active.size < this.concurrency && this.pending.length) {
      const job = this.pending.shift()!;
      this.active.set(job.id, job);
      void Promise.resolve().then(() => {
        job.controller.signal.throwIfAborted();
        return job.run(job.controller.signal);
      }).catch(() => {
        // The job owns its UI error state. A failed job must still release its slot.
      }).finally(() => {
        this.active.delete(job.id);
        this.drain();
      });
    }
  }
}
