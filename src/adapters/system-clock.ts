import type { Clock } from "@/container/clock";

// Real system clock: `now()` is wall time; `elapsed(ms)` is measured from
// instance creation (e.g. "has the job been pending more than N ms?").
export class SystemClock implements Clock {
  private readonly startedAt = Date.now();

  now(): Date {
    return new Date();
  }

  elapsed(ms: number): boolean {
    return Date.now() - this.startedAt >= ms;
  }
}