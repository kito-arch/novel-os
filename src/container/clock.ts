export interface Clock {
  now(): Date;
  // Returns true when at least `ms` milliseconds have elapsed since the clock
  // was created/started. Used for polling timeouts and rate-limit windows.
  elapsed(ms: number): boolean;
}