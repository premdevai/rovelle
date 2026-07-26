import { en, type Dictionary, type StringKey } from "./strings";

/**
 * The client half of i18n.
 *
 * Kept separate from index.ts because that one imports `next/headers` to read
 * the locale cookie, and a client component importing it drags a server-only
 * module into the browser bundle — which is a build error, correctly.
 *
 * Server components call getT(). Client components receive the dictionary as
 * a prop and build `t` from it here.
 */
export type T = (key: StringKey) => string;

export function makeT(dict: Dictionary): T {
  return (key) => dict[key] ?? en[key];
}

export type { Dictionary, StringKey };
