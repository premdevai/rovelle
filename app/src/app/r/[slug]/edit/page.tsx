import { notFound, redirect } from "next/navigation";
import { currentAnyUser } from "@/lib/guest";
import { Shell } from "@/components/shell";
import { Display, Eyebrow } from "@/components/ui";
import { getBySlug } from "@/lib/recipes";
import EditForm from "./edit-form";

export const dynamic = "force-dynamic";

/** S5 — Recipe edit. Same editor as review; the cook's version always wins. */
export default async function EditPage({ params }: { params: Promise<{ slug: string }> }) {
  // A guest may read and cook what they just made. Keeping it is what
  // needs an account, not using it.
  const user = await currentAnyUser();
  if (!user) redirect("/");
  const { slug } = await params;

  const found = getBySlug(user.id, slug);
  if (!found) notFound();

  return (
    <Shell active="cookbook">
      <div className="max-w-[760px]">
        <Eyebrow rule>Editing</Eyebrow>
        <Display size="md" className="mt-4">
          {found.rrf.title}
        </Display>
        <EditForm recipeId={found.row.id} slug={slug} initial={found.rrf} />
      </div>
    </Shell>
  );
}
