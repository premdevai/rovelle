"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { JobStatus } from "@/lib/job-status";
import { Display, Eyebrow, GhostButton, IconArrow, IconCheck } from "@/components/ui";
import { makeT, type Dictionary, type StringKey } from "@/lib/i18n/client";

/**
 * A 30-second wait with visible progress reads as work. A 30-second spinner
 * reads as broken. So: the four worker stages as a spine, and under them the
 * feed of what the machine is actually doing right now — the title it found,
 * the megabytes it pulled, the first words it heard. Something new lands
 * every couple of seconds, which is the difference between waiting and
 * watching.
 */
export default function Progress({
  jobId,
  initial,
  dict,
}: {
  jobId: string;
  initial: JobStatus;
  dict: Dictionary;
}) {
  const t = makeT(dict);
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [stalled, setStalled] = useState(false);
  const [waited, setWaited] = useState(0);
  const done = status.status === "done" || status.status === "failed";

  useEffect(() => {
    if (done) return;
    const tick = setInterval(() => setWaited((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, [done]);

  useEffect(() => {
    if (done) return;
    let stopped = false;
    let poll: ReturnType<typeof setInterval> | undefined;

    const apply = (next: JobStatus) => {
      setStatus(next);
      if (next.status === "done") router.replace(`/import/${jobId}/review`);
      if (next.status === "done" || next.status === "failed") stop();
    };

    // SSE first; the 1s poll is what runs when a proxy eats the stream.
    const startPolling = () => {
      if (stopped || poll) return;
      let misses = 0;
      poll = setInterval(async () => {
        try {
          const res = await fetch(`/api/import/${jobId}`, { cache: "no-store" });
          if (!res.ok) throw new Error(String(res.status));
          misses = 0;
          setStalled(false);
          apply((await res.json()) as JobStatus);
        } catch {
          // Silently retrying forever renders as a live screen that is lying.
          // Five seconds of no contact is worth saying out loud.
          if (++misses >= 5) setStalled(true);
        }
      }, 1000);
    };

    const es = new EventSource(`/api/import/${jobId}/stream`);
    es.onmessage = (ev) => apply(JSON.parse(ev.data) as JobStatus);
    es.onerror = () => {
      // Also fires on the clean close after 'done'; stopped guards that.
      es.close();
      startPolling();
    };

    function stop() {
      stopped = true;
      es.close();
      if (poll) clearInterval(poll);
    }
    return stop;
  }, [jobId, done, router]);

  if (status.status === "failed" && status.error) {
    return (
      <div className="animate-fade-up card p-7 md:p-9">
        <Eyebrow rule>Didn&rsquo;t work</Eyebrow>
        <Display size="md" className="mt-5">
          {status.error.message}
        </Display>
        <p className="mt-4 text-[16px] leading-[1.6] text-[hsl(var(--muted-foreground))]">
          {t("progress.recover")}
        </p>
        <Link href="/import" className="btn-gold mt-8 inline-flex min-h-[52px] items-center gap-2 px-7 text-[16px]">
          {status.error.fallback} <IconArrow />
        </Link>
      </div>
    );
  }

  const pct = [...status.events].reverse().find((e) => e.pct !== undefined)?.pct ?? 0;

  return (
    <div className="animate-fade-up card p-7 md:p-9">
      <Eyebrow rule>Importing</Eyebrow>
      <Display size="md" className="mt-5">
        {t("progress.title")}
      </Display>

      <div
        className="mt-7 h-[3px] w-full overflow-hidden rounded-full bg-[hsl(var(--border)/0.7)]"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("progress.title")}
      >
        <div
          className="h-full rounded-full bg-[hsl(var(--primary))] transition-[width] duration-700 ease-out"
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>

      {stalled && (
        <p className="mt-4 text-[14px] text-[hsl(var(--primary))]" role="status">
          Lost contact with the server. Still trying — your import is safe and
          this page will catch up on its own.
        </p>
      )}

      <ol className="mt-5">
        {status.phases.map((p) => (
          <li
            key={p.key}
            className="flex items-center gap-4 border-b border-[hsl(var(--border)/0.7)] py-4 last:border-b-0"
          >
            <span
              aria-hidden
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] ${
                p.state === "waiting"
                  ? "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground)/0.5)]"
                  : "bg-[hsl(var(--primary)/0.16)] text-[hsl(var(--primary))]"
              }`}
            >
              {p.state === "done" ? (
                <IconCheck />
              ) : p.state === "running" ? (
                <span className="dot-live h-1.5 w-1.5 rounded-full bg-current" />
              ) : (
                <span className="h-1 w-1 rounded-full bg-current" />
              )}
            </span>
            <span
              className={`flex-1 text-[16px] ${
                p.state === "waiting"
                  ? "text-[hsl(var(--muted-foreground)/0.6)]"
                  : "text-[hsl(var(--foreground))]"
              }`}
            >
              {t(`progress.${p.key}` as StringKey)}
            </span>
            {p.seconds !== null && (
              <span className="data text-[13px] text-[hsl(var(--muted-foreground))]">
                {p.seconds.toFixed(1)}s
              </span>
            )}
          </li>
        ))}
      </ol>

      <Feed events={status.events} />

      <p className="sr-only" aria-live="polite">
        {status.events.at(-1)?.note ??
          status.phases.find((p) => p.state === "running")?.label ??
          "Finishing up"}
      </p>

      {waited > 60 && (
        <p className="mt-7 max-w-[46ch] text-[15px] leading-[1.6] text-[hsl(var(--muted-foreground))]">
          {t("progress.long")}
        </p>
      )}

      <div className="mt-8 flex items-center gap-4">
        <GhostButton
          size="md"
          onClick={async () => {
            await fetch(`/api/import/${jobId}`, { method: "DELETE" });
            router.push("/import");
          }}
        >
          {t("progress.cancel")}
        </GhostButton>
        <span className="data text-[13px] text-[hsl(var(--muted-foreground))]">{waited}s</span>
      </div>
    </div>
  );
}

/**
 * Newest last, so it reads like a log rather than a notification stack, and
 * the scroll is pinned to the bottom for the same reason. Capped height so a
 * 44-chunk video doesn't push cancel off a phone screen.
 */
function Feed({ events }: { events: JobStatus["events"] }) {
  const box = useRef<HTMLDivElement>(null);
  const t0 = events[0]?.at ?? 0;

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });
  }, [events.length]);

  if (events.length === 0) return null;

  return (
    <div
      ref={box}
      className="mt-6 max-h-[168px] overflow-y-auto border-t border-[hsl(var(--border)/0.7)] pt-4"
    >
      <ul className="space-y-1.5">
        {events.map((e, i) => (
          <li key={`${e.at}-${i}`} className="flex gap-3 text-[14px] leading-[1.5]">
            <span className="data shrink-0 tabular-nums text-[12px] leading-[1.7] text-[hsl(var(--muted-foreground)/0.55)]">
              {((e.at - t0) / 1000).toFixed(1)}s
            </span>
            <span
              className={
                i === events.length - 1
                  ? "text-[hsl(var(--foreground))]"
                  : "text-[hsl(var(--muted-foreground))]"
              }
            >
              {e.note}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
