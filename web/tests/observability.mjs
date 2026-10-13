import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  encodeEventTopics,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";
import AxeBuilder from "@axe-core/playwright";
import { fixture, attach, server, root, abis, ADDR, E } from "./fixtures.mjs";
const output = resolve(root, "test/scratch/browser");
mkdirSync(output, { recursive: true });
const report = { at: new Date().toISOString(), checks: [], errors: [] };
const preview = await server();
const browser = await chromium.launch({ headless: true });
async function run(name, fn) {
  try {
    await fn();
    report.checks.push({ name, passed: true });
    console.log("PASS", name);
  } catch (e) {
    report.checks.push({ name, passed: false, error: e.message });
    console.error("FAIL", name, e.stack);
    process.exitCode = 1;
  }
}
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  const s = fixture();
  s.logs = [true, false].map((buy, i) => ({
    address: ADDR.desk,
    blockNumber: "0x" + (s.block - BigInt(2 - i)).toString(16),
    blockHash: "0x" + "ab".repeat(32),
    transactionHash: "0x" + String(i + 90).padStart(64, "0"),
    transactionIndex: "0x0",
    logIndex: "0x" + i.toString(16),
    removed: false,
    topics: encodeEventTopics({
      abi: abis.HandlerDesk,
      eventName: "Traded",
      args: { id: 1n, token: ADDR.hic },
    }),
    data: encodeAbiParameters(
      parseAbiParameters("bool,uint256,uint256,int256,bool"),
      [buy, 2n * E, 3n * E, buy ? 0n : E / 2n, !buy],
    ),
  }));
  await attach(page, s);
  await page.goto(preview.url + "#/agent/1");
  await page
    .getByRole("heading", { name: "Trade history", exact: true })
    .waitFor();
  await run(
    "Public history decodes buys, closed sells, token units, timestamps and explorer links",
    async () => {
      await page.getByText("Open position", { exact: true }).waitFor();
      await page.getByText("Win · +0.5 IMD", { exact: true }).waitFor();
      assert.equal(await page.locator(".history-row time").count(), 2);
      assert.equal(await page.locator(".history-row a").count(), 2);
      assert.match(
        await page
          .getByRole("link", { name: "Share on X ↗" })
          .getAttribute("href"),
        /25%20closed%20trades/,
      );
    },
  );
  await run(
    "On-chain metadata is loaded as a nonexecuting SVG image",
    async () => {
      await page
        .getByText("View the original on-chain artwork", { exact: true })
        .click();
      await page
        .getByRole("button", { name: "Load card artwork", exact: true })
        .click();
      const img = page.getByRole("img", {
        name: "Original on-chain Handler Card for Atlas",
      });
      await img.waitFor();
      assert(await img.evaluate((i) => i.complete && i.naturalWidth === 200));
    },
  );
  await run("Public agent page accessibility", async () => {
    const axe = await new AxeBuilder({ page }).analyze();
    assert.deepEqual(
      axe.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
      [],
    );
    report.agentAxe = { violations: 0, passes: axe.passes.length };
  });
  await page.goto(preview.url);
  await page.getByText("Contract reads verified", { exact: false }).waitFor();
  await run(
    "Live leaderboard sorts by exact win rate or P&L and links to the correct agent",
    async () => {
      await page.locator(".rank-row").first().waitFor();
      assert.match(
        await page.locator(".rank-row").first().getAttribute("href"),
        /agent\/2/,
      );
      s.cards[0].pnl = 99n * E;
      await page
        .getByRole("button", { name: "Refresh live state", exact: true })
        .click();
      await page.getByLabel("Rank by", { exact: true }).selectOption("pnl");
      await page.waitForFunction(
        () =>
          document.querySelector(".rank-row")?.getAttribute("href") ===
          "#/agent/1",
      );
    },
  );
  await page
    .getByRole("button", { name: "Connect wallet ↗", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  await page.getByRole("button", { name: /^Wallet 0x/ }).waitFor();
  s.cards[0].name = "Very-Long-Agent-Name-1234";
  s.balances.set(`1:${ADDR.imd}`, 10n ** 50n);
  s.cards[0].volume = 10n ** 50n;
  s.cards[0].pnl = 10n ** 50n;
  await page.getByRole("link", { name: "My cards", exact: true }).click();
  await page.getByRole("heading", { name: "Your card’s balances" }).waitFor();
  await run(
    "Long names, large balances and full addresses reflow at 320 and 390",
    async () => {
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await page.getByText("Token details", { exact: true }).first().click();
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `overflow ${width}`,
        );
        await page.getByText("Token details", { exact: true }).first().click();
        await page.screenshot({
          path: resolve(output, `long-values-${width}.png`),
        });
      }
    },
  );
  await run(
    "200% text enlargement remains readable without page overflow",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addStyleTag({ content: ":root{font-size:32px!important}" });
      report.textEnlargementOverflow = await page.evaluate(() =>
        [...document.querySelectorAll("body *")]
          .map((el) => ({
            tag: el.tagName,
            class: el.className,
            right: el.getBoundingClientRect().right,
            left: el.getBoundingClientRect().left,
            width: el.getBoundingClientRect().width,
            text: el.textContent?.slice(0, 60),
          }))
          .filter((el) => el.right > innerWidth + 1 || el.left < 0),
      );
      await page.screenshot({
        path: resolve(output, "text-enlargement-390.png"),
      });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.screenshot({
        path: resolve(output, "text-enlargement-390.png"),
      });
    },
  );
  await context.close();
  await run(
    "Reduced motion disables the one-time card-print animation",
    async () => {
      const reduced = await browser.newContext({
        viewport: { width: 390, height: 844 },
        reducedMotion: "reduce",
      });
      const p = await reduced.newPage();
      await attach(p, fixture());
      await p.goto(preview.url);
      await p
        .getByRole("button", { name: "Connect wallet ↗", exact: true })
        .click();
      await p
        .getByRole("button", { name: "Connect MetaMask", exact: true })
        .click();
      await p.getByRole("link", { name: "My cards", exact: true }).click();
      await p.goto(preview.url + "#/cards?new=1");
      await p.locator(".printed").waitFor();
      assert.equal(
        await p
          .locator(".printed .badge")
          .evaluate((el) => getComputedStyle(el).animationName),
        "none",
      );
      await reduced.close();
    },
  );
  assert.deepEqual(report.errors, []);
} finally {
  await browser.close();
  await preview.close();
  writeFileSync(
    resolve(root, "docs/frontend/observability-results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
}
