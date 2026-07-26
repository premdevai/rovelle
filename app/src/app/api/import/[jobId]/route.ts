import { guard } from "@/lib/api";
import { AuthError } from "@/lib/auth";
import { currentAnyUser } from "@/lib/guest";
import { statusFor } from "@/lib/job-status";
import { db } from "@/lib/db";

/**
 * Guests own imports too, so this reads the guest cookie as well as the
 * session. It never *mints* a guest: a brand-new identity could not own the
 * job being asked about, and statusFor would reject it anyway.
 */
async function owner() {
  const user = await currentAnyUser();
  if (!user) throw new AuthError();
  return user;
}

/** The fallback for S2, polled every second when SSE (./stream) can't connect. */
export async function GET(_req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  return guard(async () => {
    const user = await owner();
    const { jobId } = await ctx.params;
    return statusFor(user.id, jobId);
  });
}

/** Cancel is always available (XRD §4 S2). */
export async function DELETE(_req: Request, ctx: { params: Promise<{ jobId: string }> }) {
  return guard(async () => {
    const user = await owner();
    const { jobId } = await ctx.params;
    db()
      .prepare(
        "UPDATE jobs SET status = 'failed', error = 'ERROR:Cancelled.' WHERE id = ? AND user_id = ? AND status IN ('queued','running')",
      )
      .run(jobId, user.id);
    return { ok: true };
  });
}
