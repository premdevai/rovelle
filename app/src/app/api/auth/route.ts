import { NextRequest } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/api";
import { clearSession, issueOtp, redeemOtp, setSession } from "@/lib/auth";
import { claimGuestSession } from "@/lib/guest";

const Body = z.object({
  email: z.string().email("That doesn't look like an email address."),
  code: z.string().regex(/^\d{6}$/).optional(),
});

export async function POST(req: NextRequest) {
  return guard(async () => {
    const { email, code } = Body.parse(await req.json());
    const normalised = email.trim().toLowerCase();

    if (!code) {
      const issued = issueOtp(normalised);
      // No mail provider is wired yet, so in development the code comes back
      // in the response. In production it only reaches the server log until
      // you plug in a sender — which is a deliberate, visible gap.
      return {
        sent: true,
        devCode: process.env.NODE_ENV === "production" ? undefined : issued,
      };
    }

    const user = redeemOtp(normalised, code);
    if (!user) throw new Error("That code is wrong or has expired. Ask for a new one.");

    // Hand over before the session flips. If this throws, the sign-in fails
    // loudly and the guest cookie is still valid — the work is still reachable.
    // Setting the session first would strand it behind an identity nobody
    // sends a cookie for any more.
    const claimed = await claimGuestSession(user.id);

    await setSession(user.id);
    return { ok: true, email: user.email, claimed };
  });
}

export async function DELETE() {
  return guard(async () => {
    await clearSession();
    return { ok: true };
  });
}
