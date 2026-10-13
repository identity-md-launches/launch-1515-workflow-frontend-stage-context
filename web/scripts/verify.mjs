import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { dist, json, deployment, abiHash } from "./shared.mjs";
const manifest = json(resolve(dist, "imd-deployment.json"));
const { assets, ...config } = manifest;
assert.deepEqual(config, deployment());
assert(assets.length <= 128 && assets.length > 0);
const safe = (p) =>
  typeof p === "string" &&
  !p.startsWith("/") &&
  !p.includes("..") &&
  !p.includes(":") &&
  !p.includes("\\");
let bytes = 0;
for (const asset of assets) {
  assert(safe(asset.path));
  const data = readFileSync(resolve(dist, asset.path));
  bytes += data.length;
  assert(data.length <= 8388608);
  assert.equal(asset.sha256, createHash("sha256").update(data).digest("hex"));
}
function walk(p = "") {
  return readdirSync(resolve(dist, p)).flatMap((n) => {
    const path = p ? `${p}/${n}` : n;
    return statSync(resolve(dist, path)).isDirectory() ? walk(path) : [path];
  });
}
assert.deepEqual(
  assets.map((a) => a.path).sort(),
  walk()
    .filter((p) => p !== "imd-deployment.json")
    .sort(),
);
assert(assets.some((a) => a.path === "index.html"));
for (const c of manifest.contracts) {
  assert(safe(c.abiPath));
  assert.equal(abiHash(json(resolve(dist, c.abiPath))), c.abiHash);
}
assert(bytes < 32 * 1024 * 1024);
assert(
  !readFileSync(resolve(dist, "index.html"), "utf8").match(
    /(?:src|href)="\/(?!\/)/,
  ),
);
console.log(
  `Verified exact handoff + network + poolKey; ${assets.length} assets, ${bytes} bytes; all SHA-256 and ABI Keccak hashes match.`,
);
