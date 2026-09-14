import type { Clock } from "@/container/clock";

// Deterministic clock for tests: time only moves when `advance`/`setNow` is
// called, so polling/rate-limit logic is fully scriptable.
export class MockClock implements Clock {
  private current: Date;
  private readonly startedAtMs: number;

  constructor(start: Date = new Date("2026-01-01T00:00:00Z")) {
    this.current = start;
    this.startedAtMs = start.getTime();
  }

  now(): Date {
    return this.current;
  }

  setNow(date: Date): void {
    this.current = date;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  elapsed(ms: number): boolean {
    return this.current.getTime() - this.startedAtMs >= ms;
  }
}