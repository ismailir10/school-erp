#!/usr/bin/env node
/**
 * vendor-wilayah.mjs — build lib/wilayah/data/wilayah.json (+ NOTICE.txt).
 *
 * Purpose: the pendaftaran address step looks up Kelurahan / Kecamatan /
 * Kota-Kabupaten / Provinsi from a 5-digit kode pos, entirely on our server
 * (no third-party call at runtime). The dataset is the join of two MIT repos
 * on the Kemendagri area code:
 *   - cahyadsn/wilayah          db/wilayah.sql            names (Kepmendagri 300.2.2-2138 Tahun 2025)
 *   - cahyadsn/wilayah_kodepos  json/wilayah_kodepos.json kelurahan code -> kode pos
 * Both are pinned to the commits below, so a build never depends on a moving branch.
 *
 * Output (deterministic: same input -> identical bytes):
 *   lib/wilayah/data/wilayah.json  compact interned layout
 *     { v, source, p:[provinsi], r:[[kotaKab, pIdx]], d:[[kecamatan, rIdx]],
 *       k:{ "40115": [[kelurahan, dIdx], ...] } }
 *   lib/wilayah/data/NOTICE.txt    both MIT licenses verbatim + pinned SHAs + regulation
 *
 * Usage:
 *   node scripts/vendor-wilayah.mjs                 # download pinned files from raw.githubusercontent.com
 *   node scripts/vendor-wilayah.mjs --from <dir>    # offline: <dir>/{cahyadsn_wilayah|wilayah}/ and <dir>/wilayah_kodepos/
 *                                                   #   are local clones (read only, never executed)
 *
 * How to refresh: pick the new upstream commits, bump the two SHA constants
 * below, run `node scripts/vendor-wilayah.mjs`, review the JSON diff, commit
 * both output files. The script exits non-zero (and writes nothing) if the
 * data fails validation. Behind a proxy, run with NODE_USE_ENV_PROXY=1.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WILAYAH_REPO = "cahyadsn/wilayah";
const WILAYAH_SHA = "5d450ccbc94cc487f54bf2a262300efe97aa58af";
const KODEPOS_REPO = "cahyadsn/wilayah_kodepos";
const KODEPOS_SHA = "ba8497156c5cc9bcbfc527f7b8875d403eda2354";
const REGULATION = "Kepmendagri Nomor 300.2.2-2138 Tahun 2025";
const FORMAT_VERSION = 1;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "lib/wilayah/data");

// Sanity bounds (real: 38 / 514 / 7,285 / 83,762). Wide enough for a refresh,
// tight enough to catch a truncated or wrong file.
const BOUNDS = {
  provinces: [34, 45],
  regencies: [450, 600],
  districts: [6500, 8500],
  villages: [75_000, 95_000],
};

function fail(msg) {
  console.error(`vendor-wilayah: ${msg}`);
  process.exit(1);
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------- input

const args = process.argv.slice(2);
const fromIdx = args.indexOf("--from");
const fromDir = fromIdx >= 0 ? args[fromIdx + 1] : null;
if (fromIdx >= 0 && !fromDir) fail("--from needs a directory");
if (args.some((a, i) => a !== "--from" && i !== fromIdx + 1)) fail(`unknown argument; usage: [--from <dir>]`);

async function download(repo, sha, path) {
  const url = `https://raw.githubusercontent.com/${repo}/${sha}/${path}`;
  const res = await fetch(url);
  if (!res.ok) fail(`GET ${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString("utf8");
}

function readLocal(dirs, path) {
  for (const d of dirs) {
    const p = join(fromDir, d, path);
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  fail(`${path} not found under ${fromDir}/{${dirs.join("|")}}`);
}

function warnIfWrongSha(dirs, sha) {
  for (const d of dirs) {
    const head = join(fromDir, d, ".git/HEAD");
    if (!existsSync(head)) continue;
    const v = readFileSync(head, "utf8").trim();
    if (/^[0-9a-f]{40}$/.test(v) && v !== sha) console.warn(`vendor-wilayah: warning: ${d} is at ${v}, pinned ${sha}`);
    return;
  }
}

async function load() {
  if (fromDir) {
    const wd = ["cahyadsn_wilayah", "wilayah"];
    const kd = ["wilayah_kodepos"];
    warnIfWrongSha(wd, WILAYAH_SHA);
    warnIfWrongSha(kd, KODEPOS_SHA);
    return {
      sql: readLocal(wd, "db/wilayah.sql"),
      kodeposJson: readLocal(kd, "json/wilayah_kodepos.json"),
      wilayahLicense: readLocal(wd, "LICENSE"),
      kodeposLicense: readLocal(kd, "LICENSE"),
    };
  }
  const [sql, kodeposJson, wilayahLicense, kodeposLicense] = await Promise.all([
    download(WILAYAH_REPO, WILAYAH_SHA, "db/wilayah.sql"),
    download(KODEPOS_REPO, KODEPOS_SHA, "json/wilayah_kodepos.json"),
    download(WILAYAH_REPO, WILAYAH_SHA, "LICENSE"),
    download(KODEPOS_REPO, KODEPOS_SHA, "LICENSE"),
  ]);
  return { sql, kodeposJson, wilayahLicense, kodeposLicense };
}

// ---------------------------------------------------------------- parse

/** `('32.73.09.1003','Citarum'),` one tuple per line; SQL escapes are `''` and `\'`. */
function parseWilayahSql(sql) {
  const names = new Map();
  const row = /^\('((?:[^'\\]|\\.|'')*)','((?:[^'\\]|\\.|'')*)'\)[,;]?\s*$/;
  for (const line of sql.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!line.startsWith("('")) continue;
    const m = row.exec(line);
    if (!m) fail(`unparseable wilayah.sql row: ${line.slice(0, 120)}`);
    const kode = m[1];
    const nama = m[2].replace(/\\'/g, "'").replace(/''/g, "'").trim();
    if (!/^\d{2}(\.\d{2}(\.\d{2}(\.\d{4})?)?)?$/.test(kode)) fail(`bad kode "${kode}"`);
    if (!nama) fail(`empty name for ${kode}`);
    if (names.has(kode)) fail(`duplicate kode ${kode}`);
    names.set(kode, nama);
  }
  return names;
}

function build({ sql, kodeposJson }) {
  const names = parseWilayahSql(sql);
  const kodepos = JSON.parse(kodeposJson);
  if (!kodepos || typeof kodepos !== "object" || Array.isArray(kodepos)) fail("wilayah_kodepos.json is not an object");

  const level = (k) => k.split(".").length;
  const provCodes = [...names.keys()].filter((k) => level(k) === 1).sort(cmp);
  const regCodes = [...names.keys()].filter((k) => level(k) === 2).sort(cmp);
  const kelCodes = [...names.keys()].filter((k) => level(k) === 4).sort(cmp);

  const within = (name, [lo, hi], n) => {
    if (n < lo || n > hi) fail(`${name} count ${n} outside sane bounds ${lo}..${hi}`);
  };
  within("provinces", BOUNDS.provinces, provCodes.length);
  within("regencies", BOUNDS.regencies, regCodes.length);
  within("villages", BOUNDS.villages, kelCodes.length);

  // Every kelurahan needs a parent chain, a kode pos, and nothing may be orphaned.
  const parent = (k, n) => k.split(".").slice(0, n).join(".");
  for (const k of regCodes) if (!names.has(parent(k, 1))) fail(`regency ${k} has no province`);
  const districtCodes = new Set();
  for (const k of kelCodes) {
    const d = parent(k, 3);
    if (!names.has(d)) fail(`kelurahan ${k} has no kecamatan`);
    if (!names.has(parent(k, 2))) fail(`kelurahan ${k} has no kota/kabupaten`);
    districtCodes.add(d);
  }
  const distCodes = [...districtCodes].sort(cmp);
  within("districts", BOUNDS.districts, distCodes.length);
  const allDistricts = [...names.keys()].filter((k) => level(k) === 3).length;
  if (allDistricts !== distCodes.length) fail(`${allDistricts - distCodes.length} kecamatan have no kelurahan`);

  for (const [kode, pc] of Object.entries(kodepos)) {
    if (!names.has(kode) || level(kode) !== 4) fail(`kode pos for unknown kelurahan ${kode}`);
    if (typeof pc !== "string" || !/^\d{5}$/.test(pc)) fail(`kode pos for ${kode} is not 5 digits: ${JSON.stringify(pc)}`);
  }
  for (const k of kelCodes) if (!(k in kodepos)) fail(`kelurahan ${k} (${names.get(k)}) has no kode pos`);

  const pIdx = new Map(provCodes.map((c, i) => [c, i]));
  const rIdx = new Map(regCodes.map((c, i) => [c, i]));
  const dIdx = new Map(distCodes.map((c, i) => [c, i]));

  const byPostal = new Map();
  for (const k of kelCodes) {
    const pc = kodepos[k];
    if (!byPostal.has(pc)) byPostal.set(pc, []);
    byPostal.get(pc).push([names.get(k), dIdx.get(parent(k, 3))]);
  }
  const k = {};
  for (const pc of [...byPostal.keys()].sort(cmp)) k[pc] = byPostal.get(pc);

  const counts = {
    provinsi: provCodes.length,
    kotaKab: regCodes.length,
    kecamatan: distCodes.length,
    kelurahan: kelCodes.length,
    kodePos: byPostal.size,
  };
  const data = {
    v: FORMAT_VERSION,
    source: {
      names: { repo: WILAYAH_REPO, sha: WILAYAH_SHA, file: "db/wilayah.sql" },
      kodePos: { repo: KODEPOS_REPO, sha: KODEPOS_SHA, file: "json/wilayah_kodepos.json" },
      regulation: REGULATION,
      counts,
    },
    p: provCodes.map((c) => names.get(c)),
    r: regCodes.map((c) => [names.get(c), pIdx.get(parent(c, 1))]),
    d: distCodes.map((c) => [names.get(c), rIdx.get(parent(c, 2))]),
    k,
  };
  return { data, counts };
}

function notice({ wilayahLicense, kodeposLicense }) {
  const rule = "=".repeat(78);
  return [
    "Wilayah data notice",
    rule,
    "lib/wilayah/data/wilayah.json is generated by scripts/vendor-wilayah.mjs from two MIT-licensed",
    "repositories, pinned to the commits below. Area names follow:",
    `  ${REGULATION}`,
    "",
    `1. ${WILAYAH_REPO}  (area codes and names, db/wilayah.sql)`,
    `   https://github.com/${WILAYAH_REPO}/tree/${WILAYAH_SHA}`,
    `2. ${KODEPOS_REPO}  (kode pos per kelurahan, json/wilayah_kodepos.json)`,
    `   https://github.com/${KODEPOS_REPO}/tree/${KODEPOS_SHA}`,
    "",
    rule,
    `LICENSE of ${WILAYAH_REPO} @ ${WILAYAH_SHA}`,
    rule,
    wilayahLicense.trimEnd(),
    "",
    rule,
    `LICENSE of ${KODEPOS_REPO} @ ${KODEPOS_SHA}`,
    rule,
    kodeposLicense.trimEnd(),
    "",
  ].join("\n");
}

// ---------------------------------------------------------------- main

const input = await load();
for (const [name, text] of [
  ["wilayah LICENSE", input.wilayahLicense],
  ["wilayah_kodepos LICENSE", input.kodeposLicense],
]) {
  if (!/MIT License/i.test(text)) fail(`${name} is not an MIT license text`);
}
const { data, counts } = build(input);
mkdirSync(OUT_DIR, { recursive: true });
const json = JSON.stringify(data) + "\n";
writeFileSync(join(OUT_DIR, "wilayah.json"), json);
writeFileSync(join(OUT_DIR, "NOTICE.txt"), notice(input));
console.log(
  `vendor-wilayah: wrote lib/wilayah/data/wilayah.json (${Buffer.byteLength(json)} bytes) and NOTICE.txt — ` +
    Object.entries(counts)
      .map(([n, c]) => `${c} ${n}`)
      .join(", "),
);
