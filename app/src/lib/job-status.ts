import { getJob, failureCopy, readEvents, PHASES, type JobEvent } from "./jobs";
import { getById } from "./recipes";

export type { JobEvent };

export type PhaseView = {
  key: string;
  label: string;
  state: "done" | "running" | "waiting";
  seconds: number | null;
};

export type JobStatus = {
  status: "queued" | "running" | "done" | "failed";
  phases: PhaseView[];
  recipeId: string | null;
  slug: string | null;
  error: { message: string; fallback: string } | null;
  elapsedS: number;
  /** The live feed, oldest first (contract C2). */
  events: JobEvent[];
};

/**
 * What S2 renders. Deliberately not the raw job row: the cook sees named
 * phases in their own terms, never "Invoking ASR pipeline" (XRD §4 S2).
 */
export function statusFor(userId: string, jobId: string): JobStatus {
  const job = getJob(jobId);
  if (!job || job.user_id !== userId) throw new Error("No such import.");

  const timings = JSON.parse(job.timings) as Record<string, number>;
  const currentIdx = PHASES.findIndex((p) => p.key === job.phase);

  const phases: PhaseView[] = PHASES.map((p, i) => {
    const reached = timings[p.key] !== undefined;
    const isLast = i === currentIdx;
    let state: PhaseView["state"] = "waiting";
    if (job.status === "done") state = "done";
    else if (job.status === "failed") state = reached && !isLast ? "done" : "waiting";
    else if (reached && !isLast) state = "done";
    else if (isLast) state = "running";

    // Elapsed at the moment the NEXT phase started — i.e. how long this one took.
    const next = PHASES[i + 1];
    const end = next && timings[next.key] !== undefined ? timings[next.key] : undefined;
    const seconds =
      reached && end !== undefined ? Math.max(0, (end - timings[p.key]) / 1000) : null;

    return { key: p.key, label: p.label, state, seconds };
  });

  let slug: string | null = null;
  if (job.result_recipe_id) {
    slug = getById(userId, job.result_recipe_id)?.row.slug ?? null;
  }

  return {
    status: job.status,
    phases,
    recipeId: job.result_recipe_id,
    slug,
    error: job.status === "failed" ? failureCopy(job.error) : null,
    elapsedS: Math.max(...Object.values(timings).concat(0)) / 1000,
    events: readEvents(job),
  };
}
