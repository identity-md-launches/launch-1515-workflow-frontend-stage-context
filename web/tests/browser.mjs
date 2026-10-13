import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { decodeAbiParameters, parseAbiParameters } from "viem";
import {
  root,
  server,
  fixture,
  attach,
  ADDR,
  deployment,
  E,
} from "./fixtures.mjs";
const output = resolve(root, "test/scratch/browser");
mkdirSync(output, { recursive: true });
const report = {
  at: new Date().toISOString(),
  mode: "Mocked EIP-1193 wallet and JSON-RPC. No real signing or broadcasting.",
  checks: [],
  screenshots: [],
  errors: [],
};
const preview = await server();
const engine = process.env.HIC_BROWSER === "webkit" ? "webkit" : "chromium";
const browser = await (engine === "webkit" ? webkit : chromium).launch({
  headless: true,
  ...(engine === "webkit" && process.env.HIC_WEBKIT_EXECUTABLE
    ? { executablePath: process.env.HIC_WEBKIT_EXECUTABLE }
    : {}),
});
report.browser = engine;
report.browserVersion = browser.version();
const check = (name, fn) => async () => {
  const started = Date.now();
  try {
    await fn();
    report.checks.push({
      name,
      passed: true,
      durationMs: Date.now() - started,
    });
    console.log("PASS", name);
  } catch (e) {
    report.checks.push({
      name,
      passed: false,
      error: e.message,
      durationMs: Date.now() - started,
    });
    console.error("FAIL", name, e.stack);
    throw e;
  }
};
async function newPage(state = fixture(), wallet = true, width = 390) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("response", (r) => {
    if (r.url().startsWith(preview.url) && r.status() >= 400)
      report.errors.push(`${r.status()} ${r.url()}`);
  });
  await attach(page, state, { wallet });
  await page.goto(preview.url, { waitUntil: "networkidle" });
  await page.getByText("Contract reads verified", { exact: false }).waitFor();
  return { page, context, state };
}
async function connect(page) {
  await page
    .getByRole("button", { name: "Connect wallet ↗", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  await page.getByRole("button", { name: /^Wallet 0x/ }).waitFor();
}
async function ready(page, label) {
  const button = page.getByRole("button", { name: label, exact: true });
  await button.waitFor();
  await page.waitForFunction(
    (label) =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent === label && !b.disabled,
      ),
    label,
  );
  return button;
}
async function tx(page, label) {
  await (await ready(page, label)).click();
  await page
    .getByRole("button", { name: label + ": confirming…", exact: true })
    .waitFor({ state: "hidden" });
  await page.waitForFunction(
    () => !document.querySelector("button[aria-busy=true]"),
  );
  await page.waitForTimeout(180);
}
async function noOverflow(page, width) {
  await page.setViewportSize({ width, height: 844 });
  await page.waitForTimeout(50);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
    `Overflow at ${width}`,
  );
}
async function shot(page, name) {
  const path = resolve(output, `${engine}-${name}.png`);
  await page.screenshot({ path, fullPage: false });
  report.screenshots.push(`test/scratch/browser/${engine}-${name}.png`);
}
try {
  await check(
    "Disconnected mobile first screen, missing wallet, keyboard dialog, static subpath resources",
    async () => {
      const { page, context } = await newPage(fixture(), false);
      const main = page.getByRole("button", {
        name: "Connect wallet to mint agent card",
        exact: true,
      });
      const box = await main.boundingBox();
      assert(box && box.y + box.height < 844, "Mint action below first screen");
      for (const width of [320, 390, 768, 1440]) await noOverflow(page, width);
      await page.setViewportSize({ width: 390, height: 844 });
      await shot(page, "home-390");
      await page.setViewportSize({ width: 1440, height: 900 });
      await shot(page, "home-1440");
      await main.click();
      await page
        .getByText("No browser wallet detected.", { exact: true })
        .waitFor();
      assert.equal(
        await page.getByRole("dialog").evaluate((el) => el.open),
        true,
      );
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(
        await main.evaluate((el) => el === document.activeElement),
        true,
        "Dialog restores focus",
      );
      const axe = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(
        axe.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => n.target),
        })),
        [],
      );
      report.homeAxe = { violations: 0, passes: axe.passes.length };
      await context.close();
    },
  )();
  await check(
    "Wallet rejection recovery and unknown-chain switch → add → switch",
    async () => {
      const s = fixture();
      s.chain = "0x5";
      s.unknownChain = true;
      s.connectReject = true;
      const { page, context } = await newPage(s);
      await page
        .getByRole("button", { name: "Connect wallet ↗", exact: true })
        .click();
      await page.getByRole("button", { name: "Connect MetaMask" }).click();
      await page
        .getByText("You declined the wallet request.", { exact: false })
        .waitFor();
      s.connectReject = false;
      await page.getByRole("button", { name: "Connect MetaMask" }).click();
      await page.getByText("Wrong network", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "Switch to Ethereum", exact: true })
        .click();
      await page
        .getByText("Wrong network", { exact: true })
        .waitFor({ state: "hidden" });
      assert.deepEqual(s.addChain, deployment.walletAddChain);
      assert.equal(
        s.requests.filter((x) => x === "wallet_switchEthereumChain").length,
        2,
      );
      await context.close();
    },
  )();
  await check(
    "Mint validation, exact approval, pending lock, confirmation, and setup checklist",
    async () => {
      const s = fixture();
      const { page, context } = await newPage(s);
      await connect(page);
      await page.getByLabel("Agent name", { exact: true }).fill("<bad>");
      await (await ready(page, "Get mint quote")).click();
      await page.getByRole("alert").filter({ hasText: "Use 1–24" }).waitFor();
      assert.equal(s.writes.length, 0);
      await page.getByLabel("Agent name", { exact: true }).fill("New agent");
      await (await ready(page, "Get mint quote")).click();
      await page.getByText("Estimated receive", { exact: true }).waitFor();
      s.txDelay = 700;
      await (await ready(page, "Approve token spending")).click();
      await page
        .getByRole("button", { name: "Approve token spending: check wallet…" })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", {
            name: "Approve token spending: check wallet…",
          })
          .isDisabled(),
        true,
      );
      await ready(page, "Mint agent card");
      assert.equal(
        s.writes.filter((x) => x.functionName === "approve").length,
        1,
      );
      assert.equal(s.writes[0].args[0].toLowerCase(), ADDR.desk);
      assert.equal(s.writes[0].args[1], s.mintPrice);
      await (await ready(page, "Mint agent card")).click();
      await page
        .getByRole("heading", { name: "Your card is issued." })
        .waitFor();
      assert.equal(s.writes.at(-1).functionName, "mint");
      assert(s.writes.at(-1).args[1] > 0n);
      await page.getByRole("link", { name: "Set up my card →" }).click();
      await page
        .getByRole("button", { name: "#0003 · New agent", exact: true })
        .waitFor();
      assert.match(page.url(), /new=3$/);
      await page
        .getByRole("heading", { name: "New agent", exact: true })
        .waitFor();
      await page.getByText("Setup needed:", { exact: false }).waitFor();
      await shot(page, "minted-setup-390");
      await context.close();
    },
  )();
  await check(
    "Holder deposit, rules, agent, freeze/unfreeze, rename, withdrawal and holder-only balances",
    async () => {
      const s = fixture();
      const { page, context } = await newPage(s);
      await connect(page);
      await page.getByRole("link", { name: "My cards", exact: true }).click();
      await page
        .getByRole("heading", { name: "Your card’s balances" })
        .waitFor();
      assert.equal(
        await page.getByText("Other handler", { exact: true }).count(),
        0,
      );
      assert.equal(
        await page.getByText("987654321", { exact: true }).count(),
        0,
      );
      await page.getByLabel("Deposit amount (IMD)", { exact: true }).fill("10");
      await tx(page, "Approve token spending");
      await tx(page, "Deposit IMD");
      assert.equal(s.balances.get(`1:${ADDR.imd}`), 110n * E);
      await page
        .getByLabel("Agent wallet address", { exact: true })
        .fill(ADDR.agent);
      await tx(page, "Set agent");
      await page.getByLabel("Daily cap (IMD)", { exact: true }).fill("40");
      await page
        .getByLabel("Maximum per trade (IMD)", { exact: true })
        .fill("5");
      await tx(page, "Save rules");
      assert.equal(s.cards[0].dailyCap, 40n * E);
      await tx(page, "Freeze card");
      await page
        .getByText("Frozen: all agent trading is stopped.", { exact: true })
        .waitFor();
      await tx(page, "Unfreeze card");
      assert.equal(s.cards[0].frozen, false);
      await page.getByLabel("Card name", { exact: true }).fill("Atlas Two");
      await tx(page, "Rename card");
      await page
        .getByRole("heading", { name: "Atlas Two", exact: true })
        .waitFor();
      await page
        .getByLabel("Withdrawal amount (IMD)", { exact: true })
        .fill("1.5");
      await tx(page, "Withdraw funds");
      assert.equal(s.balances.get(`1:${ADDR.imd}`), 108500000000000000000n);
      for (const width of [320, 390, 768, 1440]) await noOverflow(page, width);
      await page.setViewportSize({ width: 390, height: 844 });
      await shot(page, "holder-390");
      const axe = await new AxeBuilder({ page }).analyze();
      assert.deepEqual(
        axe.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => n.target),
        })),
        [],
      );
      report.holderAxe = { violations: 0, passes: axe.passes.length };
      await context.close();
    },
  )();
  await check(
    "Wallet swap requires token approval and Permit2 authorization; router encodes attested pool and simulates",
    async () => {
      const s = fixture();
      const { page, context } = await newPage(s);
      await connect(page);
      await page.getByRole("link", { name: "Trade HIC", exact: true }).click();
      await page.getByLabel("You pay (IMD)", { exact: true }).fill("1");
      await (await ready(page, "Get swap quote")).click();
      await page.getByText("Estimated receive", { exact: true }).waitFor();
      await tx(page, "Approve IMD to Permit2");
      await tx(page, "Authorize router amount");
      s.revertNext = "execute";
      await tx(page, "Swap IMD for HIC");
      await page
        .getByRole("alert")
        .filter({ hasText: "output fell below" })
        .waitFor();
      assert.equal(
        s.writes.filter((x) => x.functionName === "execute").length,
        0,
      );
      s.revertNext = "";
      s.rejectNext = true;
      await tx(page, "Swap IMD for HIC");
      await page.getByRole("alert").filter({ hasText: "declined" }).waitFor();
      s.rejectNext = false;
      await tx(page, "Swap IMD for HIC");
      const execute = s.writes.find((x) => x.functionName === "execute");
      assert(execute);
      assert.equal(execute.to, ADDR.universalRouter);
      assert.equal(execute.args[0], "0x10");
      assert.equal(BigInt(execute.value ?? "0x0"), 0n);
      const [actions, params] = decodeAbiParameters(
        parseAbiParameters("bytes,bytes[]"),
        execute.args[1][0],
      );
      assert.equal(actions, "0x060c0f");
      const [swap] = decodeAbiParameters(
        parseAbiParameters(
          "((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)",
        ),
        params[0],
      );
      assert.equal(swap.poolKey.hooks.toLowerCase(), deployment.poolKey.hooks);
      assert.equal(swap.zeroForOne, false);
      assert.equal(swap.amountIn, E);
      assert.equal(swap.amountOutMinimum, 1990000000000000000n);
      assert(s.simulations.some((x) => x.fn === "execute"));
      assert.equal(s.writes[0].args[0].toLowerCase(), ADDR.permit2);
      assert.equal(s.writes[1].args[1].toLowerCase(), ADDR.universalRouter);
      await noOverflow(page, 320);
      await shot(page, "swap-320");
      await context.close();
    },
  )();
  await check(
    "Agent page, eligibility, gross buy fee, net sell fee, freeze gating and no approval",
    async () => {
      const s = fixture();
      s.account = ADDR.agent;
      const { page, context } = await newPage(s);
      await connect(page);
      await page.goto(preview.url + "#/agent/1");
      await page.getByRole("heading", { name: "Agent trading desk" }).waitFor();
      await page
        .getByText("No trades found in the loaded block range.", {
          exact: true,
        })
        .waitFor();
      await page
        .getByLabel("Buy budget (IMD, including desk fee)", { exact: true })
        .fill("2");
      await (await ready(page, "Quote card trade")).click();
      await page.getByText("Estimated receive", { exact: true }).waitFor();
      await tx(page, "Buy for this card");
      const buy = s.writes.find((x) => x.functionName === "buy");
      assert.equal(buy.args[2], 2n * E);
      assert.equal(buy.args[3], 3970050000000000000n);
      assert.equal(
        s.writes.filter((x) => x.functionName === "approve").length,
        0,
      );
      await page
        .getByLabel("Trade direction", { exact: true })
        .selectOption("sell");
      await page
        .getByLabel("Sell amount (coin units)", { exact: true })
        .fill("1");
      await (await ready(page, "Quote card trade")).click();
      await page.getByText("Estimated receive", { exact: true }).waitFor();
      await tx(page, "Sell from this card");
      const sell = s.writes.find((x) => x.functionName === "sell");
      assert.equal(sell.args[3], 1985025000000000000n);
      s.cards[0].frozen = true;
      await page
        .getByRole("button", { name: "Refresh live state", exact: true })
        .click();
      await page.getByText("This card is frozen.", { exact: false }).waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Quote card trade", exact: true })
          .isDisabled(),
        true,
      );
      await noOverflow(page, 390);
      await noOverflow(page, 320);
      await shot(page, "agent-320");
      await context.close();
    },
  )();
  await check(
    "Owner price bounds, burn and two-step ownership controls",
    async () => {
      const s = fixture();
      const { page, context } = await newPage(s);
      await connect(page);
      await page.getByRole("link", { name: "Builders", exact: true }).click();
      await page.getByLabel("New mint price (IMD)", { exact: true }).fill("3");
      await tx(page, "Set mint price");
      await page.getByRole("alert").filter({ hasText: "0.05 to 2" }).waitFor();
      assert.equal(s.writes.length, 0);
      await page
        .getByLabel("New mint price (IMD)", { exact: true })
        .fill("0.5");
      await tx(page, "Set mint price");
      assert.equal(s.mintPrice, E / 2n);
      await (await ready(page, "Quote burn")).click();
      await page.getByText("Estimated receive", { exact: true }).waitFor();
      await tx(page, "Buy and burn");
      assert.equal(s.burnImd, 0n);
      await page.getByText("Transfer desk ownership", { exact: true }).click();
      await page
        .getByLabel("New owner address", { exact: true })
        .fill(ADDR.other);
      await tx(page, "Propose new owner");
      assert.equal(s.pendingOwner.toLowerCase(), ADDR.other);
      s.account = ADDR.other;
      await page.evaluate(
        (account) => window.__emit("accountsChanged", [account]),
        ADDR.other,
      );
      await page
        .getByRole("button", { name: "Accept ownership", exact: true })
        .waitFor();
      await tx(page, "Accept ownership");
      assert.equal(s.owner, ADDR.other);
      await noOverflow(page, 320);
      await shot(page, "builders-320");
      await context.close();
    },
  )();
  await check(
    "Verification failure blocks writes and retry recovers",
    async () => {
      const s = fixture();
      const { page, context } = await newPage(s);
      await connect(page);
      s.codeMissing = true;
      await page
        .getByRole("button", { name: "Refresh live state", exact: true })
        .click();
      await page.getByText("Live reads unavailable", { exact: true }).waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Get mint quote", exact: true })
          .isDisabled(),
        true,
      );
      s.codeMissing = false;
      await page
        .getByRole("button", { name: "Retry verification", exact: true })
        .click();
      await page
        .getByText("Live reads unavailable", { exact: true })
        .waitFor({ state: "hidden" });
      assert.equal(s.writes.length, 0);
      await context.close();
    },
  )();
  await check(
    "Mint allowance is capped and changed mint prices are rejected before signing",
    async () => {
      const s = fixture();
      s.allowances.set(`${ADDR.holder}:${ADDR.imd}:${ADDR.desk}`, 100n * E);
      const { page, context } = await newPage(s);
      await connect(page);
      await page.getByLabel("Agent name", { exact: true }).fill("Price guard");
      await (await ready(page, "Get mint quote")).click();
      await page.getByText("Estimated receive", { exact: true }).waitFor();
      await tx(page, "Set exact mint allowance");
      assert.equal(s.writes[0].args[1], E / 5n);
      s.mintPrice = E / 2n;
      await tx(page, "Mint agent card");
      await page
        .getByRole("alert")
        .filter({ hasText: "mint price changed" })
        .waitFor();
      assert.equal(s.writes.filter((x) => x.functionName === "mint").length, 0);
      await context.close();
    },
  )();
  assert.deepEqual(report.errors, []);
} catch (e) {
  process.exitCode = 1;
  const pages = browser.contexts().flatMap((c) => c.pages());
  if (pages.length) {
    report.failureText = await pages
      .at(-1)
      .locator("body")
      .innerText()
      .catch(() => "Unavailable");
    await pages
      .at(-1)
      .screenshot({ path: resolve(output, "failure.png"), fullPage: true })
      .catch(() => {});
  }
} finally {
  await browser.close();
  await preview.close();
  writeFileSync(
    resolve(
      root,
      engine === "webkit"
        ? "docs/frontend/webkit-browser-results.json"
        : "docs/frontend/browser-results.json",
    ),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
}
