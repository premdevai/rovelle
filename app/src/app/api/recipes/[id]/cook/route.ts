import { z } from "zod";
import { guard } from "@/lib/api";
import { currentOrGuestUser } from "@/lib/guest";
import { completeCook, getById, startCookSession, updateCookStep } from "@/lib/recipes";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), step: z.number().int().nonnegative().default(0) }),
  z.object({ action: z.literal("step"), sessionId: z.string(), step: z.number().int().nonnegative() }),
  z.object({ action: z.literal("complete"), sessionId: z.string().nullish() }),
]);

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const user = await currentOrGuestUser();
    const { id } = await ctx.params;
    if (!getById(user.id, id)) throw new Error("No such recipe.");
    const body = Body.parse(await req.json());

    if (body.action === "start") {
      return { sessionId: startCookSession(user.id, id, body.step) };
    }
    if (body.action === "step") {
      updateCookStep(user.id, body.sessionId, body.step);
      return { ok: true };
    }
    completeCook(user.id, id, body.sessionId ?? null);
    const found = getById(user.id, id)!;
    return { ok: true, cookedCount: found.row.cooked_count };
  });
}
