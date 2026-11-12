const fs = require("fs");
const path = require("path");

const electronDir = path.join(__dirname, "..", "node_modules", "electron");
const distDir = path.join(electronDir, "dist");
const exeName = process.platform === "win32" ? "electron.exe" : "electron";
const exePath = path.join(distDir, exeName);
const pathFile = path.join(electronDir, "path.txt");

if (fs.existsSync(exePath) && !fs.existsSync(pathFile)) {
  fs.writeFileSync(pathFile, exeName);
}
