import { keccak256, sha256, toBytes, isAddress } from "viem";
import type { Abi } from "viem";
import type { Deployment, Runtime } from "./types";
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            canonical((value as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
const safePath = (path: string) =>
  typeof path === "string" &&
  !path.startsWith("/") &&
  !path.includes("..") &&
  !path.includes(":") &&
  !path.includes("\\");
async function getJson(path: string, expectedSha256?: string) {
  if (!safePath(path)) throw Error("Invalid deployment asset path.");
  const response = await fetch(new URL(path, document.baseURI), {
    cache: "no-cache",
  });
  if (!response.ok)
    throw Error(`Unable to load ${path}. Reload the page to retry.`);
  const text = await response.text();
  if (expectedSha256) {
    const hash = sha256(toBytes(text)).slice(2);
    if (hash !== expectedSha256)
      throw Error(`Asset verification failed: ${path}.`);
  }
  return JSON.parse(text);
}
export async function loadRuntime(): Promise<Runtime> {
  const deployment: Deployment = await getJson("imd-deployment.json");
  if (
    deployment.version !== 1 ||
    !deployment.network ||
    deployment.chainId !== deployment.network.chainId ||
    !deployment.poolKey
  )
    throw Error(
      "Deployment configuration is incomplete. Transactions are unavailable.",
    );
  const abis: Record<string, Abi> = {};
  for (const contract of deployment.contracts) {
    if (!isAddress(contract.address))
      throw Error("Invalid deployment address.");
    const abi = await getJson(contract.abiPath);
    if (
      !Array.isArray(abi) ||
      keccak256(toBytes(canonical(abi))).slice(2) !== contract.abiHash
    )
      throw Error(
        `${contract.name} ABI verification failed. Transactions are unavailable.`,
      );
    abis[contract.name] = abi;
  }
  for (const required of ["HandlerDesk", "HandlerArt", "LaunchToken"])
    if (!abis[required]) throw Error(`Missing ${required} deployment.`);
  for (const name of [
    "HandlerCards",
    "ERC20",
    "Quoter",
    "UniversalRouter",
    "Permit2",
  ]) {
    const path = `abi/${name}.json`;
    const declared = deployment.assets.find((a) => a.path === path);
    const abi = await getJson(path, declared?.sha256);
    if (!Array.isArray(abi)) throw Error(`Invalid ${name} ABI.`);
    // The development manifest has no inventory. Production always includes these assets.
    if (deployment.assets.length && !declared)
      throw Error(`Undeclared ${name} ABI.`);
    abis[name] = abi;
  }
  return { deployment, abis };
}
