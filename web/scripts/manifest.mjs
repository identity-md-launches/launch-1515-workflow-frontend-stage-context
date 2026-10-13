import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { dist, deployment } from "./shared.mjs";
function walk(p = "") {
  return readdirSync(resolve(dist, p)).flatMap((n) => {
    const path = p ? `${p}/${n}` : n;
    return statSync(resolve(dist, path)).isDirectory() ? walk(path) : [path];
  });
}
const assets = walk()
  .filter((p) => p !== "imd-deployment.json")
  .sort()
  .map((path) => ({
    path,
    sha256: createHash("sha256")
      .update(readFileSync(resolve(dist, path)))
      .digest("hex"),
  }));
writeFileSync(
  resolve(dist, "imd-deployment.json"),
  JSON.stringify({ ...deployment(), assets }, null, 2) + "\n",
);
await import("./verify.mjs");
