import { z } from "zod";
import { guard } from "@/lib/api";
import { currentOrGuestUser, guestGuard, isGuest, NeedsAccountError } from "@/lib/guest";
import { Recipe } from "@/lib/rrf";
import { deleteRecipe, getById, saveRecipe } from "@/lib/recipes";

const Body = z.object({
  rrf: Recipe,
  /** S3 "Save to cookbook" flips draft → saved. Editing a saved recipe doesn't. */
  status: z.enum(["draft", "saved", "archived"]).optional(),
  /** True from the edit screen and from any confirmed review. Latches forever. */
  userEdited: z.boolean().optional(),
});

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const user = await currentOrGuestUser();
    const { id } = await ctx.params;
    const found = getById(user.id, id);
    if (!found) throw new Error("No such recipe.");
    return { rrf: found.rrf, slug: found.row.slug, status: found.row.status };
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guestGuard(async () => {
    const user = await currentOrGuestUser();
    const { id } = await ctx.params;
    const body = Body.parse(await req.json());

    // The one gate. A guest may edit their draft all day; keeping it is what
    // needs an account, because a cookbook nobody owns is a cookbook nobody
    // gets back.
    if (body.status === "saved" && isGuest(user)) {
      throw new NeedsAccountError("Sign in to keep this in your cookbook. Your edits stay.");
    }

    const saved = saveRecipe(user.id, id, body.rrf, {
      status: body.status,
      userEdited: body.userEdited,
    });
    const found = getById(user.id, id)!;
    return { rrf: saved, slug: found.row.slug, status: found.row.status };
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const user = await currentOrGuestUser();
    const { id } = await ctx.params;
    deleteRecipe(user.id, id);
    return { ok: true };
  });
}
