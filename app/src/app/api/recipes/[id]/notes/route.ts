import { z } from "zod";
import { guard } from "@/lib/api";
import { currentOrGuestUser } from "@/lib/guest";
import { addNote, deleteNote } from "@/lib/recipes";

const Body = z.object({
  body: z.string().min(1).max(4000),
  author: z.string().max(60).nullish(),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const user = await currentOrGuestUser();
    const { id } = await ctx.params;
    const { body, author } = Body.parse(await req.json());
    return { rrf: addNote(user.id, id, body, author ?? null) };
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const user = await currentOrGuestUser();
    const { id } = await ctx.params;
    const noteId = new URL(req.url).searchParams.get("noteId");
    if (!noteId) throw new Error("Which note?");
    deleteNote(user.id, id, noteId);
    return { ok: true };
  });
}
