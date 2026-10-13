import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { keccak256, toBytes } from "viem";
export const root = fileURLToPath(new URL("../../", import.meta.url));
export const web = resolve(root, "web");
export const dist = resolve(root, "dist");
export const json = (p) => JSON.parse(readFileSync(p, "utf8"));
export const handoff = json(resolve(web, "deployment/handoff.json"));
export const network = json(resolve(web, "deployment/network.json"));
export function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export const abiHash = (abi) => keccak256(toBytes(canonical(abi))).slice(2);
export const deployment = () => ({
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts: handoff.contracts.map(({ name, address, abiHash }) => ({
    name,
    address,
    abiHash,
    abiPath: `abi/${name}.json`,
  })),
  poolKey: handoff.poolKey,
  ...network,
});
