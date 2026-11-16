const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const releaseDir = path.join(__dirname, "..", "release");
const version = require("../package.json").version;
const fileName = `HatsApp-Setup-${version}.exe`;
const filePath = path.join(releaseDir, fileName);

if (!fs.existsSync(filePath)) {
  console.error(`Missing ${filePath}`);
  process.exit(1);
}

const fileBuffer = fs.readFileSync(filePath);
const sha512 = crypto.createHash("sha512").update(fileBuffer).digest("base64");
const size = fileBuffer.length;
const releaseDate = new Date().toISOString();

const yaml = [
  `version: ${version}`,
  `files:`,
  `  - url: ${fileName}`,
  `    sha512: ${sha512}`,
  `    size: ${size}`,
  `path: ${fileName}`,
  `sha512: ${sha512}`,
  `releaseDate: '${releaseDate}'`,
  "",
].join("\n");

fs.writeFileSync(path.join(releaseDir, "latest.yml"), yaml, "utf8");
console.log(`Wrote latest.yml for ${version}`);
