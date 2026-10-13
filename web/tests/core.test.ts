import test from "node:test";
import assert from "node:assert/strict";
import { decodeAbiParameters, parseAbiParameters, zeroAddress } from "viem";
import {
  amount,
  slippage,
  minimum,
  rank,
  routerInput,
  checkQuote,
  validateName,
  explain,
  address,
  MAX_SWAP,
} from "../src/logic";
import { switchNetwork } from "../src/chain";
import { readFileSync } from "node:fs";
const deployment = JSON.parse(
  readFileSync(
    new URL("../../dist/imd-deployment.json", import.meta.url),
    "utf8",
  ),
);
const key = deployment.poolKey;
const runtime = { deployment, abis: {} } as any;
test("amount parsing preserves exact base units and rejects rounding/exponent/negative/zero/overflow", () => {
  assert.equal(
    amount("123456789123456789.123456789123456789"),
    123456789123456789123456789123456789n,
  );
  assert.equal(amount("1.123456", 6), 1123456n);
  assert.equal(amount("0", 18, true), 0n);
  for (const text of ["-1", "0", "1e18", "1.0000001", ".5", "NaN", ""])
    assert.throws(() => amount(text, 6));
  assert.throws(() => amount((MAX_SWAP + 1n).toString(), 0));
});
test("slippage applies to outputs with a positive minimum and a 5% ceiling", () => {
  assert.equal(slippage("0.5"), 50n);
  assert.equal(minimum(10000n, 50n), 9950n);
  assert.throws(() => slippage("5.01"));
  assert.throws(() => slippage("0"));
  assert.throws(() => minimum(1n, 50n));
});
test("name validation and address input validation", () => {
  assert.equal(validateName("Atlas 42-A"), "Atlas 42-A");
  for (const s of ["", "  ", "<script>", "é", "A".repeat(25)])
    assert.throws(() => validateName(s));
  assert.throws(() => address(zeroAddress));
  assert.equal(address(zeroAddress, true), zeroAddress);
});
test("leaderboard uses >=10 sells, exact rational rate comparison and signed P&L", () => {
  const a = { id: 1n, wins: 9n, losses: 1n, pnl: -1n },
    b = { id: 2n, wins: 18n, losses: 2n, pnl: 4n },
    c = { id: 3n, wins: 8n, losses: 1n, pnl: 1000n },
    d = {
      id: 4n,
      wins: 900000000000000001n,
      losses: 100000000000000000n,
      pnl: -9n,
    };
  assert.deepEqual(
    rank([a, b, c, d] as any, "rate").map((x) => x.id),
    [4n, 1n, 2n],
  );
  assert.deepEqual(
    rank([a, b, c, d] as any, "pnl").map((x) => x.id),
    [2n, 1n, 4n],
  );
});
test("router exact-input encoding retains the attested hook and both currency directions", () => {
  for (const extended of [false, true])
    for (const input of [key.currency0, key.currency1]) {
      const data = routerInput(key, input, 1000n, 900n, extended);
      const [actions, params] = decodeAbiParameters(
        parseAbiParameters("bytes,bytes[]"),
        data,
      );
      assert.equal(actions, "0x060c0f");
      const tuple = parseAbiParameters(
        `((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,${extended ? "uint256 minHopPriceX36," : ""}bytes hookData)`,
      );
      const [swap] = decodeAbiParameters(tuple, params[0]) as any;
      assert.equal(swap.poolKey.hooks.toLowerCase(), key.hooks);
      assert.equal(swap.amountIn, 1000n);
      assert.equal(swap.amountOutMinimum, 900n);
      assert.equal(swap.zeroForOne, input === key.currency0);
      if (extended) assert.equal(swap.minHopPriceX36, 0n);
      const [settle, value] = decodeAbiParameters(
        parseAbiParameters("address,uint256"),
        params[1],
      );
      assert.equal(settle.toLowerCase(), input);
      assert.equal(value, 1000n);
      const [take, min] = decodeAbiParameters(
        parseAbiParameters("address,uint256"),
        params[2],
      );
      assert.equal(
        take.toLowerCase(),
        input === key.currency0 ? key.currency1 : key.currency0,
      );
      assert.equal(min, 900n);
    }
});
test("stale and changed quotes are rejected", () => {
  const q = { input: key.currency0, amount: 10n, at: Date.now() } as any;
  checkQuote(q, key.currency0, 10n);
  assert.throws(() => checkQuote(q, key.currency0, 11n));
  assert.throws(() =>
    checkQuote({ ...q, at: Date.now() - 61000 }, key.currency0, 10n),
  );
});
test("desk fee arithmetic matches integer rounding on buys and net sells", () => {
  const gross = 1000000000000000000n;
  assert.equal(gross - gross / 400n, 997500000000000000n);
  const sell = 1001n;
  assert.equal(minimum(sell - sell / 400n, 50n), 994n);
});
test("unknown wallet chain triggers add then switch with unchanged network payload", async () => {
  const calls: any[] = [];
  let first = true;
  const provider = {
    request: async (req: any) => {
      calls.push(req);
      if (req.method === "wallet_switchEthereumChain" && first) {
        first = false;
        throw { code: 4902 };
      }
    },
  };
  await switchNetwork(provider as any, runtime);
  assert.deepEqual(
    calls.map((c) => c.method),
    [
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ],
  );
  assert.deepEqual(calls[1].params, [deployment.walletAddChain]);
});
test("wallet switch rejection does not add a chain", async () => {
  const calls: any[] = [];
  await assert.rejects(
    switchNetwork(
      {
        request: async (req: any) => {
          calls.push(req);
          throw { code: 4001 };
        },
      } as any,
      runtime,
    ),
  );
  assert.equal(calls.length, 1);
});
test("contract and wallet errors have actionable messages", () => {
  assert.match(
    explain({ cause: { data: { errorName: "DailyLimit" } } }),
    /remaining UTC daily cap/,
  );
  assert.match(explain({ cause: { code: 4001 } }), /declined/);
  assert.match(explain(new Error("insufficient funds")), /ETH/);
});

test("token and slippage changes invalidate an in-flight quote", () => {
  const q = {
    input: key.currency0,
    output: key.currency1,
    amount: 10n,
    at: Date.now(),
    slippageBps: 50n,
  } as any;
  checkQuote(q, key.currency0, 10n, key.currency1, 50n);
  assert.throws(() => checkQuote(q, key.currency0, 10n, key.currency0, 50n));
  assert.throws(() => checkQuote(q, key.currency0, 10n, key.currency1, 10n));
});
