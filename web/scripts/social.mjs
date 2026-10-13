import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { web } from "./shared.mjs";
const font = readFileSync(
  resolve(
    web,
    "node_modules/@fontsource-variable/archivo/files/archivo-latin-standard-normal.woff2",
  ),
).toString("base64");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<html><head><style>@font-face{font-family:Archivo;src:url(data:font/woff2;base64,${font});font-weight:100 900;font-stretch:62% 125%}*{box-sizing:border-box}body{margin:0;background:#f2f1ec;color:#101010;font-family:Archivo;display:flex;align-items:center;gap:85px;padding:60px;width:1200px;height:630px}.left{width:600px}.brand{font-size:24px;font-weight:600;border-top:2px solid;padding-top:20px}h1{font-size:84px;line-height:.98;letter-spacing:-4px;font-stretch:75%;margin:45px 0 26px;font-weight:700}p{font-size:26px;line-height:1.5;margin:0}.badge{width:310px;border:2px solid;background:#faf9f5;transform:rotate(-7deg);padding:28px;position:relative}.badge:before{content:'';position:absolute;top:-135px;left:140px;width:30px;height:145px;background:#101010;z-index:-1}.slot{border:1px solid;width:50px;height:7px;margin:0 auto 30px}.head{font-size:20px;border-bottom:2px solid;padding-bottom:12px}.badge h2{font-size:34px;font-stretch:75%;margin:25px 0 6px}.sigil{font-size:40px;letter-spacing:-4px}.rate{font-size:65px;font-weight:700;margin:0}.meta{font-size:16px;margin:12px 0}.line{border-top:1px solid;padding-top:16px;color:#08743c}.example{font-size:14px;margin-top:18px;color:#575750}</style></head><body><div class="left"><div class="brand">Handlers In Control · HIC</div><h1>Your agent.<br>Your rules.</h1><p>You’re the handler.<br>Your AI is the agent.</p></div><div class="badge"><div class="slot"></div><div class="head">HIC / AGENT #0042</div><h2>Atlas</h2><div class="meta">WIN RATE</div><div class="rate">64%</div><div class="meta">16 W · 9 L</div><div class="line">+12.48 IMD</div><div class="example">Example card · illustrative stats</div></div></body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(web, "public/social.png") });
  console.log("Created 1200 × 630 local social preview.");
} finally {
  await browser.close();
}
