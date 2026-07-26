import { redirect } from "next/navigation";
import { currentAnyUser } from "@/lib/guest";
import { Shell } from "@/components/shell";
import { getJob } from "@/lib/jobs";
import { getById, cookbookStats } from "@/lib/recipes";
import { getT } from "@/lib/i18n";
import ReviewForm from "./review-form";

export const dynamic = "force-dynamic";

/**
 * S3 — Review & confirm. The most important screen in the import flow.
 * Never auto-saves. Confirming is how the recipe becomes theirs rather than
 * the model's (XRD §4 S3).
 */
export default async function ReviewPage({ params }: { params: Promise<{ jobId: string }> }) {
  // Reviewing and editing is free. The account is asked for by ReviewForm at
  // the moment they try to keep it, not on the way in.
  const user = await currentAnyUser();
  if (!user) redirect("/");
  const { jobId } = await params;

  const job = getJob(jobId);
  if (!job || job.user_id !== user.id) redirect("/import");
  if (job.status !== "done" || !job.result_recipe_id) redirect(`/import/${jobId}`);

  const found = getById(user.id, job.result_recipe_id);
  if (!found) redirect("/import");

  // Already confirmed once — go to the recipe rather than re-review it.
  if (found.row.status !== "draft") redirect(`/r/${found.row.slug}`);

  // Onboarding-critical: on a first import, cooking now is the primary action
  // (PRD R7 — the cold-start churn is people who import and never cook).
  const isFirstImport = cookbookStats(user.id).cooked === 0;

  return (
    <Shell active="import">
      <div className="max-w-[760px]">
        <ReviewForm
          recipeId={found.row.id}
          slug={found.row.slug}
          initial={found.rrf}
          cookFirst={isFirstImport}
        />
      </div>
    </Shell>
  );
}
