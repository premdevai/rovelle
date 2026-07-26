import Link from "next/link";

/**
 * The primitives. Every screen is built from these, so a design change is a
 * change here and nowhere else.
 */

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

// ——— type ——————————————————————————————————————————————————

/** Small gold letterspaced label. `— TEXT` when a rule is asked for. */
export function Eyebrow({
  children,
  rule,
  muted,
  className,
}: {
  children: React.ReactNode;
  rule?: boolean;
  muted?: boolean;
  className?: string;
}) {
  return (
    <div className={cx("flex items-center gap-3", className)}>
      {rule && <span aria-hidden className="h-px w-8 shrink-0 bg-[hsl(var(--primary)/0.5)]" />}
      <span className={muted ? "eyebrow-muted" : "eyebrow"}>{children}</span>
    </div>
  );
}

/**
 * A display heading. `gold` marks the one word that carries the gradient —
 * the prototype does this on every section head and it's the signature.
 */
export function Display({
  children,
  gold,
  size = "lg",
  as: Tag = "h1",
  className,
}: {
  children: React.ReactNode;
  gold?: string;
  size?: "sm" | "md" | "lg" | "xl";
  as?: "h1" | "h2" | "h3";
  className?: string;
}) {
  const scale = {
    sm: "text-[22px] md:text-[26px]",
    md: "text-[28px] leading-[1.1] md:text-[38px]",
    lg: "text-[34px] leading-[1.05] md:text-[52px]",
    xl: "text-[42px] leading-[0.98] md:text-[72px] lg:text-[88px]",
  }[size];
  return (
    <Tag className={cx("font-display", scale, className)}>
      {children}
      {gold && <span className="text-gold"> {gold}</span>}
    </Tag>
  );
}

// ——— controls ————————————————————————————————————————————

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: "md" | "lg" | "xl";
};

const sizing = {
  md: "min-h-[44px] px-5 text-[15px]",
  lg: "min-h-[52px] px-7 text-[16px]",
  xl: "min-h-[64px] px-8 text-[18px]",
};

export function GoldButton({ size = "lg", className, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={cx(
        "btn-gold inline-flex items-center justify-center gap-2",
        sizing[size],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function GhostButton({ size = "lg", className, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={cx(
        "btn-ghost inline-flex items-center justify-center gap-2",
        sizing[size],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function GoldLink({
  href,
  size = "lg",
  className,
  children,
}: {
  href: string;
  size?: "md" | "lg" | "xl";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cx("btn-gold inline-flex items-center justify-center gap-2", sizing[size], className)}
    >
      {children}
    </Link>
  );
}

export function GhostLink({
  href,
  size = "lg",
  className,
  children,
}: {
  href: string;
  size?: "md" | "lg" | "xl";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cx("btn-ghost inline-flex items-center justify-center gap-2", sizing[size], className)}
    >
      {children}
    </Link>
  );
}

/** The live-dot pill from the hero. */
export function LivePill({ children }: { children: React.ReactNode }) {
  return (
    <span className="pill">
      <span aria-hidden className="dot-live h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />
      <span className="eyebrow">{children}</span>
    </span>
  );
}

// ——— surfaces ————————————————————————————————————————————

export function Card({
  children,
  className,
  ember,
}: {
  children: React.ReactNode;
  className?: string;
  ember?: boolean;
}) {
  return (
    <div className={cx("card relative overflow-hidden", ember && "ember", className)}>{children}</div>
  );
}

/** Big Fraunces number over a small caps label — the archive stat tiles. */
export function Stat({
  value,
  label,
  gold = true,
}: {
  value: React.ReactNode;
  label: string;
  gold?: boolean;
}) {
  return (
    <div className="text-center">
      <div
        className={cx(
          "font-display text-[34px] leading-none md:text-[44px]",
          gold && "text-gold",
        )}
      >
        {value}
      </div>
      <div className="eyebrow-muted mt-3">{label}</div>
    </div>
  );
}

/** Label above a value, used in the recipe meta row. */
export function MetaStat({
  label,
  children,
  icon,
}: {
  label: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5">
        {icon && <span className="text-[hsl(var(--primary)/0.8)]">{icon}</span>}
        <span className="eyebrow-muted">{label}</span>
      </div>
      <div className="font-display mt-1.5 text-[24px] leading-none md:text-[28px]">{children}</div>
    </div>
  );
}

/** One line, what happened and the next move, no apology. */
export function ErrorLine({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="mt-4 text-[14px] leading-[1.5] text-[hsl(var(--destructive))]"
    >
      {children}
    </p>
  );
}

// ——— icons ————————————————————————————————————————————————
// Inline so the bundle stays dependency-free. 1.25em, currentColor, no fills.

const ico = "h-[1em] w-[1em]";

export const IconClock = () => (
  <svg className={ico} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" strokeLinecap="round" />
  </svg>
);

export const IconServes = () => (
  <svg className={ico} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <circle cx="9" cy="8" r="3" />
    <path d="M3 20a6 6 0 0 1 12 0M16 11a3 3 0 1 0-2-5.2M18 20a5 5 0 0 0-3-4.6" strokeLinecap="round" />
  </svg>
);

export const IconFlame = () => (
  <svg className={ico} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M12 3s5 4.5 5 9a5 5 0 0 1-10 0c0-1.6.8-3 1.6-4 .2 1.3 1 2 1.9 2 1.2 0 1.8-1.1 1.5-2.6-.2-1.3-.6-2.6 0-4.4Z" />
  </svg>
);

export const IconMic = () => (
  <svg className={ico} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
  </svg>
);

export const IconCheck = () => (
  <svg className={ico} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="m5 13 4 4 10-10" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconArrow = () => (
  <svg className={ico} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M4 12h15m-6-6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const IconPlay = () => (
  <svg className={ico} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M8 5.5v13l11-6.5z" />
  </svg>
);
