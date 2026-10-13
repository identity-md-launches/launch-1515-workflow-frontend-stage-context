import assert from "node:assert/strict";
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fixture, attach, server, root } from "./fixtures.mjs";
const preview = await server();
const browser = await chromium.launch({ headless: true });
const report = {
  at: new Date().toISOString(),
  mode: "Keyboard-only navigation and mocked wallet/RPC; no real transaction",
  checks: [],
};
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const s = fixture();
  await attach(page, s);
  await page.goto(preview.url);
  await page.getByText("Contract reads verified", { exact: false }).waitFor();
  async function tabTo(text) {
    for (let i = 0; i < 50; i++) {
      await page.keyboard.press("Tab");
      const current = await page.evaluate(() => {
        const el = document.activeElement;
        return el?.tagName === "INPUT"
          ? el.labels?.[0]?.textContent
          : el?.textContent;
      });
      if (current?.trim() === text) return;
    }
    throw Error("Keyboard could not reach " + text);
  }
  await page.keyboard.press("Tab");
  assert.equal(
    await page
      .locator(".skip-link")
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.keyboard.press("Enter");
  assert.equal(
    await page.locator("main").evaluate((el) => el === document.activeElement),
    true,
  );
  await tabTo("Connect wallet ↗");
  await page.keyboard.press("Enter");
  await tabTo("Connect MetaMask");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /^Wallet 0x/ }).waitFor();
  await tabTo("Agent name");
  await page.keyboard.type("Keyboard agent");
  await tabTo("Get mint quote");
  await page.keyboard.press("Enter");
  await page.getByText("Estimated receive", { exact: true }).waitFor();
  await tabTo("Approve token spending");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some(
      (b) => b.textContent === "Mint agent card" && !b.disabled,
    ),
  );
  await tabTo("Mint agent card");
  const focus = await page.evaluate(() => ({
    text: document.activeElement.textContent,
    width: getComputedStyle(document.activeElement).outlineWidth,
    style: getComputedStyle(document.activeElement).outlineStyle,
  }));
  assert.equal(focus.style, "solid");
  assert.equal(focus.width, "2px");
  mkdirSync(resolve(root, "test/scratch/browser"), { recursive: true });
  await page.screenshot({
    path: resolve(root, "test/scratch/browser/keyboard-focus-390.png"),
  });
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Your card is issued." }).waitFor();
  assert.equal(s.writes.at(-1).functionName, "mint");
  report.checks.push({
    name: "Skip link, wallet dialog, name, quote, approval and mint reached with Tab/Enter; visible focus ring",
    passed: true,
  });
  report.focus = focus;
} catch (e) {
  report.checks.push({
    name: "Keyboard mint",
    passed: false,
    error: e.message,
  });
  process.exitCode = 1;
} finally {
  await browser.close();
  await preview.close();
  writeFileSync(
    resolve(root, "docs/frontend/keyboard-results.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(report);
}
