import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DeskApi } from "../src/chain";
import type { Runtime } from "../src/types";
const root = fileURLToPath(new URL("../../", import.meta.url));
const deployment = JSON.parse(
  readFileSync(resolve(root, "dist/imd-deployment.json"), "utf8"),
);
const abis: Runtime["abis"] = {};
for (const name of [
  "HandlerDesk",
  "HandlerArt",
  "HandlerCards",
  "LaunchToken",
  "ERC20",
  "Permit2",
  "Quoter",
  "UniversalRouter",
])
  abis[name] = JSON.parse(
    readFileSync(resolve(root, `dist/abi/${name}.json`), "utf8"),
  );
const api = new DeskApi({ deployment, abis });
const report: any = {
  at: new Date().toISOString(),
  mode: "Read only; no signed or broadcast transactions",
  rpcChecks: [],
};
for (const url of deployment.network.rpcUrls) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      }),
      signal: AbortSignal.timeout(12000),
    });
    report.rpcChecks.push({
      url,
      status: response.status,
      body: await response.json(),
    });
  } catch (e) {
    report.rpcChecks.push({ url, error: (e as Error).message });
  }
}
try {
  report.state = await api.verify();
  report.verification = "passed";
  try {
    const state = report.state;
    report.mintQuote = await api.quote(
      api.imd,
      api.hic,
      state.mintPrice - state.mintPrice / 2n,
      50n,
    );
    report.quote = "passed (simulation only)";
  } catch (e) {
    report.quote = "unavailable";
    report.quoteError = (e as Error).message.slice(0, 1000);
  }
} catch (e) {
  report.verification = "unavailable";
  report.error = (e as Error).message.slice(0, 2000);
}
const output =
  JSON.stringify(
    report,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ) + "\n";
writeFileSync(resolve(root, "docs/frontend/live-read.json"), output);
console.log(output);
