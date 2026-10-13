import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { erc20Abi, parseAbi } from "viem";
import {
  root,
  web,
  handoff,
  abiHash,
  deployment,
  canonical,
  network,
} from "./shared.mjs";
const out = resolve(web, "public");
mkdirSync(resolve(out, "abi"), { recursive: true });
for (const [name, data] of [
  ["deployment", handoff],
  ["network", network],
]) {
  const input = resolve(root, `.imd/reads/${name}.json`);
  if (
    existsSync(input) &&
    canonical(JSON.parse(readFileSync(input, "utf8"))) !== canonical(data)
  )
    throw Error(`${name} differs from pinned handoff`);
}
for (const name of [...handoff.contracts.map((c) => c.name), "HandlerCards"]) {
  const source = execFileSync(
    "git",
    ["show", `${handoff.sourceCommit}:docs/abi/${name}.json`],
    { cwd: root, encoding: "utf8" },
  );
  const abi = JSON.parse(source);
  const expected = handoff.contracts.find((c) => c.name === name)?.abiHash;
  if (expected && expected !== abiHash(abi))
    throw Error(`ABI hash mismatch: ${name}: ${abiHash(abi)}`);
  if (
    canonical(abi) !==
    canonical(
      JSON.parse(readFileSync(resolve(root, `docs/abi/${name}.json`), "utf8")),
    )
  )
    throw Error(`Working ABI differs from pinned source: ${name}`);
  writeFileSync(resolve(out, `abi/${name}.json`), source);
  console.log(
    `${name}: canonical Keccak ${abiHash(abi)}${expected ? " verified against handoff" : " (derived child)"}`,
  );
}
const key =
  "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const interfaces = {
  ERC20: erc20Abi,
  Quoter: parseAbi([
    `function quoteExactInputSingle((${key} poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)`,
  ]),
  UniversalRouter: parseAbi([
    "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
  ]),
  Permit2: parseAbi([
    "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
    "function approve(address token,address spender,uint160 amount,uint48 expiration)",
  ]),
};
for (const [name, abi] of Object.entries(interfaces))
  writeFileSync(
    resolve(out, `abi/${name}.json`),
    JSON.stringify(abi, null, 2) + "\n",
  );
writeFileSync(
  resolve(out, "imd-deployment.json"),
  JSON.stringify({ ...deployment(), assets: [] }, null, 2) + "\n",
);

writeFileSync(
  resolve(out, "agent-guide.md"),
  readFileSync(resolve(root, "docs/frontend/agent-guide.md")),
);
await import("./notices.mjs");
