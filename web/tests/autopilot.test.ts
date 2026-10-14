import test from "node:test";
import assert from "node:assert/strict";
import { parseUnits, type Address } from "viem";
import {
  newAgent,
  encryptSecrets,
  decryptSecrets,
  ITERATIONS,
  redact,
} from "../src/autopilot/vault";
import {
  DEFAULT_RULES,
  rulesDecision,
  validateDecision,
  parseDecision,
  change,
  watchlist,
  aiSnapshot,
  type Snapshot,
  type Decision,
} from "../src/autopilot/model";
import { askAI, DEFAULT_AI, providerEndpoint } from "../src/autopilot/ai";
import {
  AutopilotEngine,
  PendingTransactionError,
  type Activity,
} from "../src/autopilot/engine";
const E = (s: string) => parseUnits(s, 18);
const agent = newAgent(),
  coin = newAgent().address,
  foreign = newAgent().address;
function snapshot(): Snapshot {
  return {
    now: 50_000_000,
    balance: E("10"),
    spent: E("0.2"),
    card: {
      id: 1n,
      name: "Test card",
      holder: newAgent().address,
      agent: agent.address,
      frozen: false,
      dailyCap: E("2"),
      maxPerTrade: E("0.5"),
      day: 0n,
      spentToday: E("0.2"),
      mintedAt: 0n,
      trades: 0n,
      wins: 0n,
      losses: 0n,
      pnl: 0n,
      volume: 0n,
    },
    coins: [
      {
        address: coin,
        symbol: "COIN",
        decimals: 18,
        tradable: true,
        quantity: E("2"),
        cost: E("1"),
        value: E("1.1"),
        price: 0.55,
        samples: Array.from({ length: 10 }, (_, i) => 1 + i * 0.01),
        heldSince: 45_000_000,
      },
    ],
  };
}
test("fresh secp256k1 keys and AES-GCM/PBKDF2 round trip; tampering, wrong password and context rejected", async () => {
  const second = newAgent();
  assert.notEqual(agent.privateKey, second.privateKey);
  assert.notEqual(agent.address, second.address);
  const secret = {
    privateKey: agent.privateKey,
    apiKey: "test-provider-secret",
    providerBinding: "anthropic:https://api.anthropic.com/v1/messages",
  };
  const pass = "a sufficiently long test phrase";
  const encrypted = await encryptSecrets(secret, pass, "card:1");
  assert.equal(ITERATIONS, 200_000);
  assert.equal(encrypted.iterations, 200_000);
  assert.deepEqual(await decryptSecrets(encrypted, pass, "card:1"), secret);
  assert.ok(!JSON.stringify(encrypted).includes(secret.apiKey));
  assert.ok(!JSON.stringify(encrypted).includes(secret.privateKey));
  assert.notEqual(
    (await encryptSecrets(secret, pass, "card:1")).ciphertext,
    encrypted.ciphertext,
  );
  await assert.rejects(decryptSecrets(encrypted, "wrong passphrase", "card:1"));
  await assert.rejects(decryptSecrets(encrypted, pass, "card:2"));
  await assert.rejects(
    decryptSecrets(
      { ...encrypted, ciphertext: "AAAA" + encrypted.ciphertext.slice(4) },
      pass,
      "card:1",
    ),
  );
  await assert.rejects(encryptSecrets(secret, "short", "card:1"));
});
test("validator rejects oversized, below-minimum, foreign/untradable, frozen, revoked and excessive sells", () => {
  const s = snapshot(),
    buy: Decision = { action: "buy", coin, imd: "0.5", reason: "test" };
  assert.equal(
    validateDecision(buy, s, agent.address, E("0.5"))?.amount,
    E("0.5"),
  );
  for (const input of [
    { ...buy, imd: "0.500000000000000001" },
    { ...buy, imd: "0.09" },
    { ...buy, imd: "NaN" },
    { ...buy, coin: foreign },
    { action: "sell", coin, quantity: E("2.0001"), reason: "test" },
    { action: "sell", coin, imd: "1.2", reason: "test" },
  ] as Decision[])
    assert.throws(() => validateDecision(input, s, agent.address, E("0.5")));
  assert.throws(() =>
    validateDecision(buy, { ...s, balance: E("0.4") }, agent.address, E("0.5")),
  );
  assert.throws(() =>
    validateDecision(buy, { ...s, spent: E("1.6") }, agent.address, E("0.5")),
  );
  assert.throws(() => validateDecision(buy, s, agent.address, E("0.3")));
  assert.throws(() =>
    validateDecision(
      buy,
      { ...s, card: { ...s.card, frozen: true } },
      agent.address,
      E("0.5"),
    ),
  );
  assert.throws(() => validateDecision(buy, s, foreign, E("0.5")));
  assert.throws(() =>
    validateDecision(
      buy,
      { ...s, coins: [{ ...s.coins[0], tradable: false }] },
      agent.address,
      E("0.5"),
    ),
  );
  assert.equal(
    validateDecision(
      { action: "sell", coin, imd: "0.55", reason: "half" },
      s,
      agent.address,
      E("0.5"),
    )?.amount,
    E("1"),
  );
  assert.equal(
    validateDecision(
      { action: "sell", coin, imd: "1.1", reason: "all" },
      s,
      agent.address,
      E("0.5"),
    )?.amount,
    E("2"),
  );
});
test("malformed AI replies are holds and model transaction fields never become executable", () => {
  for (const text of [
    "",
    "```json\n{}\n```",
    "[]",
    '{"action":"withdraw"}',
    '{"action":"buy","coin":"oops","imd":".5","reason":"test"}',
    '{"action":"sell","coin":"' + coin + '","imd":2,"reason":"test"}',
  ])
    assert.equal(parseDecision(text).action, "hold");
  const d = parseDecision(
    JSON.stringify({
      action: "sell",
      coin,
      imd: "0.55",
      reason: "test",
      quantity: "10000000000000000000",
      privateKey: agent.privateKey,
      to: foreign,
    }),
  );
  assert.equal(d.quantity, undefined);
  assert.ok(!JSON.stringify(d).includes(agent.privateKey));
});
test("rules: momentum, minimum budget, every exit, cooldown, and sample windows", () => {
  const s = snapshot();
  s.coins[0].quantity = 0n;
  assert.equal(rulesDecision(s, DEFAULT_RULES, E("0.5")).action, "buy");
  assert.equal(
    rulesDecision({ ...s, spent: E("1.95") }, DEFAULT_RULES, E("0.5")).action,
    "hold",
  );
  s.coins[0].lastSold = s.now - 1000;
  assert.equal(rulesDecision(s, DEFAULT_RULES, E("0.5")).action, "hold");
  s.coins[0].lastSold = s.now - 3_600_001;
  assert.equal(rulesDecision(s, DEFAULT_RULES, E("0.5")).action, "buy");
  for (const value of ["1.12", "0.92"]) {
    const exit = snapshot();
    exit.coins[0].value = E(value);
    assert.equal(rulesDecision(exit, DEFAULT_RULES, E("0.5")).action, "sell");
  }
  const old = snapshot();
  old.coins[0].heldSince = old.now - 43_200_000;
  assert.equal(rulesDecision(old, DEFAULT_RULES, E("0.5")).action, "sell");
  assert.equal(change([1, 2], 10), null);
  assert.equal(change([1, 2], 2), 100);
  assert.equal(
    rulesDecision(snapshot(), DEFAULT_RULES, E("0.5")).action,
    "hold",
  );
  assert.throws(() =>
    rulesDecision(s, { ...DEFAULT_RULES, samples: 61 }, E("0.5")),
  );
  assert.equal(watchlist(`${coin}\n${coin}`).length, 1);
  assert.throws(() => watchlist("bad-address"));
});
test("provider calls carry only the provider key; snapshot excludes private material; errors never echo response", async () => {
  const original = globalThis.fetch,
    requests: { url: string; init: RequestInit }[] = [];
  const apiKey = "provider-secret-for-this-test";
  globalThis.fetch = (async (
    url: string | URL | Request,
    init: RequestInit,
  ) => {
    requests.push({ url: String(url), init });
    return new Response(
      JSON.stringify(
        String(url).includes("anthropic")
          ? {
              content: [
                { type: "text", text: '{"action":"hold","reason":"wait"}' },
              ],
            }
          : {
              choices: [
                { message: { content: '{"action":"hold","reason":"wait"}' } },
              ],
            },
      ),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    assert.equal(
      (await askAI(DEFAULT_AI, apiKey, snapshot(), E("0.5"))).action,
      "hold",
    );
    assert.equal(
      (
        await askAI(
          {
            ...DEFAULT_AI,
            provider: "compatible",
            url: "https://provider.example/v1",
            model: "own-model",
          },
          apiKey,
          snapshot(),
          E("0.5"),
        )
      ).action,
      "hold",
    );
    assert.equal(requests.length, 2);
    for (const { url, init } of requests) {
      assert.ok(
        [
          "https://api.anthropic.com/v1/messages",
          "https://provider.example/v1/chat/completions",
        ].includes(url),
      );
      assert.ok(JSON.stringify(init.headers).includes(apiKey));
      assert.ok(!String(init.body).includes(apiKey));
      assert.ok(!JSON.stringify(init).includes(agent.privateKey));
      assert.equal(init.redirect, "error");
      assert.equal(init.credentials, "omit");
    }
    assert.equal(
      (requests[0].init.headers as Record<string, string>)[
        "anthropic-dangerous-direct-browser-access"
      ],
      "true",
    );
    const publicSnapshot = aiSnapshot(snapshot(), E("0.5"));
    assert.ok(JSON.stringify(publicSnapshot).includes("change60Percent"));
    assert.ok(!JSON.stringify(publicSnapshot).includes(agent.privateKey));
    globalThis.fetch = (async () =>
      new Response(apiKey, { status: 401 })) as typeof fetch;
    await assert.rejects(
      askAI(DEFAULT_AI, apiKey, snapshot(), E("0.5")),
      (e) => !String(e).includes(apiKey) && String(e).includes("401"),
    );
    assert.throws(() =>
      providerEndpoint({
        ...DEFAULT_AI,
        provider: "compatible",
        url: "http://insecure.example/v1",
      }),
    );
    assert.throws(() =>
      providerEndpoint({
        ...DEFAULT_AI,
        provider: "compatible",
        url: "https://user:pass@example.com/v1",
      }),
    );
    assert.equal(
      redact(`test ${agent.privateKey} ${apiKey}`, {
        privateKey: agent.privateKey,
        apiKey,
      }),
      "test [redacted] [redacted]",
    );
  } finally {
    globalThis.fetch = original;
  }
});
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 200 && !fn(); i++)
    await new Promise((r) => setTimeout(r, 2));
  assert.ok(fn(), "timed out waiting for engine");
};
function harness(
  overrides: Partial<ConstructorParameters<typeof AutopilotEngine>[0]> = {},
  interval = 60_000,
) {
  const entries: Activity[] = [];
  let sends = 0,
    reads = 0;
  const engine = new AutopilotEngine(
    {
      agent: agent.address,
      size: E("0.5"),
      brain: "rules",
      read: async () => {
        reads++;
        return snapshot();
      },
      decide: async () => ({ action: "buy", coin, imd: "0.5", reason: "test" }),
      send: async (_a, _s, hash) => {
        sends++;
        const h = `0x${"ab".repeat(32)}` as const;
        hash(h);
        return h;
      },
      activity: (e) => {
        entries.push({ ...e });
      },
      state: () => {},
      safe: (e) => String(e),
      ...overrides,
    },
    interval,
  );
  return { engine, entries, sends: () => sends, reads: () => reads };
}
test("engine revalidates after decision, blocks changed limits, and sends at most once per check", async () => {
  const h = harness();
  h.engine.start();
  await until(() => !h.engine.busy);
  h.engine.stop();
  assert.equal(h.sends(), 1);
  assert.equal(h.reads(), 2);
  assert.equal(h.entries.at(-1)?.decision, "buy confirmed");
  let reads = 0;
  const changed = harness({
    read: async () => {
      const s = snapshot();
      if (++reads === 2) s.card.frozen = true;
      return s;
    },
  });
  changed.engine.start();
  await until(() => !changed.engine.busy);
  changed.engine.stop();
  assert.equal(changed.sends(), 0);
  assert.equal(changed.entries.at(-1)?.decision, "skipped");
});
test("engine nonoverlap, stop during brain request, and accelerated interval", async () => {
  let resolve!: (d: Decision) => void;
  const h = harness(
    {
      decide: async () =>
        new Promise((r) => {
          resolve = r;
        }),
    },
    5,
  );
  h.engine.start();
  await until(() => !!resolve);
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(h.reads(), 1);
  h.engine.stop();
  resolve({ action: "buy", coin, imd: "0.5", reason: "too late" });
  await until(() => !h.engine.busy);
  assert.equal(h.sends(), 0);
  const timed = harness({}, 5);
  timed.engine.start();
  await until(() => timed.sends() >= 3);
  timed.engine.stop();
  assert.ok(timed.sends() >= 3);
});
test("engine stops after three failed sends, or immediately on unknown confirmation", async () => {
  let failures = 0;
  const h = harness({
    send: async () => {
      failures++;
      throw Error("mock insufficient gas");
    },
  });
  h.engine.start();
  await until(() => !h.engine.busy);
  await h.engine.tick();
  await h.engine.tick();
  assert.equal(failures, 3);
  assert.equal(h.engine.running, false);
  assert.match(h.entries.at(-1)!.reason, /3 failed sends/);
  const unknown = harness({
    send: async () => {
      throw new PendingTransactionError("unknown confirmation");
    },
  });
  unknown.engine.start();
  await until(() => !unknown.engine.busy);
  assert.equal(unknown.engine.running, false);
});

test("activity retains the last 200 checks and updates a submitted line instead of duplicating it", async () => {
  const { mergeActivity } = await import("../src/autopilot/activity");
  let lines: Activity[] = [];
  for (let i = 0; i < 205; i++)
    lines = mergeActivity(lines, {
      id: String(i),
      time: Date.now(),
      brain: "rules",
      decision: "hold",
      reason: "Waiting",
    });
  assert.equal(lines.length, 200);
  assert.equal(lines[0].id, "5");
  lines = mergeActivity(lines, {
    ...lines.at(-1)!,
    decision: "buy confirmed",
    hash: `0x${"ab".repeat(32)}`,
  });
  assert.equal(lines.length, 200);
  assert.equal(lines.at(-1)?.decision, "buy confirmed");
});

test("chain adapter quotes 0.05 IMD, drops ineligible coins and caps samples at 60", async () => {
  const { AutopilotChain } = await import("../src/autopilot/adapter");
  const s = snapshot();
  s.coins[0].quantity = 0n;
  const quotes: bigint[] = [];
  const fake = {
    imd: foreign,
    desk: foreign,
    card: async () => s.card,
    read: async (fn: string, args: unknown[]) =>
      fn === "spentToday"
        ? s.spent
        : fn === "balances"
          ? args[1] === foreign
            ? s.balance
            : 0n
          : fn === "positions"
            ? [0n, 0n]
            : fn === "isTradable"
              ? args[0] === coin
              : undefined,
    token: async (_address: Address, fn: string) =>
      fn === "decimals" ? 18 : "COIN",
    quote: async (_input: Address, _output: Address, amount: bigint) => {
      quotes.push(amount);
      return { outputAmount: E("0.1") };
    },
    public: {
      getBlock: async ({ blockNumber = 1000n } = {}) => ({
        number: blockNumber,
        timestamp: 100_000n + blockNumber * 12n,
      }),
      getLogs: async () => [],
    },
  };
  const memory = new Map<string, number[]>();
  const adapter = new AutopilotChain(
    fake as any,
    s.card,
    foreign,
    s.card.holder,
    [coin, foreign],
    DEFAULT_RULES,
    "test",
    () => {},
    memory,
  );
  let latest;
  for (let i = 0; i < 65; i++)
    latest = await adapter.read(true, new AbortController().signal);
  assert.equal(latest!.coins.length, 1);
  assert.equal(latest!.coins[0].samples.length, 60);
  assert.equal(adapter.dropped.length, 1);
  assert.ok(quotes.every((q) => q === E("0.05")));
  const restarted = new AutopilotChain(
    fake as any,
    s.card,
    foreign,
    s.card.holder,
    [coin],
    DEFAULT_RULES,
    "test",
    () => {},
    memory,
  );
  assert.equal(
    (await restarted.read(true, new AbortController().signal)).coins[0].samples
      .length,
    60,
  );
});

test("position age reconstruction accounts for withdrawals, old top-ups and sell/rebuy cycles", async () => {
  const { AutopilotChain } = await import("../src/autopilot/adapter");
  const s = snapshot();
  const trade = (blockNumber: bigint, isBuy: boolean, quantity: bigint) => ({
    args: { token: coin, isBuy, tokenAmount: quantity },
    blockNumber,
    logIndex: 0,
  });
  const withdrawal = (blockNumber: bigint, quantity: bigint) => ({
    args: { token: coin, amount: quantity },
    blockNumber,
    logIndex: 0,
  });
  async function run(
    quantity: bigint,
    trades: unknown[],
    withdrawals: unknown[],
  ) {
    const fake = {
      desk: foreign,
      public: {
        getBlock: async ({ blockNumber = 5000n } = {}) => ({
          number: blockNumber,
          timestamp: 100_000n + blockNumber * 12n,
        }),
        getLogs: async (args: any) =>
          (args.event.name === "Traded" ? trades : withdrawals).filter(
            (l: any) =>
              l.blockNumber >= args.fromBlock && l.blockNumber <= args.toBlock,
          ),
      },
    };
    const adapter = new AutopilotChain(
      fake as any,
      s.card,
      foreign,
      s.card.holder,
      [coin],
      DEFAULT_RULES,
      "test",
      () => {},
    );
    await (adapter as any).loadTimes(
      [{ ...s.coins[0], quantity }],
      5000n,
      160_000_000,
      new AbortController().signal,
    );
    return adapter.times.get(coin.toLowerCase())!;
  }
  const time = (block: number) => (100_000 + block * 12) * 1000;
  const a = await run(
    E("2"),
    [trade(2000n, true, E("2")), trade(3000n, true, E("1"))],
    [withdrawal(4000n, E("1"))],
  );
  assert.equal(a.heldSince, time(2000));
  const toppedUp = await run(E("2"), [trade(4000n, true, E("1"))], []);
  assert.equal(toppedUp.heldSince, 160_000_000 - 43_200_000);
  const rebought = await run(
    E("1"),
    [
      trade(2000n, true, E("1")),
      trade(3000n, false, E("1")),
      trade(4000n, true, E("1")),
    ],
    [],
  );
  assert.equal(rebought.heldSince, time(4000));
  assert.equal(rebought.lastSold, time(3000));
});

test("RPC transport limits batches to three and tries both requested fallbacks after current RPCs", async () => {
  const { readFileSync } = await import("node:fs");
  const { DeskApi } = await import("../src/chain");
  const deployment = JSON.parse(
    readFileSync(
      new URL("../public/imd-deployment.json", import.meta.url),
      "utf8",
    ),
  );
  const original = globalThis.fetch;
  const calls: { url: string; body: any }[] = [];
  let success = "https://rpc.flashbots.net";
  globalThis.fetch = (async (
    url: string | Request | URL,
    init: RequestInit,
  ) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url: String(url).replace(/\/$/, ""), body });
    if (String(url).replace(/\/$/, "") !== success)
      return new Response("unavailable", { status: 503 });
    const response = (request: any) => ({
      jsonrpc: "2.0",
      id: request.id,
      result: "0x1",
    });
    return new Response(
      JSON.stringify(Array.isArray(body) ? body.map(response) : response(body)),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    await new DeskApi({ deployment, abis: {} }).public.getChainId();
    assert.deepEqual(
      calls.map((c) => c.url),
      [...deployment.network.rpcUrls, "https://rpc.flashbots.net"],
    );
    calls.length = 0;
    success = "https://rpc.mevblocker.io";
    await new DeskApi({ deployment, abis: {} }).public.getChainId();
    assert.deepEqual(
      calls.map((c) => c.url),
      [
        ...deployment.network.rpcUrls,
        "https://rpc.flashbots.net",
        "https://rpc.mevblocker.io",
      ],
    );
    calls.length = 0;
    success = deployment.network.rpcUrls[0];
    const api = new DeskApi({ deployment, abis: {} });
    await Promise.all(
      Array.from({ length: 8 }, () =>
        api.public.getBalance({ address: newAgent().address }),
      ),
    );
    assert.ok(calls.every((c) => !Array.isArray(c.body) || c.body.length <= 3));
    assert.ok(calls.some((c) => Array.isArray(c.body) && c.body.length === 3));
  } finally {
    globalThis.fetch = original;
  }
});
