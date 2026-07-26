import { notFound, redirect } from "next/navigation";
import { currentAnyUser } from "@/lib/guest";
import { getBySlug } from "@/lib/recipes";
import { getT } from "@/lib/i18n";
import CookHost from "./cook-host";

export const dynamic = "force-dynamic";

/** S6 — Cook Mode. */
export default async function CookPage({ params }: { params: Promise<{ slug: string }> }) {
  // A guest may read and cook what they just made. Keeping it is what
  // needs an account, not using it.
  const user = await currentAnyUser();
  if (!user) redirect("/");
  const { slug } = await params;
  const { dict } = await getT();

  const found = getBySlug(user.id, slug);
  if (!found) notFound();

  return <CookHost slug={slug} recipe={found.rrf} dict={dict} />;
}
