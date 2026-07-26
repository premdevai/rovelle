/**
 * Every flow, against one real server.
 *
 *   npm run e2e          # builds, then runs
 *   npm run e2e:only     # skips the build, for a fast second pass
 *
 * Flows share a server and a database on purpose — a suite that resets between
 * tests never catches the bug where yesterday's row breaks today's query.
 * They do not share a Client: each one is its own browser with its own cookies.
 */

import { DB_FILE, baseUrl, startServer, stopServer, type Flow, type Ok } from "./harness";
import { guestImport, guestIsolation } from "./guest-import";
import { saveGate, claimCollision } from "./save-gate";
import { importDoors, importCache, importLimits } from "./imports";
import { cookFlow, askFlow, recipeExtras } from "./cook";
import { askStreaming, importStreaming, deltaPump } from "./streaming";
import { voiceCoverage } from "./voice";
import { pages, account } from "./pages";

const FLOWS: Flow[] = [
  guestImport,
  guestIsolation,
  saveGate,
  claimCollision,
  importDoors,
  importCache,
  importLimits,
  cookFlow,
  askFlow,
  askStreaming,
  deltaPump,
  importStreaming,
  voiceCoverage,
  recipeExtras,
  pages,
  account,
];

async function main() {
  console.log(`db  ${DB_FILE}`);
  await startServer();
  console.log(`up  ${baseUrl()}\n`);

  let passed = 0;
  const failures: string[] = [];

  for (const flow of FLOWS) {
    console.log(flow.name);
    const ok: Ok = async (label, fn) => {
      try {
        await fn();
        passed++;
        console.log(`  ✓ ${label}`);
      } catch (e) {
        failures.push(`${flow.name}\n    ${label}\n    ${message(e)}`);
        console.log(`  ✗ ${label}\n      ${message(e)}`);
      }
    };
    try {
      await flow.run(ok);
    } catch (e) {
      // A flow can die before it reaches its own assertions — a setup step
      // that throws is a failure of the flow, not a reason to skip the rest.
      failures.push(`${flow.name}\n    (setup)\n    ${message(e)}`);
      console.log(`  ✗ flow aborted: ${message(e)}`);
    }
    console.log("");
  }

  if (failures.length) {
    console.log(`${failures.length} failed, ${passed} passed\n`);
    for (const f of failures) console.log(`  ${f}\n`);
    return 1;
  }
  console.log(`${passed} checks passed across ${FLOWS.length} flows.\n`);
  return 0;
}

const message = (e: unknown) =>
  e instanceof Error ? (e.message.split("\n").slice(0, 6).join("\n    ") || e.name) : String(e);

main()
  .then((code) => {
    stopServer();
    process.exit(code);
  })
  .catch((e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    stopServer();
    process.exit(1);
  });
