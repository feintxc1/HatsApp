const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const readline = require("readline");

const GITHUB_YML = [
  "provider: github",
  "owner: feintxc1",
  "repo: HatsApp",
  "updaterCacheDirName: hatsapp-updater",
  "",
].join("\n");

const BLOCKS = [
  [
    "    autoUpdater.forceDevUpdateConfig = true;\r\n",
    "    autoUpdater.setFeedURL({\r\n",
    '      provider: "generic",\r\n',
    '      url: "http://127.0.0.1:8787",\r\n',
    "    });",
  ].join(""),
  [
    "    autoUpdater.forceDevUpdateConfig = true;\n",
    "    autoUpdater.setFeedURL({\n",
    '      provider: "generic",\n',
    '      url: "http://127.0.0.1:8787",\n',
    "    });",
  ].join(""),
];

const URL_PATCHES = [
  { from: 'url: "http://127.0.0.1:8787"', to: 'url: "https://0.0.0.0:9"' },
  { from: "url: http://127.0.0.1:8787", to: "url: https://0.0.0.0:9" },
  { from: "http://127.0.0.1:8787", to: "https://0.0.0.0:9" },
];

function isInstallDir(dir) {
  if (!dir) return false;
  try {
    return (
      fs.existsSync(path.join(dir, "HatsApp.exe")) &&
      fs.existsSync(path.join(dir, "resources", "app.asar"))
    );
  } catch {
    return false;
  }
}

function normalizeCandidate(input) {
  if (!input) return null;
  let p = String(input).trim().replace(/^["']|["']$/g, "");
  if (!p) return null;
  try {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      if (/HatsApp\.exe$/i.test(p)) return path.dirname(p);
      return null;
    }
  } catch {}
  return p;
}

function regQueryInstallLocations() {
  const roots = [
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  ];
  const found = [];
  for (const root of roots) {
    const list = spawnSync("reg", ["query", root], {
      encoding: "utf8",
      windowsHide: true,
    });
    const text = `${list.stdout || ""}\n${list.stderr || ""}`;
    const keys = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /\\Uninstall\\/i.test(l));
    for (const key of keys) {
      const q = spawnSync(
        "reg",
        ["query", key, "/v", "DisplayName"],
        { encoding: "utf8", windowsHide: true }
      );
      const nameOut = `${q.stdout || ""}`;
      if (!/HatsApp/i.test(nameOut)) continue;
      for (const valueName of ["InstallLocation", "DisplayIcon"]) {
        const v = spawnSync("reg", ["query", key, "/v", valueName], {
          encoding: "utf8",
          windowsHide: true,
        });
        const m = `${v.stdout || ""}`.match(/REG_\w+\s+(.+)$/m);
        if (!m) continue;
        let loc = m[1].trim().replace(/^"|"$/g, "");
        if (valueName === "DisplayIcon") {
          loc = loc.split(",")[0].trim().replace(/^"|"$/g, "");
          if (/HatsApp\.exe$/i.test(loc)) loc = path.dirname(loc);
        }
        if (loc) found.push(loc);
      }
    }
  }
  return found;
}

function shortcutTargets() {
  const dirs = [
    path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs"),
    path.join(process.env.ProgramData || "", "Microsoft", "Windows", "Start Menu", "Programs"),
    path.join(process.env.USERPROFILE || "", "Desktop"),
    path.join(process.env.PUBLIC || "", "Desktop"),
    path.join(process.env.USERPROFILE || "", "OneDrive", "Desktop"),
  ];
  const targets = [];
  for (const dir of dirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    let entries = [];
    try {
      entries = walkFiles(dir, 4);
    } catch {
      continue;
    }
    for (const file of entries) {
      if (!/\.lnk$/i.test(file)) continue;
      if (!/hatsapp/i.test(path.basename(file))) continue;
      const ps = [
        `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${file.replace(/'/g, "''")}');`,
        `Write-Output $s.TargetPath`,
      ].join("");
      const r = spawnSync(
        "powershell",
        ["-NoProfile", "-Command", ps],
        { encoding: "utf8", windowsHide: true }
      );
      const target = String(r.stdout || "").trim();
      if (target) targets.push(target);
    }
  }
  return targets;
}

function walkFiles(root, depth) {
  const out = [];
  function walk(dir, d) {
    if (d < 0) return;
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const full = path.join(dir, name);
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full, d - 1);
      else out.push(full);
    }
  }
  walk(root, depth);
  return out;
}

function whereHatsApp() {
  const r = spawnSync("where", ["HatsApp.exe"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return String(r.stdout || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function defaultCandidates() {
  const local = process.env.LOCALAPPDATA || "";
  const pf = process.env.ProgramFiles || "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const home = process.env.USERPROFILE || "";
  return [
    path.join(local, "Programs", "HatsApp"),
    path.join(local, "hatsapp"),
    path.join(local, "Programs", "hatsapp"),
    path.join(pf, "HatsApp"),
    path.join(pf86, "HatsApp"),
    path.join(home, "AppData", "Local", "Programs", "HatsApp"),
    path.join(home, "Desktop", "HatsApp"),
    path.join(home, "OneDrive", "Desktop", "HatsApp"),
  ];
}

function findInstallDir(extra) {
  const seen = new Set();
  const queue = [];

  function add(raw) {
    const dir = normalizeCandidate(raw);
    if (!dir) return;
    const key = dir.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    queue.push(dir);
  }

  for (const item of extra || []) add(item);
  for (const item of defaultCandidates()) add(item);
  for (const item of regQueryInstallLocations()) add(item);
  for (const item of shortcutTargets()) add(item);
  for (const item of whereHatsApp()) add(item);

  for (const dir of queue) {
    if (isInstallDir(dir)) return dir;
  }
  return null;
}

function askForPath() {
  return new Promise((resolve) => {
    console.log("");
    console.log("Could not find HatsApp automatically.");
    console.log("Right-click the HatsApp shortcut → Open file location,");
    console.log("then paste that folder path here (or drag HatsApp.exe onto this window):");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question("> ", (answer) => {
      rl.close();
      resolve(String(answer || "").trim());
    });
  });
}

function killHatsApp() {
  spawnSync("taskkill", ["/IM", "HatsApp.exe", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

function fitLength(desired, length) {
  if (desired.length === length) return desired;
  if (desired.length > length) return desired.slice(0, length);
  return desired + " ".repeat(length - desired.length);
}

function sameLengthReplace(buf, from, to) {
  const needle = Buffer.from(from, "utf8");
  const repl = Buffer.from(fitLength(to, from.length), "utf8");
  let idx = 0;
  let count = 0;
  while ((idx = buf.indexOf(needle, idx)) !== -1) {
    repl.copy(buf, idx);
    idx += needle.length;
    count += 1;
  }
  return count;
}

function patchAsar(asarPath) {
  const buf = Buffer.from(fs.readFileSync(asarPath));
  let total = 0;

  for (const block of BLOCKS) {
    total += sameLengthReplace(buf, block, "    autoUpdater.forceDevUpdateConfig = 0;");
  }

  for (const patch of URL_PATCHES) {
    total += sameLengthReplace(buf, patch.from, patch.to);
  }

  if (total > 0) {
    const backup = `${asarPath}.bak`;
    if (!fs.existsSync(backup)) {
      fs.copyFileSync(asarPath, backup);
    }
    fs.writeFileSync(asarPath, buf);
  }
  return total;
}

function pause() {
  if (process.platform !== "win32") return;
  if (!process.pkg) return;
  try {
    spawnSync("cmd", ["/c", "pause"], { stdio: "inherit", windowsHide: false });
  } catch {}
}

async function main() {
  const extras = process.argv.slice(2);
  let installDir = findInstallDir(extras);

  if (!installDir && process.pkg) {
    const typed = await askForPath();
    if (typed) installDir = findInstallDir([typed]);
  }

  if (!installDir) {
    console.error("HatsApp install not found.");
    console.error("Looked in common folders, Start Menu shortcuts, and uninstall registry.");
    console.error("Tip: drag HatsApp.exe onto HatsApp-FixUpdates.exe, or pass the install folder path.");
    pause();
    process.exit(1);
  }

  const resources = path.join(installDir, "resources");
  const asarPath = path.join(resources, "app.asar");
  const ymlPath = path.join(resources, "app-update.yml");

  console.log(`Found HatsApp at: ${installDir}`);
  killHatsApp();

  fs.writeFileSync(ymlPath, GITHUB_YML, "utf8");
  console.log("Updated app-update.yml → GitHub Releases");

  const hits = patchAsar(asarPath);
  if (hits > 0) {
    console.log(`Patched localhost update feed in app.asar (${hits} fix(es))`);
  } else {
    console.log("No localhost feed override found in app.asar (already clean)");
  }

  console.log("");
  console.log("Done. Open HatsApp and click Check for updates.");
  console.log("Your WhatsApp logins stay on this PC — nothing was reinstalled.");
  console.log("");
  pause();
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  pause();
  process.exit(1);
});
