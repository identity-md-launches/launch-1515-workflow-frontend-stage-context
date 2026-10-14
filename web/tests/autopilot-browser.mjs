import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { privateKeyToAccount } from "viem/accounts";
import { formatUnits } from "viem";
import { root, server, fixture, attach, ADDR, E } from "./fixtures.mjs";
const out = resolve(root, "test/scratch/autopilot");
mkdirSync(out, { recursive: true });
const report = {
  at: new Date().toISOString(),
  mode: "Mocked Ethereum RPC, holder wallet and AI. Agent signs real test transactions locally; no live broadcast.",
  checks: [],
  screenshots: [],
  errors: [],
  batchMax: 0,
};
const engine = process.env.HIC_BROWSER === "webkit" ? webkit : chromium;
const browser = await engine.launch({
  headless: true,
  ...(process.env.HIC_BROWSER === "webkit" && process.env.HIC_WEBKIT_EXECUTABLE
    ? { executablePath: process.env.HIC_WEBKIT_EXECUTABLE }
    : {}),
});
report.browser = process.env.HIC_BROWSER === "webkit" ? "webkit" : "chromium";
const preview = await server();
let active;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const check = async (name, fn) => {
  await fn();
  report.checks.push(name);
  console.log("PASS", name);
};
async function connect(page) {
  await page
    .getByRole("button", { name: "Connect wallet ↗", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Connect MetaMask", exact: true })
    .click();
  await page.getByRole("button", { name: /^Wallet 0x/ }).waitFor();
  await page.getByText(/Contract reads verified/).waitFor();
}
async function settled(page) {
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll("button")].some((b) =>
        /Setting agent…|Setting limits…|Funding gas…|Unlocking key…|Saving key…/.test(
          b.textContent,
        ),
      ),
  );
}
try {
  const s = fixture();
  s.balances.set(`1:${ADDR.hic}`, 0n);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    acceptDownloads: true,
  });
  const page = (active = await context.newPage());
  page.setDefaultTimeout(20_000);
  const requests = [],
    providerRequests = [];
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error")
      report.errors.push(`${message.text()} ${message.location().url}`);
  });
  page.on("response", (r) => {
    if (r.url().startsWith(preview.url) && r.status() >= 400)
      report.errors.push(`${r.status()} ${r.url()}`);
  });
  page.on("requestfailed", (req) => {
    console.log("REQUEST_FAILED", req.url(), req.failure()?.errorText);
  });
  page.on("request", (req) => {
    const captured = {
      url: req.url(),
      headers: req.headers(),
      body: req.postData() ?? "",
    };
    requests.push(captured);
    try {
      const body = req.postDataJSON();
      if (Array.isArray(body)) {
        report.batchMax = Math.max(report.batchMax, body.length);
        assert.ok(body.length <= 3);
      }
    } catch {
      /* Static assets have no body. */
    }
  });
  await attach(page, s);
  let reply = {
    action: "buy",
    coin: ADDR.hic,
    imd: "0.5",
    reason: "Test decision within limits.",
  };
  await page.route("https://api.anthropic.com/v1/messages", async (route) => {
    providerRequests.push({
      headers: route.request().headers(),
      body: route.request().postDataJSON(),
    });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        content: [
          {
            type: "text",
            text: typeof reply === "string" ? reply : JSON.stringify(reply),
          },
        ],
      }),
    });
  });
  await page.goto(preview.url + "#/autopilot");
  await page.getByRole("heading", { name: "Autopilot", exact: true }).waitFor();
  await check(
    "Disconnected Autopilot exposes the product and connect action at 390",
    async () => {
      const box = await page
        .getByRole("button", { name: "Connect holder wallet" })
        .boundingBox();
      assert.ok(box.y + box.height < 844);
      await page.screenshot({
        path: resolve(out, `${report.browser}-disconnected-390.png`),
        fullPage: true,
      });
    },
  );
  await connect(page);
  await page
    .getByRole("button", { name: "Create agent key", exact: true })
    .waitFor();
  await page.screenshot({
    path: resolve(out, `${report.browser}-setup-first-screen-390.png`),
  });
  await check(
    "Create an encrypted agent key and offer one local export",
    async () => {
      await page
        .getByLabel("Create a passphrase", { exact: true })
        .fill("autopilot browser test passphrase");
      await page.getByLabel("Create a passphrase", { exact: true }).focus();
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(() => document.activeElement.textContent),
        "Create agent key",
      );
      assert.equal(
        await page.evaluate(
          () => getComputedStyle(document.activeElement).outlineStyle,
        ),
        "solid",
      );
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Agent key ready" }).waitFor();
    },
  );
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export key", exact: true }).click();
  const download = await downloadPromise;
  const privateKey = readFileSync(await download.path(), "utf8").trim();
  const agent = privateKeyToAccount(privateKey).address;
  assert.equal(
    await page.getByRole("button", { name: "Export key", exact: true }).count(),
    0,
  );
  await check(
    "Holder sets agent and default 2 / 0.5 IMD limits; setAgent is skipped once assigned",
    async () => {
      await page
        .getByRole("button", { name: "Set as agent", exact: true })
        .click();
      await page.getByRole("button", { name: "Agent is set" }).waitFor();
      assert.equal(s.cards[0].agent.toLowerCase(), agent.toLowerCase());
      assert.ok(
        await page.getByRole("button", { name: "Agent is set" }).isDisabled(),
      );
      await page
        .getByRole("button", { name: "Set limits", exact: true })
        .click();
      await page.getByRole("button", { name: "Limits are set" }).waitFor();
      assert.equal(s.cards[0].dailyCap, 2n * E);
      assert.equal(s.cards[0].maxPerTrade, E / 2n);
    },
  );
  await check(
    "Holder funds exactly 0.003 ETH to generated agent; current balance shown",
    async () => {
      await page.getByRole("button", { name: "Fund gas", exact: true }).click();
      await settled(page);
      assert.equal(s.ethBalances.get(agent.toLowerCase()), 3n * 10n ** 15n);
      const transfer = s.writes.find(
        (w) => w.functionName === "nativeTransfer",
      );
      assert.equal(transfer.to, agent.toLowerCase());
      assert.equal(BigInt(transfer.value), 3n * 10n ** 15n);
      await page.getByText("0.003 ETH", { exact: true }).waitFor();
    },
  );
  await check(
    "Rules start / stop and drop five untradable defaults",
    async () => {
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await page.getByText(/No rule triggered/).waitFor();
      await page.getByText("5 coins skipped", { exact: true }).waitFor();
      assert.equal(s.agentWrites.length, 0);
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await page
        .getByText("Stopped. No new trades will be sent.", { exact: true })
        .waitFor();
    },
  );
  const apiKey = "test-anthropic-api-secret";
  await check(
    "Save provider key encrypted and use only its own provider call",
    async () => {
      await page.getByLabel("Your AI", { exact: true }).check();
      await page.getByLabel("API key", { exact: true }).fill(apiKey);
      await page
        .getByLabel("Encryption passphrase", { exact: true })
        .fill("autopilot browser test passphrase");
      await page
        .getByRole("button", { name: "Save encrypted API key" })
        .click();
      await settled(page);
      await page.getByText(/API key saved and unlocked/).waitFor();
      const storage = await page.evaluate(() => JSON.stringify(localStorage));
      assert.ok(!storage.includes(privateKey));
      assert.ok(!storage.includes(apiKey));
      assert.ok(!storage.includes("autopilot browser test passphrase"));
    },
  );
  await check(
    "AI loop signs a fee-aware, slippage-protected buy locally with the agent",
    async () => {
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await page
        .getByText("buy confirmed", { exact: true })
        .waitFor({ timeout: 30_000 });
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      assert.equal(s.agentWrites.length, 1);
      const trade = s.agentWrites[0];
      assert.equal(trade.from.toLowerCase(), agent.toLowerCase());
      assert.equal(trade.to.toLowerCase(), ADDR.desk);
      assert.equal(trade.chainId, 1);
      assert.equal(trade.args[2], E / 2n);
      assert.equal(
        trade.args[3],
        ((E / 2n - E / 2n / 400n) * 2n * 9700n) / 10000n,
      );
      const req = providerRequests[0];
      assert.equal(req.headers["x-api-key"], apiKey);
      assert.equal(
        req.headers["anthropic-dangerous-direct-browser-access"],
        "true",
      );
      assert.equal(req.body.model, "claude-haiku-5-5");
      assert.ok(
        s.rpcPayloads.some((r) => r.method === "eth_sendRawTransaction"),
      );
    },
  );
  await check(
    "An AI hold with an empty reason appends an explained Activity row",
    async () => {
      reply = { action: "hold", reason: "" };
      const before = await page.locator(".activity-list > li").count();
      const requestsBefore = providerRequests.length;
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await page
        .getByText("Running. Next check every 60 seconds.", { exact: true })
        .waitFor();
      await page
        .getByText("AI chose hold without a reason.", { exact: true })
        .waitFor();
      assert.equal(
        await page.locator(".activity-list > li").count(),
        before + 1,
      );
      assert.equal(providerRequests.length, requestsBefore + 1);
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      assert.equal(s.agentWrites.length, 1);
    },
  );
  await check(
    "Malformed AI reply holds and oversize / foreign decisions are skipped",
    async () => {
      for (const [response, message] of [
        ["not JSON", "AI reply was not valid decision JSON"],
        [
          { action: "buy", coin: ADDR.hic, imd: "1000", reason: "oversize" },
          "Buy exceeds",
        ],
        [
          { action: "buy", coin: ADDR.other, imd: "0.1", reason: "foreign" },
          "Coin is outside",
        ],
      ]) {
        reply = response;
        await page.getByRole("button", { name: "Start", exact: true }).click();
        await page.getByText(message, { exact: false }).first().waitFor();
        await page.getByRole("button", { name: "Stop", exact: true }).click();
      }
      assert.equal(s.agentWrites.length, 1);
    },
  );
  await check(
    "AI sell converts IMD value to the full position and protects net proceeds",
    async () => {
      const quantity = s.balances.get(`1:${ADDR.hic}`);
      const net = quantity * 2n - (quantity * 2n) / 400n;
      reply = {
        action: "sell",
        coin: ADDR.hic,
        imd: formatUnits(net, 18),
        reason: "Close the position.",
      };
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await page.getByText("sell confirmed", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      const sell = s.agentWrites.at(-1);
      assert.equal(sell.functionName, "sell");
      assert.equal(sell.args[2], quantity);
      assert.equal(sell.args[3], (net * 9700n) / 10000n);
      assert.equal(s.balances.get(`1:${ADDR.hic}`), 0n);
    },
  );
  await check(
    "AI settings have accessible labels and no automated accessibility violations",
    async () => {
      assert.deepEqual(
        (await new AxeBuilder({ page }).analyze()).violations.map((v) => v.id),
        [],
      );
      await page.locator(".autopilot-config").screenshot({
        path: resolve(out, `${report.browser}-ai-settings-390.png`),
      });
    },
  );
  await check(
    "Lock / unlock round trip preserves API key and export-used state",
    async () => {
      await page.getByRole("button", { name: "Lock key", exact: true }).click();
      await page
        .getByLabel("Unlock passphrase", { exact: true })
        .fill("wrong password");
      await page.getByRole("button", { name: "Unlock agent key" }).click();
      await page.getByText(/Unable to unlock/).waitFor();
      await page
        .getByLabel("Unlock passphrase", { exact: true })
        .fill("autopilot browser test passphrase");
      await page.getByRole("button", { name: "Unlock agent key" }).click();
      await page.getByRole("button", { name: "Agent key ready" }).waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Export key", exact: true })
          .count(),
        0,
      );
      await page.getByLabel("Rules", { exact: true }).check();
    },
  );
  await check(
    "Responsive production layouts and accessibility at 390, 500, 1440",
    async () => {
      for (const width of [390, 500, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(() => scrollTo(0, 0));
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `overflow at ${width}`,
        );
        const violations = (await new AxeBuilder({ page }).analyze())
          .violations;
        assert.deepEqual(
          violations.map(
            (v) => `${v.id}: ${v.nodes.map((n) => n.target).join()}`,
          ),
          [],
        );
        await page.screenshot({
          path: resolve(out, `${report.browser}-viewport-${width}.png`),
        });
        const file = `${report.browser}-autopilot-${width}.png`;
        await page.screenshot({ path: resolve(out, file), fullPage: true });
        report.screenshots.push(file);
      }
    },
  );
  await check(
    "A second tab cannot start the same card concurrently",
    async () => {
      await page.getByRole("button", { name: "Start", exact: true }).click();
      await page.getByText(/Running. Next check every/).waitFor();
      const second = await context.newPage();
      await attach(second, s);
      await second.goto(preview.url + "#/autopilot");
      await connect(second);
      await second
        .getByLabel("Unlock passphrase", { exact: true })
        .fill("autopilot browser test passphrase");
      await second.getByRole("button", { name: "Unlock agent key" }).click();
      await second.getByRole("button", { name: "Agent key ready" }).waitFor();
      await second.getByRole("button", { name: "Start", exact: true }).click();
      await second.getByText(/already running in another tab/).waitFor();
      await second.close();
      await page.getByRole("button", { name: "Stop", exact: true }).click();
    },
  );
  await check(
    "Share uses actual closed-trade stats and existing card record route",
    async () => {
      const url = new URL(
        await page
          .getByRole("link", { name: "Share", exact: true })
          .getAttribute("href"),
      );
      assert.match(
        url.searchParams.get("text"),
        /Card #0001 · 65% win rate over 26 trades/,
      );
      assert.ok(url.searchParams.get("url").endsWith("#/agent/1"));
    },
  );
  await check(
    "Freeze is holder-signed, confirmed, and disables Start",
    async () => {
      await page
        .getByRole("button", { name: "Freeze card", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Confirm freeze", exact: true })
        .click();
      await page.getByRole("button", { name: "Card is frozen" }).waitFor();
      assert.equal(s.cards[0].frozen, true);
      assert.ok(
        await page
          .getByRole("button", { name: "Start", exact: true })
          .isDisabled(),
      );
    },
  );
  await check(
    "No key or passphrase leaves the page; API key appears only in its provider header",
    async () => {
      for (const req of requests) {
        const encoded = JSON.stringify(req);
        assert.ok(!encoded.includes(privateKey), "private key leaked");
        assert.ok(
          !encoded.includes("autopilot browser test passphrase"),
          "passphrase leaked",
        );
        if (encoded.includes(apiKey)) {
          assert.equal(req.url, "https://api.anthropic.com/v1/messages");
          assert.ok(!req.body.includes(apiKey));
        }
      }
      assert.ok(report.batchMax > 0 && report.batchMax <= 3);
      assert.deepEqual(report.errors, []);
    },
  );
  await check(
    "Navigation / reload locks the key and retains local activity",
    async () => {
      const count = await page.locator(".activity-list > li").count();
      await page.reload();
      await connect(page);
      await page.getByRole("button", { name: "Unlock agent key" }).waitFor();
      assert.equal(await page.locator(".activity-list > li").count(), count);
      assert.ok(
        await page
          .getByRole("button", { name: "Start", exact: true })
          .isDisabled(),
      );
    },
  );
  await context.close();
} catch (e) {
  report.failure = e.stack;
  console.error(e.stack);
  if (active) {
    await active
      .screenshot({
        path: resolve(out, `${report.browser}-failure.png`),
        fullPage: true,
      })
      .catch(() => {});
    console.error((await active.locator("body").innerText()).slice(-8000));
  }
  process.exitCode = 1;
} finally {
  await browser.close();
  await preview.close();
  writeFileSync(
    resolve(out, `${report.browser}-results.json`),
    JSON.stringify(report, null, 2) + "\n",
  );
}
