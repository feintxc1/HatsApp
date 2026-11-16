const { app, BaseWindow, WebContentsView } = require("electron");
const path = require("path");
const fs = require("fs");

const OUT = path.join(__dirname, "..", "release", "qa-blank-screen");
const SIDEBAR = 240;
const W = 1100;
const H = 700;

function ensureOut() {
  fs.mkdirSync(OUT, { recursive: true });
}

function pageHtml(color, label) {
  return `<!doctype html><html><body style="margin:0;background:${color};color:#fff;font:700 42px Segoe UI;display:flex;align-items:center;justify-content:center;height:100vh;">${label}</body></html>`;
}

function setAttached(win, view, attached, shell) {
  const children = win.contentView.children || [];
  const isAttached = children.includes(view);
  if (attached && !isAttached) {
    win.contentView.addChildView(view);
    if (shell) win.contentView.addChildView(shell);
  } else if (!attached && isAttached) {
    win.contentView.removeChildView(view);
  }
}

function hibernateOld(win, view) {
  view.webContents.setBackgroundThrottling(true);
  if (typeof view.setVisible === "function") view.setVisible(true);
  setAttached(win, view, true, null);
  view.setBounds({ x: -16000, y: 0, width: W - SIDEBAR, height: H });
}

function hibernateNew(win, view) {
  view.webContents.setBackgroundThrottling(true);
  if (typeof view.setVisible === "function") view.setVisible(false);
  setAttached(win, view, false, null);
}

function wakeNew(win, view, shell, focus) {
  setAttached(win, view, true, shell);
  if (typeof view.setVisible === "function") view.setVisible(true);
  view.setBounds({ x: SIDEBAR, y: 0, width: W - SIDEBAR, height: H });
  view.webContents.setBackgroundThrottling(false);
  if (focus) {
    try {
      view.webContents.focus();
    } catch {}
  }
}

function attachedIds(win, views) {
  const children = win.contentView.children || [];
  return [...views.entries()].filter(([, v]) => children.includes(v)).map(([id]) => id);
}

async function sampleCenter(view) {
  const img = await view.webContents.capturePage();
  const size = img.getSize();
  const tmp = path.join(OUT, `_sample-${Date.now()}-${Math.random().toString(16).slice(2)}.png`);
  fs.writeFileSync(tmp, img.toPNG());
  const bitmap = img.toBitmap();
  const x0 = Math.max(0, Math.floor(size.width * 0.2) - 8);
  const y0 = Math.max(0, Math.floor(size.height * 0.2) - 8);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y0 + 16 && y < size.height; y++) {
    for (let x = x0; x < x0 + 16 && x < size.width; x++) {
      const i = (y * size.width + x) * 4;
      b += bitmap[i];
      g += bitmap[i + 1];
      r += bitmap[i + 2];
      n += 1;
    }
  }
  return {
    width: size.width,
    height: size.height,
    path: tmp,
    avg: n ? { r: r / n, g: g / n, b: b / n } : null,
  };
}

function isMostlyWhite(avg) {
  if (!avg) return null;
  return avg.r > 245 && avg.g > 245 && avg.b > 245;
}

function isMostlyDarkBlank(avg) {
  if (!avg) return null;
  return avg.r < 20 && avg.g < 20 && avg.b < 20;
}

async function waitPaint(view) {
  await view.webContents.executeJavaScript(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
}

app.whenReady().then(async () => {
  ensureOut();
  const results = [];
  const win = new BaseWindow({
    width: W,
    height: H,
    show: true,
    backgroundColor: "#0b141a",
  });

  const shell = new WebContentsView({ webPreferences: { sandbox: true } });
  shell.setBounds({ x: 0, y: 0, width: SIDEBAR, height: H });
  await shell.webContents.loadURL(
    "data:text/html," + encodeURIComponent(pageHtml("#111b21", "shell"))
  );
  win.contentView.addChildView(shell);

  const colors = {
    a: "#25d366",
    b: "#e74c3c",
    c: "#3498db",
  };
  const views = new Map();
  for (const [id, color] of Object.entries(colors)) {
    const view = new WebContentsView({ webPreferences: { sandbox: true, backgroundThrottling: false } });
    view.setBackgroundColor("#0b141a");
    await view.webContents.loadURL(
      "data:text/html," + encodeURIComponent(pageHtml(color, id.toUpperCase()))
    );
    views.set(id, view);
  }

  let active = "a";
  function layout(mode) {
    for (const [id, view] of views) {
      if (id === active) wakeNew(win, view, shell, false);
      else if (mode === "old") hibernateOld(win, view);
      else hibernateNew(win, view);
    }
    setAttached(win, shell, true, null);
    shell.setBounds({ x: 0, y: 0, width: SIDEBAR, height: H });
  }

  layout("new");
  await waitPaint(views.get(active));

  const afterNew = attachedIds(win, views);
  results.push({
    name: "new-hibernate-only-active-attached",
    pass: afterNew.length === 1 && afterNew[0] === "a",
    detail: { attached: afterNew },
  });

  layout("old");
  const afterOld = attachedIds(win, views);
  results.push({
    name: "old-hibernate-all-attached",
    pass: afterOld.length === 3,
    detail: { attached: afterOld },
  });

  layout("new");
  for (let i = 0; i < 40; i++) {
    active = ["a", "b", "c"][i % 3];
    layout("new");
    await waitPaint(views.get(active));
  }
  const afterSwitch = attachedIds(win, views);
  results.push({
    name: "stress-switch-only-active-attached",
    pass: afterSwitch.length === 1 && afterSwitch[0] === active,
    detail: { active, attached: afterSwitch },
  });

  for (let i = 0; i < 30; i++) {
    layout("new");
  }
  await waitPaint(views.get(active));
  const shot = await sampleCenter(views.get(active));
  const shotPath = path.join(OUT, `active-${active}.png`);
  fs.copyFileSync(shot.path, shotPath);
  const expected = colors[active];
  const er = parseInt(expected.slice(1, 3), 16);
  const eg = parseInt(expected.slice(3, 5), 16);
  const eb = parseInt(expected.slice(5, 7), 16);
  let colorPass = false;
  if (shot.avg) {
    const dr = Math.abs(shot.avg.r - er);
    const dg = Math.abs(shot.avg.g - eg);
    const db = Math.abs(shot.avg.b - eb);
    colorPass = dr < 45 && dg < 45 && db < 45;
  }
  results.push({
    name: "active-view-still-painted-after-stress",
    pass: colorPass && !isMostlyWhite(shot.avg) && !isMostlyDarkBlank(shot.avg),
    detail: { active, avg: shot.avg, shotPath, expected },
  });

  layout("old");
  for (let i = 0; i < 30; i++) layout("old");
  active = "b";
  wakeNew(win, views.get("b"), shell, true);
  for (const [id, view] of views) {
    if (id !== "b") hibernateOld(win, view);
  }
  await waitPaint(views.get("b"));
  const oldModeAttached = attachedIds(win, views);
  results.push({
    name: "old-mode-keeps-inactive-in-compositor",
    pass: oldModeAttached.length === 3,
    detail: { attached: oldModeAttached },
  });

  const installedAsar = path.join(
    process.env.LOCALAPPDATA || "",
    "Programs",
    "HatsApp",
    "resources",
    "app.asar"
  );
  let asarPass = false;
  let asarDetail = {};
  let installedVersion = null;
  if (fs.existsSync(installedAsar)) {
    const asar = require("@electron/asar");
    const mainJs = asar.extractFile(installedAsar, "src/main.js").toString("utf8");
    installedVersion = JSON.parse(
      asar.extractFile(installedAsar, "package.json").toString("utf8")
    ).version;
    asarDetail = {
      hasDetachHibernate: /setViewAttached\(view, false\)/.test(mainJs),
      noOffscreenPark: !/-16000/.test(mainJs),
      noForceRepaint: !/function forceRepaint/.test(mainJs),
      noFakeVisibility: !/visibilitychange/.test(mainJs),
      hasCrashRecovery: /render-process-gone/.test(mainJs),
      noFocusRecoverStorm: !/mainWindow\.on\("focus"/.test(mainJs),
    };
    asarPass = Object.values(asarDetail).every(Boolean);
  }
  results.push({
    name: "installed-1.0.5-asar-contains-fix",
    pass: asarPass,
    detail: asarDetail,
  });
  results.push({
    name: "installed-version-is-1.0.5",
    pass: installedVersion === "1.0.5",
    detail: { version: installedVersion },
  });

  const failed = results.filter((r) => !r.pass);
  const report = {
    ok: failed.length === 0,
    failed: failed.map((r) => r.name),
    results,
  };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  app.exit(failed.length === 0 ? 0 : 1);
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
