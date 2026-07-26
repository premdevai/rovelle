import { NextRequest } from "next/server";
import { z } from "zod";
import {
  currentOrGuestUser,
  guestGuard,
  importsLeftFor,
  isGuest,
  GUEST_IMPORTS,
  NeedsAccountError,
} from "@/lib/guest";
import {
  cachedDraft,
  detectPlatform,
  enqueue,
  FREE_MONTHLY_IMPORTS,
  spendImport,
} from "@/lib/jobs";
import { statusFor } from "@/lib/job-status";

const Body = z
  .object({
    url: z.string().url().optional(),
    rawText: z.string().min(40, "Paste a bit more — we need at least a caption's worth.").optional(),
    imageBase64: z.string().min(100).optional(),
    imageName: z.string().optional(),
    language: z.string().optional(),
  })
  .refine((b) => !!b.url || !!b.rawText || !!b.imageBase64, {
    message: "Give us a link, paste the caption, or upload a screenshot.",
  });

export async function POST(req: NextRequest) {
  return guestGuard(async () => {
    const user = await currentOrGuestUser();
    const input = Body.parse(await req.json());

    if (input.url && !detectPlatform(input.url)) {
      throw new Error(
        "That link isn't a video we can read. Try a Reel, Short, TikTok, or YouTube link.",
      );
    }

    // A cache hit is free — somebody already paid to extract this reel, so it
    // doesn't cost the user one of their five (TECH-SPEC §5).
    const seed = input.url ? cachedDraft(input.url) : null;

    let left = importsLeftFor(user);
    if (!seed) {
      if (isGuest(user) && left === 0) {
        throw new NeedsAccountError("Sign in to import more. What you've already made stays.");
      }
      const spent = spendImport(user);
      if (spent === false) {
        throw new Error(
          `You've used your ${FREE_MONTHLY_IMPORTS} imports this month. Cook Mode stays open — only importing is capped.`,
        );
      }
      // spendImport counts against the free tier's five; a guest's ceiling is
      // GUEST_IMPORTS, so their remainder is computed here rather than read
      // off a return value that answers a different question.
      left = isGuest(user) ? Math.max(0, GUEST_IMPORTS - (user.imports_this_period + 1)) : spent;
    }

    const job = enqueue(user.id, seed ? { ...input, seedDraft: seed } : input);
    return { jobId: job.id, cached: !!seed, importsLeft: left };
  });
}

export async function GET(req: NextRequest) {
  return guestGuard(async () => {
    const user = await currentOrGuestUser();
    const jobId = req.nextUrl.searchParams.get("jobId");
    // No jobId means "what's my import allowance?"
    if (!jobId) return { importsLeft: importsLeftFor(user), plan: user.plan, guest: isGuest(user) };
    return statusFor(user.id, jobId);
  });
}
