import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { web } from "./shared.mjs";
const paths = execFileSync(
  "npm",
  ["ls", "--parseable", "--omit=dev", "--all"],
  { cwd: web, encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter((p) => p.includes("/node_modules/"))
  .map((p) =>
    resolve(
      web,
      "node_modules",
      p.split("/node_modules/").slice(1).join("/node_modules/"),
    ),
  );
const notices = [
  "Third-party software and font notices\n\nThis static export includes these production packages. Fonts retain their SIL Open Font License. Development tools are not bundled.\n",
];
for (const path of [...new Set(paths)].sort()) {
  const pkg = JSON.parse(readFileSync(resolve(path, "package.json"), "utf8"));
  const files = readdirSync(path).filter(
    (name) =>
      /^licen[sc]e(?:\.|$)/i.test(name) &&
      statSync(resolve(path, name)).isFile(),
  );
  notices.push(
    `\n${"=".repeat(60)}\n${pkg.name} ${pkg.version} · ${pkg.license ?? "See license"}\n${files.map((name) => readFileSync(resolve(path, name), "utf8")).join("\n") || "Package license metadata: " + pkg.license}\n`,
  );
}
writeFileSync(resolve(web, "public/notices.txt"), notices.join("\n"));
console.log(
  `Included production license notices for ${paths.length} packages.`,
);
