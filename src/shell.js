const listEl = document.getElementById("accountList");
const emptyEl = document.getElementById("emptyState");
const formEl = document.getElementById("addForm");
const nameEl = document.getElementById("accountName");
const addSubmitEl = document.getElementById("addSubmit");
const toggleEl = document.getElementById("sidebarToggle");
const sidebarEl = document.getElementById("sidebar");
const colorPopover = document.getElementById("colorPopover");
const colorGrid = document.getElementById("colorGrid");
const customColor = document.getElementById("customColor");

const SIDEBAR_EXPANDED = 240;
const SIDEBAR_COLLAPSED = 56;
const STORAGE_KEY = "hatsapp.sidebarCollapsed";
const SIDEBAR_ANIM_MS = 280;

let sidebarAnimRaf = 0;
let currentSidebarWidth = SIDEBAR_EXPANDED;
let colorTargetId = null;
let renamingId = null;
let colorOpenTimer = 0;

const COLOR_OPTIONS = [
  "#25D366",
  "#128C7E",
  "#075E54",
  "#34B7F1",
  "#00A884",
  "#53BDEB",
  "#1ABC9C",
  "#16A085",
  "#2ECC71",
  "#27AE60",
  "#3498DB",
  "#2980B9",
  "#9B59B6",
  "#8E44AD",
  "#6C5CE7",
  "#A29BFE",
  "#E74C3C",
  "#C0392B",
  "#FF6B6B",
  "#FA5252",
  "#E67E22",
  "#D35400",
  "#F5A623",
  "#F39C12",
  "#F1C40F",
  "#FFD43B",
  "#E84393",
  "#FD79A8",
  "#00CEC9",
  "#81ECEC",
  "#636E72",
  "#2D3436",
  "#DFE6E9",
  "#B2BEC3",
  "#FFFFFF",
  "#000000",
];

function isCollapsed() {
  return document.body.classList.contains("sidebar-collapsed");
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function setSidebarWidth(width) {
  currentSidebarWidth = width;
  window.waMulti.setSidebarWidth(width);
}

function animateSidebarWidth(target) {
  if (sidebarAnimRaf) cancelAnimationFrame(sidebarAnimRaf);
  const start = currentSidebarWidth;
  const delta = target - start;
  if (delta === 0) {
    setSidebarWidth(target);
    return;
  }
  const startTime = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - startTime) / SIDEBAR_ANIM_MS);
    setSidebarWidth(Math.round(start + delta * easeOutCubic(t)));
    if (t < 1) sidebarAnimRaf = requestAnimationFrame(tick);
    else sidebarAnimRaf = 0;
  };
  sidebarAnimRaf = requestAnimationFrame(tick);
}

function applySidebarState(collapsed, animate = true) {
  if (collapsed) closeColorPopover();
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  toggleEl.title = collapsed ? "Show sidebar" : "Hide sidebar";
  toggleEl.setAttribute("aria-label", toggleEl.title);
  addSubmitEl.textContent = collapsed ? "+" : "Add";
  localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  const width = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;
  if (animate) animateSidebarWidth(width);
  else setSidebarWidth(width);
}

function closeColorPopover() {
  if (colorOpenTimer) {
    clearTimeout(colorOpenTimer);
    colorOpenTimer = 0;
  }
  colorPopover.classList.add("hidden");
  colorTargetId = null;
}

function positionColorPopover(anchor) {
  const sidebarRect = sidebarEl.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const popW = SIDEBAR_EXPANDED - 16;
  const popH = colorPopover.offsetHeight;
  let top = anchorRect.bottom - sidebarRect.top + 6;
  if (top + popH > sidebarRect.height - 8) {
    top = Math.max(8, anchorRect.top - sidebarRect.top - popH - 6);
  }
  colorPopover.style.left = "8px";
  colorPopover.style.top = `${top}px`;
  colorPopover.style.width = `${popW}px`;
}

function openColorPopover(account, anchor) {
  if (currentSidebarWidth < SIDEBAR_EXPANDED - 1 || isCollapsed()) {
    applySidebarState(false);
    if (colorOpenTimer) clearTimeout(colorOpenTimer);
    colorTargetId = account.id;
    colorOpenTimer = window.setTimeout(() => {
      colorOpenTimer = 0;
      if (colorTargetId !== account.id) return;
      openColorPopover(account, anchor);
    }, SIDEBAR_ANIM_MS + 40);
    return;
  }

  colorTargetId = account.id;
  customColor.value = /^#[0-9a-fA-F]{6}$/.test(account.color)
    ? account.color
    : "#25D366";

  const selected = (account.color || "").toUpperCase();
  for (const btn of colorGrid.querySelectorAll(".color-swatch")) {
    btn.classList.toggle("selected", btn.dataset.color.toUpperCase() === selected);
  }

  colorPopover.classList.remove("hidden");
  positionColorPopover(anchor);
}

async function applyColor(color) {
  if (!colorTargetId) return;
  const id = colorTargetId;
  closeColorPopover();
  await window.waMulti.setAccountColor(id, color);
}

function buildColorGrid() {
  colorGrid.innerHTML = "";
  for (const color of COLOR_OPTIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "color-swatch";
    btn.dataset.color = color;
    btn.style.background = color;
    btn.title = color;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      applyColor(color);
    });
    colorGrid.appendChild(btn);
  }
}

function beginInlineRename(row, account) {
  if (isCollapsed()) applySidebarState(false);
  closeColorPopover();
  renamingId = account.id;

  const meta = row.querySelector(".account-meta");
  const actions = row.querySelector(".account-actions");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "rename-input";
  input.maxLength = 40;
  input.value = account.name;
  input.setAttribute("aria-label", "Rename account");

  meta.innerHTML = "";
  meta.appendChild(input);
  if (actions) actions.style.display = "none";

  let finished = false;
  const finish = async (save) => {
    if (finished) return;
    finished = true;
    renamingId = null;
    const trimmed = input.value.trim();
    if (save && trimmed && trimmed !== account.name) {
      await window.waMulti.renameAccount(account.id, trimmed);
      return;
    }
    const latest = await window.waMulti.getAccounts();
    render(latest);
  };

  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("mousedown", (e) => e.stopPropagation());
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));

  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function render({ accounts, activeAccountId }) {
  if (renamingId) {
    const stillThere = accounts.some((a) => a.id === renamingId);
    if (stillThere) return;
    renamingId = null;
  }

  listEl.innerHTML = "";
  emptyEl.classList.toggle("hidden", accounts.length > 0);

  for (const account of accounts) {
    const row = document.createElement("div");
    row.className = `account${account.id === activeAccountId ? " active" : ""}`;
    row.title = account.name;
    row.innerHTML = `
      <button type="button" class="dot" title="Change color" aria-label="Change color"></button>
      <div class="account-meta">
        <div class="account-name"></div>
      </div>
      <div class="account-actions">
        <button type="button" class="icon-btn rename" title="Rename">✎</button>
        <button type="button" class="icon-btn danger remove" title="Remove">✕</button>
      </div>
    `;
    const dot = row.querySelector(".dot");
    dot.style.background = account.color;
    row.querySelector(".account-name").textContent = account.name;

    row.addEventListener("click", (e) => {
      if (e.target.closest("button") || e.target.closest(".rename-input")) return;
      closeColorPopover();
      window.waMulti.switchAccount(account.id);
    });

    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      if (colorTargetId === account.id && !colorPopover.classList.contains("hidden")) {
        closeColorPopover();
        return;
      }
      openColorPopover(account, dot);
    });

    row.querySelector(".rename").addEventListener("click", (e) => {
      e.stopPropagation();
      beginInlineRename(row, account);
    });

    row.querySelector(".remove").addEventListener("click", async (e) => {
      e.stopPropagation();
      closeColorPopover();
      const ok = await window.waMulti.confirmRemoveAccount(account.name);
      if (!ok) return;
      await window.waMulti.removeAccount(account.id);
    });

    listEl.appendChild(row);
  }
}

toggleEl.addEventListener("click", () => {
  closeColorPopover();
  applySidebarState(!isCollapsed());
});

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  closeColorPopover();
  if (isCollapsed()) {
    applySidebarState(false);
    nameEl.focus();
    return;
  }
  const name = nameEl.value.trim();
  nameEl.value = "";
  await window.waMulti.addAccount(name);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeColorPopover();
});

customColor.addEventListener("input", (e) => {
  e.stopPropagation();
});
customColor.addEventListener("change", (e) => {
  e.stopPropagation();
  applyColor(customColor.value);
});

document.addEventListener("click", (e) => {
  if (!colorPopover.classList.contains("hidden") && !colorPopover.contains(e.target) && !e.target.closest(".dot")) {
    closeColorPopover();
  }
});

buildColorGrid();
applySidebarState(localStorage.getItem(STORAGE_KEY) === "1", false);
window.waMulti.onAccountsUpdated(render);
window.waMulti.getAccounts().then(render);
