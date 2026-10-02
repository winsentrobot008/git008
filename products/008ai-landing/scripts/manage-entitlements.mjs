#!/usr/bin/env node
/**
 * manage-entitlements - manual lifetime-pass grant / revoke for CALauraAI.
 *
 * The /admin console used to own this job. It is gone, so entitlement overrides
 * are now an operator CLI. The tool reads and writes the very same store file
 * the product uses (src/lib/orders-store.ts), so the two remain interchangeable:
 *
 *   <os.tmpdir()>/008ai-data/orders.json
 *
 * Usage:
 *   node scripts/manage-entitlements.mjs list
 *   node scripts/manage-entitlements.mjs stats
 *   node scripts/manage-entitlements.mjs grant  someone@example.com
 *   node scripts/manage-entitlements.mjs revoke someone@example.com
 *
 * Options:
 *   --store <path>   Operate on a different orders.json (default: the product's
 *                    own tmpdir store; the ENTITLEMENTS_STORE env var also works)
 *   --json           Emit machine-readable JSON instead of a table
 *   --help
 *
 * IMPORTANT - where the data actually lives:
 * on Vercel this store sits in /tmp, which is per-instance and wiped on every
 * cold start. A grant made here therefore only affects the machine running this
 * command. Point --store at an exported copy, or move the product onto
 * Redis/Postgres, before treating this as a production override channel.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_FILE = path.join(os.tmpdir(), "008ai-data", "orders.json");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const HELP = [
  "manage-entitlements - manual lifetime-pass control for CALauraAI",
  "",
  "  node scripts/manage-entitlements.mjs list",
  "  node scripts/manage-entitlements.mjs stats",
  "  node scripts/manage-entitlements.mjs grant  <email>",
  "  node scripts/manage-entitlements.mjs revoke <email>",
  "",
  "Options:",
  "  --store <path>   orders.json to operate on (default: " + DEFAULT_FILE + ")",
  "  --json           machine-readable output",
  "  --help",
].join("\n");

function parseArgs(argv) {
  const opts = {
    command: "",
    email: "",
    store: process.env.ENTITLEMENTS_STORE || DEFAULT_FILE,
    json: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "--store") opts.store = argv[i += 1] || "";
    else if (arg === "--help" || arg === "-h") opts.command = "help";
    else positional.push(arg);
  }
  if (!opts.command) opts.command = positional.shift() || "help";
  opts.email = positional.shift() || "";
  return opts;
}

/** Mirrors orders-store.readStore: same file, same shape, no surprises. */
function readStore(file) {
  let orders = [];
  let entitlements = {};
  if (fs.existsSync(file)) {
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    orders = Array.isArray(raw.orders) ? raw.orders : [];
    entitlements = raw.entitlements && typeof raw.entitlements === "object" ? raw.entitlements : {};
  }
  return { orders, entitlements };
}

/** Mirrors orders-store.writeStore. */
function writeStore(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}

/** Mirrors orders-store.upsertEntitlement (lowercased key, created_at kept). */
function upsertEntitlement(file, email, hasLifetimeAccess) {
  const store = readStore(file);
  const key = String(email || "").trim().toLowerCase();
  const now = new Date().toISOString();
  const existing = store.entitlements[key];
  const record = {
    email: key,
    has_lifetime_access: hasLifetimeAccess,
    source: "manual",
    updated_at: now,
    created_at: (existing && existing.created_at) || now,
  };
  store.entitlements[key] = record;
  writeStore(file, store);
  return record;
}

/** Mirrors orders-store.listEntitlements. */
function listEntitlements(file) {
  const store = readStore(file);
  return Object.values(store.entitlements).sort((a, b) =>
    String(b.updated_at).localeCompare(String(a.updated_at))
  );
}

/** Mirrors orders-store.getStats. */
function getStats(file) {
  const store = readStore(file);
  const paid = store.orders.filter((o) => o.has_lifetime_access);
  const active = Object.values(store.entitlements).filter((e) => e.has_lifetime_access);
  return {
    total_sales: paid.reduce((sum, o) => sum + (Number(o.amount) || 0), 0),
    paid_orders: paid.length,
    active_passes: active.length,
  };
}

function warnIfEphemeral(store) {
  if (path.resolve(store) !== path.resolve(DEFAULT_FILE)) return;
  console.error(
    "[note] writing to the product's own tmpdir store - on Vercel that path is " +
      "per-instance and wiped on cold start, so this only affects this machine."
  );
}

function main(argv) {
  const opts = parseArgs(argv);

  if (opts.command === "help") {
    console.log(HELP);
    return 0;
  }

  if (!opts.store) {
    console.error("error: --store needs a path");
    return 1;
  }

  try {
    if (opts.command === "list") {
      const rows = listEntitlements(opts.store);
      if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
        return 0;
      }
      if (rows.length === 0) {
        console.log("no entitlements recorded in " + opts.store);
        return 0;
      }
      for (const r of rows) {
        console.log(
          (r.has_lifetime_access ? "ACTIVE  " : "revoked ") +
            String(r.email).padEnd(38) +
            " " +
            String(r.source).padEnd(7) +
            " " +
            r.updated_at
        );
      }
      return 0;
    }

    if (opts.command === "stats") {
      const stats = getStats(opts.store);
      if (opts.json) console.log(JSON.stringify(stats, null, 2));
      else {
        console.log("total_sales   " + stats.total_sales);
        console.log("paid_orders   " + stats.paid_orders);
        console.log("active_passes " + stats.active_passes);
      }
      return 0;
    }

    if (opts.command === "grant" || opts.command === "revoke") {
      if (!opts.email) {
        console.error("error: " + opts.command + " needs an email address");
        return 1;
      }
      if (!EMAIL_RE.test(opts.email.trim())) {
        console.error("error: " + JSON.stringify(opts.email) + " is not a valid email address");
        return 1;
      }
      warnIfEphemeral(opts.store);
      const record = upsertEntitlement(opts.store, opts.email, opts.command === "grant");
      console.log(
        (record.has_lifetime_access ? "granted" : "revoked") +
          " lifetime access for " +
          record.email +
          " (store: " +
          opts.store +
          ")"
      );
      return 0;
    }

    console.error("error: unknown command " + JSON.stringify(opts.command));
    console.log(HELP);
    return 1;
  } catch (err) {
    console.error("error: " + (err && err.message ? err.message : String(err)));
    return 1;
  }
}

process.exit(main(process.argv.slice(2)));