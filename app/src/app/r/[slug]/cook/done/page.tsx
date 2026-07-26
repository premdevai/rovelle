import { notFound, redirect } from "next/navigation";
import { currentAnyUser } from "@/lib/guest";
import { getBySlug } from "@/lib/recipes";
import { getT } from "@/lib/i18n";
import DoneForm from "./done-form";

export const dynamic = "force-dynamic";

/** S7 — Cook complete. */
export default async function DonePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ min?: string }>;
}) {
  // A guest may read and cook what they just made. Keeping it is what
  // needs an account, not using it.
  const user = await currentAnyUser();
  if (!user) redirect("/");
  const { slug } = await params;
  const { min } = await searchParams;
  const { dict } = await getT();

  const found = getBySlug(user.id, slug);
  if (!found) notFound();

  return (
    <DoneForm
      slug={slug}
      recipeId={found.row.id}
      title={found.rrf.title}
      minutes={Number(min) || null}
      cookedCount={found.row.cooked_count}
      dict={dict}
    />
  );
}
