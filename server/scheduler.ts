/**
 * The scheduler. Runs publisher payouts and marketplace-fee invoicing on a
 * timetable instead of waiting for an admin to press a button.
 *
 * ── Why this is not just node-cron ───────────────────────────────────────────
 * Three things make an in-memory cron unsafe for moving money:
 *
 *   1. It fires only while the process is alive. A redeploy at 09:00 on Monday
 *      skips that week's payout run silently, and nobody finds out until a
 *      publisher asks where their money is.
 *   2. Every instance fires. Two instances means everyone is paid twice.
 *   3. It leaves no record, so "did Monday run?" is unanswerable.
 *
 * So each schedule occurrence is CLAIMED as a row in scheduled_job_runs, under a
 * Postgres advisory lock, with a unique index on (job_name, scheduled_for). Two
 * instances racing the same window both try to insert; exactly one wins. A
 * missed window is caught up, because the tick asks "when should this last have
 * run?" (cron.previousOccurrence) and compares that to what actually did, rather
 * than only firing on the exact minute.
 *
 * ── Off by default ───────────────────────────────────────────────────────────
 * SCHEDULER_ENABLED must be set to "true". Automated money movement should be
 * switched on deliberately, once, by someone who means it — not acquired as a
 * side effect of deploying.
 *
 * ── What it will not do ──────────────────────────────────────────────────────
 * It never retries a run that died mid-flight. Such a row stays `running` and is
 * left for a human, because re-running a half-finished payout is exactly the
 * thing that pays somebody twice. It reports; it does not guess.
 */
import { parseCron, previousOccurrence, cronMatches, type CronSpec } from "./cron";

export interface JobResult {
  status: "success" | "failed" | "skipped";
  items: number;
  detail: string;
}

export interface ScheduledJob {
  name: string;
  /** Standard 5-field cron, UTC. */
  schedule: string;
  run: () => Promise<JobResult>;
}

export interface SchedulerStore {
  /**
   * Claim one occurrence, atomically. Returns null if it is already claimed.
   *
   * MUST be a single transaction taking an advisory lock on the job name, and
   * MUST rely on the unique index rather than a read-then-write — two instances
   * ticking within the same second is the normal case, not the edge case.
   */
  claimRun(jobName: string, scheduledFor: Date): Promise<{ id: string } | null>;
  completeRun(runId: string, result: JobResult): Promise<void>;
  /** The occurrence of the most recent run, whatever its outcome. */
  lastRunOccurrence(jobName: string): Promise<Date | null>;
}

/** Every minute. A finer tick buys nothing; cron's resolution is the minute. */
const TICK_MS = 60_000;

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private readonly specs = new Map<string, CronSpec>();

  constructor(
    private readonly store: SchedulerStore,
    private readonly jobs: ScheduledJob[],
    private readonly log: (msg: string) => void = (m) => console.log(m),
  ) {
    for (const job of jobs) this.specs.set(job.name, parseCron(job.schedule));
  }

  start() {
    if (this.timer) return;
    this.log(`[Scheduler] starting with ${this.jobs.length} job(s):`);
    for (const j of this.jobs) this.log(`[Scheduler]   ${j.name} — ${j.schedule} (UTC)`);
    // Tick once now so a deploy that lands after a missed window catches it up
    // immediately rather than waiting for the next minute boundary.
    void this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    // Do not hold the event loop open on shutdown.
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One pass over every job. Public so a test, or an admin "run due jobs now"
   * endpoint, can drive it deterministically instead of waiting on wall clock.
   */
  async tick(now: Date = new Date()): Promise<void> {
    // Guard against a slow run overlapping the next tick WITHIN this process.
    // Across processes the claim is what protects us, not this flag.
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const job of this.jobs) {
        try {
          await this.runIfDue(job, now);
        } catch (err) {
          this.log(`[Scheduler] ${job.name} tick error: ${(err as Error)?.message ?? err}`);
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private async runIfDue(job: ScheduledJob, now: Date): Promise<void> {
    const spec = this.specs.get(job.name)!;
    const due = previousOccurrence(spec, now);
    if (!due) return;

    const last = await this.store.lastRunOccurrence(job.name);
    // Already handled — either this exact occurrence, or a later one.
    if (last && last.getTime() >= due.getTime()) return;

    const claim = await this.store.claimRun(job.name, due);
    if (!claim) return; // another instance won the race

    this.log(`[Scheduler] ${job.name} running for ${due.toISOString()}`);
    let result: JobResult;
    try {
      result = await job.run();
    } catch (err) {
      result = { status: "failed", items: 0, detail: (err as Error)?.message ?? String(err) };
    }
    await this.store.completeRun(claim.id, result);
    this.log(`[Scheduler] ${job.name} ${result.status} — ${result.detail}`);
  }
}

/** Exported for tests: is this expression due at this instant? */
export function isDueAt(expr: string, at: Date): boolean {
  return cronMatches(parseCron(expr), at);
}
