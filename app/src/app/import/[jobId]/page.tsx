import { redirect } from "next/navigation";
import { currentAnyUser } from "@/lib/guest";
import { Shell } from "@/components/shell";
import { statusFor } from "@/lib/job-status";
import { getT } from "@/lib/i18n";
import Progress from "./progress";

export const dynamic = "force-dynamic";

/** S2 — Import in progress. A named phase list, never a spinner. */
export default async function ImportProgressPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  // A guest owns their import. Sending them to /enter here is the login screen
  // the whole guest flow exists to avoid; no identity at all means no job.
  const user = await currentAnyUser();
  if (!user) redirect("/");
  const { jobId } = await params;
  const { dict } = await getT();

  let initial;
  try {
    initial = statusFor(user.id, jobId);
  } catch {
    redirect("/import");
  }

  // Already finished before the page rendered — a cache hit, usually.
  if (initial.status === "done" && initial.recipeId) redirect(`/import/${jobId}/review`);

  return (
    <Shell active="import">
      <div className="mx-auto max-w-[560px]">
        <Progress jobId={jobId} initial={initial} dict={dict} />
      </div>
    </Shell>
  );
}
