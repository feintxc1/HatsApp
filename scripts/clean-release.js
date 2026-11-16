const fs = require("fs");
const path = require("path");

const releaseDir = path.join(__dirname, "..", "release");
const version = require("../package.json").version;
const keep = new Set([
  `HatsApp-Setup-${version}.exe`,
  `HatsApp-Setup-${version}.exe.blockmap`,
  "latest.yml",
  "HatsApp-FixUpdates.exe",
]);

if (!fs.existsSync(releaseDir)) process.exit(0);

for (const name of fs.readdirSync(releaseDir)) {
  if (keep.has(name)) continue;
  if (name === "win-unpacked" || name === "qa-blank-screen") {
    fs.rmSync(path.join(releaseDir, name), { recursive: true, force: true });
    console.log(`removed ${name}/`);
    continue;
  }
  if (
    /^HatsApp-Setup-.*\.(exe|exe\.blockmap)$/.test(name) ||
    name === "builder-debug.yml" ||
    name.endsWith(".blockmap")
  ) {
    fs.rmSync(path.join(releaseDir, name), { force: true });
    console.log(`removed ${name}`);
  }
}

console.log(`kept current ${version} artifacts`);
