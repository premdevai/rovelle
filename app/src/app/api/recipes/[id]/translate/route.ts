import { guard } from "@/lib/api";
import { currentOrGuestUser } from "@/lib/guest";
import { getById } from "@/lib/recipes";
import { isLanguage, translateRecipe } from "@/lib/translate-recipe";
import { mode } from "@/lib/sarvam";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const user = await currentOrGuestUser();
    const { id } = await ctx.params;
    const { language } = (await req.json()) as { language: string };
    if (!isLanguage(language)) throw new Error("We don't have that language yet.");

    const found = getById(user.id, id);
    if (!found) throw new Error("No such recipe.");

    if (mode("translate") === "mock" && language !== "en-IN") {
      throw new Error(
        "Translation needs Sarvam. Set SARVAM_MODE_TRANSLATE=live to render this recipe in another language.",
      );
    }

    return { rrf: await translateRecipe(found.rrf, language), language };
  });
}
