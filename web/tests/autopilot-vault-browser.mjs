import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { root, server, fixture, attach, ADDR } from "./fixtures.mjs";

const browserName =
  process.env.HIC_BROWSER === "webkit" ? "webkit" : "chromium";
const browser = await (browserName === "webkit" ? webkit : chromium).launch({
  headless: true,
  ...(browserName === "webkit" && process.env.HIC_WEBKIT_EXECUTABLE
    ? { executablePath: process.env.HIC_WEBKIT_EXECUTABLE }
    : {}),
});
const preview = await server();
const out = resolve(root, "test/scratch/autopilot-vault");
mkdirSync(out, { recursive: true });
const report = {
  browser: browserName,
  at: new Date().toISOString(),
  checks: [],
  errors: [],
};
const phrase = "review tab alpha passphrase";
const otherPhrase = "review tab bravo passphrase";
const key = `hic:autopilot:v1:1:${ADDR.desk}:${ADDR.holder}:1`;
const button = (page, name) => page.getByRole("button", { name, exact: true });
const vault = (page) =>
  page.evaluate((key) => localStorage.getItem(key + ":vault"), key);
const check = async (name, fn) => {
  await fn();
  report.checks.push(name);
  console.log("PASS", name);
};
async function connect(page) {
  await button(page, "Connect wallet ↗").click();
  await button(page, "Connect MetaMask").click();
  await page.getByRole("button", { name: /^Wallet 0x/ }).waitFor();
  await page.getByText(/Contract reads verified/).waitFor();
}
async function pair(suppress = false) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    acceptDownloads: true,
  });
  // Deliberately delayed storage events prove correctness does not depend on notification timing.
  await context.addInitScript((suppress) => {
    window.delayVaultEvents = suppress;
    window.addEventListener(
      "storage",
      (event) => {
        if (window.delayVaultEvents) event.stopImmediatePropagation();
      },
      true,
    );
  }, suppress);
  const s = fixture(),
    downloads = [],
    requests = [];
  const pages = [];
  for (let i = 0; i < 2; i++) {
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on("download", (download) => downloads.push(download));
    page.on("pageerror", (e) => report.errors.push(e.message));
    page.on("request", (req) =>
      requests.push(
        JSON.stringify({
          url: req.url(),
          headers: req.headers(),
          body: req.postData(),
        }),
      ),
    );
    await attach(page, s);
    await page.goto(preview.url + "#/autopilot");
    await connect(page);
    await button(page, "Create agent key").waitFor();
    pages.push(page);
  }
  return { context, s, downloads, requests, a: pages[0], b: pages[1] };
}
async function create(page, value = phrase) {
  await page.getByLabel("Create a passphrase", { exact: true }).fill(value);
  await button(page, "Create agent key").click();
  await button(page, "Agent key ready").waitFor();
}
async function unlock(page, value = phrase) {
  await page.getByLabel("Unlock passphrase", { exact: true }).fill(value);
  await button(page, "Unlock agent key").click();
  await button(page, "Agent key ready").waitFor();
}
async function apiForm(page, value) {
  await page.getByLabel("Your AI", { exact: true }).check();
  await page.getByLabel("API key", { exact: true }).fill(value);
  await page.getByLabel("Encryption passphrase", { exact: true }).fill(phrase);
}
async function saveAPI(page) {
  await button(page, "Save encrypted API key").click();
  await page.getByText(/API key saved and unlocked/).waitFor();
  await button(page, "Save encrypted API key").waitFor();
}
async function gate(page) {
  await page.evaluate((key) => {
    window.vaultGateHeld = false;
    void navigator.locks.request(key + ":vault", async () => {
      window.vaultGateHeld = true;
      await new Promise((resolve) => {
        window.releaseVaultGate = resolve;
      });
    });
  }, key);
  await page.waitForFunction(() => window.vaultGateHeld);
}
async function queued(page, count) {
  await page.waitForFunction(
    async ({ key, count }) =>
      (await navigator.locks.query()).pending.filter(
        (lock) => lock.name === key + ":vault",
      ).length === count,
    { key, count },
  );
}
try {
  await check(
    "A pre-opened tab unlocks the original funded agent; creation/export changes synchronize",
    async () => {
      const { context, s, a, b, downloads, requests } = await pair();
      try {
        await create(a);
        const original = await vault(a);
        await button(b, "Unlock agent key").waitFor();
        assert.equal(await button(b, "Create agent key").count(), 0);
        await button(a, "Set as agent").click();
        await button(a, "Agent is set").waitFor();
        await button(a, "Fund gas").click();
        await a.getByText("0.003 ETH", { exact: true }).waitFor();
        const address = JSON.parse(original).address;
        assert.equal(s.cards[0].agent.toLowerCase(), address.toLowerCase());
        assert.equal(s.ethBalances.get(address.toLowerCase()), 3n * 10n ** 15n);
        await b
          .getByLabel("Unlock passphrase", { exact: true })
          .fill(otherPhrase);
        await button(b, "Unlock agent key").click();
        await b.getByText(/Unable to unlock/).waitFor();
        assert.equal(await vault(b), original);
        await a.reload();
        await connect(a);
        await unlock(a);
        await unlock(b);
        const download = a.waitForEvent("download");
        await button(a, "Export key").click();
        const privateKey = readFileSync(
          await (await download).path(),
          "utf8",
        ).trim();
        await button(b, "Export key").waitFor({ state: "detached" });
        assert.equal(downloads.length, 1);
        assert.equal(JSON.parse(await vault(b)).address, address);
        for (const request of requests) {
          assert.ok(!request.includes(privateKey));
          assert.ok(!request.includes(phrase));
          assert.ok(!request.includes(otherPhrase));
        }
      } finally {
        await context.close();
      }
    },
  );

  await check(
    "Concurrent creates and exports are serialized even with storage events delayed",
    async () => {
      const { context, a, b, downloads } = await pair(true);
      try {
        await gate(a);
        await a.getByLabel("Create a passphrase", { exact: true }).fill(phrase);
        await b
          .getByLabel("Create a passphrase", { exact: true })
          .fill(otherPhrase);
        await button(a, "Create agent key").click();
        await queued(a, 1);
        await button(b, "Create agent key").click();
        await queued(a, 2);
        await a.evaluate(() => window.releaseVaultGate());
        await button(a, "Agent key ready").waitFor();
        await button(b, "Unlock agent key").waitFor();
        await b.getByText(/Saved keys changed in another tab/).waitFor();
        const original = await vault(a);
        await unlock(b);
        assert.equal(await vault(b), original);
        await gate(a);
        await button(a, "Export key").click();
        await queued(a, 1);
        await button(b, "Export key").click();
        await queued(a, 2);
        const download = a.waitForEvent("download");
        await a.evaluate(() => window.releaseVaultGate());
        await download;
        await b.getByText(/Saved keys changed in another tab/).waitFor();
        await button(b, "Export key").waitFor({ state: "detached" });
        assert.equal(downloads.length, 1);
        const exported = JSON.parse(await vault(b));
        assert.equal(exported.exported, true);
        assert.deepEqual(exported.encrypted, JSON.parse(original).encrypted);
      } finally {
        await context.close();
      }
    },
  );

  await check(
    "Stale exports cannot erase a newer API key; stale API saves cannot reset export state",
    async () => {
      const { context, a, b, downloads, requests } = await pair(true);
      try {
        await create(a);
        await b.reload();
        await connect(b);
        await unlock(b);
        await a.evaluate(() => {
          window.delayVaultEvents = false;
        });
        await apiForm(a, "test-first-provider-secret");
        await saveAPI(a);
        const withAPI = await vault(a);
        // B still has the old encrypted payload and an unused export offer.
        await button(b, "Export key").click();
        await b.getByText(/Saved keys changed in another tab/).waitFor();
        assert.equal(downloads.length, 0);
        assert.equal(await vault(b), withAPI);
        await unlock(b);
        await apiForm(b, "test-second-provider-secret");
        const download = a.waitForEvent("download");
        await button(a, "Export key").click();
        await download;
        const exported = await vault(a);
        await button(b, "Save encrypted API key").click();
        await b
          .locator("#autopilot-ai-error")
          .getByText(/Saved keys changed in another tab/)
          .waitFor();
        assert.equal(await vault(b), exported);
        assert.equal(JSON.parse(exported).exported, true);
        // Retrying with the refreshed record preserves the once-only export flag.
        await saveAPI(b);
        await button(a, "Unlock agent key").waitFor();
        const latest = JSON.parse(await vault(b));
        assert.equal(latest.exported, true);
        assert.notEqual(
          latest.encrypted.ciphertext,
          JSON.parse(withAPI).encrypted.ciphertext,
        );
        assert.equal(latest.address, JSON.parse(withAPI).address);
        await unlock(a);
        await a.reload();
        await connect(a);
        await unlock(a);
        assert.equal(await button(a, "Export key").count(), 0);
        for (const request of requests) {
          assert.ok(!request.includes("test-first-provider-secret"));
          assert.ok(!request.includes("test-second-provider-secret"));
          assert.ok(!request.includes(phrase));
        }
      } finally {
        await context.close();
      }
    },
  );

  await check(
    "Without Web Locks, creating a key fails visibly without writing a vault",
    async () => {
      const { context, a } = await pair();
      try {
        await a.evaluate(() =>
          Object.defineProperty(navigator, "locks", {
            value: undefined,
            configurable: true,
          }),
        );
        await a.getByLabel("Create a passphrase", { exact: true }).fill(phrase);
        await button(a, "Create agent key").click();
        await a.getByText(/does not support tab locking/).waitFor();
        assert.equal(await vault(a), null);
      } finally {
        await context.close();
      }
    },
  );
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await preview.close();
  writeFileSync(
    resolve(out, `${browserName}-results.json`),
    JSON.stringify(report, null, 2) + "\n",
  );
}
