const listEl = document.getElementById("accountList");
const emptyEl = document.getElementById("emptyState");
const formEl = document.getElementById("addForm");
const nameEl = document.getElementById("accountName");
const addSubmitEl = document.getElementById("addSubmit");
const toggleEl = document.getElementById("sidebarToggle");
const sidebarEl = document.getElementById("sidebar");
const accountMenu = document.getElementById("accountMenu");
const accountMenuMute = document.getElementById("accountMenuMute");
const accountMenuReload = document.getElementById("accountMenuReload");
const accountMenuRemove = document.getElementById("accountMenuRemove");
const updateBtn = document.getElementById("updateBtn");
const updateStatus = document.getElementById("updateStatus");
const UNREAD_CAP = 10;

const SIDEBAR_EXPANDED = 240;
const SIDEBAR_COLLAPSED = 56;
const STORAGE_KEY = "hatsapp.sidebarCollapsed";
const SIDEBAR_ANIM_MS = 280;

let sidebarAnimRaf = 0;
let currentSidebarWidth = SIDEBAR_EXPANDED;
let renamingId = null;
let menuAccountId = null;
let dragSourceId = null;
let suppressClickId = null;
let latestAccounts = [];

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
  closeAccountMenu();
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  toggleEl.title = collapsed ? "Show sidebar" : "Hide sidebar";
  toggleEl.setAttribute("aria-label", toggleEl.title);
  addSubmitEl.textContent = collapsed ? "+" : "Add";
  localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  const width = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;
  if (animate) animateSidebarWidth(width);
  else setSidebarWidth(width);
}

function closeAccountMenu() {
  accountMenu.classList.add("hidden");
  menuAccountId = null;
}

function openAccountMenu(accountId, anchor) {
  menuAccountId = accountId;
  const account = latestAccounts.find((a) => a.id === accountId);
  accountMenuMute.textContent = account?.muted ? "Unmute notifications" : "Mute notifications";
  const sidebarRect = sidebarEl.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  accountMenu.classList.remove("hidden");
  const menuH = accountMenu.offsetHeight;
  let top = anchorRect.bottom - sidebarRect.top + 4;
  if (top + menuH > sidebarRect.height - 8) {
    top = Math.max(8, anchorRect.top - sidebarRect.top - menuH - 4);
  }
  accountMenu.style.top = `${top}px`;
  accountMenu.style.right = "10px";
  accountMenu.style.left = "auto";
}

function formatUnread(count) {
  const n = Number(count) || 0;
  if (n <= 0) return "";
  if (n >= UNREAD_CAP) return "+";
  return String(n);
}

function applyAccountVisuals(row, account, activeAccountId) {
  row.classList.toggle("active", account.id === activeAccountId);
  row.classList.toggle("muted", Boolean(account.muted));
  row.title = account.muted ? `${account.name} (muted)` : account.name;

  const avatar = row.querySelector(".avatar");
  const existingImg = avatar.querySelector("img");
  if (account.avatar) {
    if (existingImg) {
      if (existingImg.src !== account.avatar) existingImg.src = account.avatar;
    } else {
      avatar.textContent = "";
      avatar.style.background = "";
      const img = document.createElement("img");
      img.src = account.avatar;
      img.alt = "";
      avatar.appendChild(img);
    }
  } else if (!existingImg) {
    avatar.textContent = initials(account.name);
    avatar.style.background = account.color || "#233138";
  }

  const nameEl = row.querySelector(".account-name");
  if (nameEl) nameEl.textContent = account.name;

  const badge = row.querySelector(".unread-badge");
  const label = formatUnread(account.unread);
  if (label) {
    badge.textContent = label;
    badge.classList.remove("hidden");
  } else {
    badge.textContent = "";
    badge.classList.add("hidden");
  }
}

function beginInlineRename(row, account) {
  if (isCollapsed()) applySidebarState(false);
  closeAccountMenu();
  renamingId = account.id;
  row.draggable = false;
  row.classList.add("renaming");

  const meta = row.querySelector(".account-meta");
  const actions = row.querySelector(".account-actions");
  if (actions) actions.style.display = "none";

  const form = document.createElement("form");
  form.className = "rename-form";
  form.setAttribute("autocomplete", "off");

  const input = document.createElement("input");
  input.type = "text";
  input.className = "rename-input";
  input.maxLength = 40;
  input.value = account.name;
  input.setAttribute("aria-label", "Rename account");
  input.name = "accountName";
  input.draggable = false;

  const saveBtn = document.createElement("button");
  saveBtn.type = "submit";
  saveBtn.className = "rename-save";
  saveBtn.title = "Save";
  saveBtn.setAttribute("aria-label", "Save name");
  saveBtn.textContent = "Save";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "rename-cancel";
  cancelBtn.title = "Cancel";
  cancelBtn.setAttribute("aria-label", "Cancel rename");
  cancelBtn.textContent = "✕";

  form.appendChild(input);
  form.appendChild(saveBtn);
  form.appendChild(cancelBtn);
  meta.innerHTML = "";
  meta.appendChild(form);

  let finished = false;
  const cleanupKey = () => {
    window.removeEventListener("keydown", onGlobalKey, true);
  };

  const finish = async (save) => {
    if (finished) return;
    finished = true;
    cleanupKey();
    renamingId = null;
    row.classList.remove("renaming");
    row.draggable = true;
    listEl.innerHTML = "";
    const trimmed = input.value.trim();
    if (save && trimmed && trimmed !== account.name) {
      const latest = await window.waMulti.renameAccount(account.id, trimmed);
      render(latest);
      return;
    }
    const latest = await window.waMulti.getAccounts();
    render(latest);
  };

  function onGlobalKey(e) {
    if (renamingId !== account.id || finished) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
  }

  form.addEventListener("click", (e) => e.stopPropagation());
  form.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    window.waMulti.focusShell();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    e.stopPropagation();
    finish(true);
  });
  cancelBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    finish(false);
  });
  input.addEventListener("dragstart", (e) => e.preventDefault());
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

  window.addEventListener("keydown", onGlobalKey, true);
  window.waMulti.focusShell();
  requestAnimationFrame(() => {
    window.waMulti.focusShell();
    input.focus();
    input.select();
  });
}

function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function orderedIdsFromDom() {
  return [...listEl.querySelectorAll(".account")].map((el) => el.dataset.id);
}

async function persistOrder() {
  const ids = orderedIdsFromDom();
  if (!ids.length) return;
  await window.waMulti.reorderAccounts(ids);
}

function wireAccountRow(row, accountId) {
  row.addEventListener("click", (e) => {
    if (e.target.closest("button") || e.target.closest(".rename-form") || e.target.closest(".rename-input")) return;
    if (suppressClickId === accountId) {
      suppressClickId = null;
      return;
    }
    closeAccountMenu();
    window.waMulti.switchAccount(accountId);
  });

  row.addEventListener("dragstart", (e) => {
    if (renamingId === accountId || e.target.closest(".rename-input")) {
      e.preventDefault();
      return;
    }
    closeAccountMenu();
    dragSourceId = accountId;
    row.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", accountId);
  });

  row.addEventListener("dragend", () => {
    row.classList.remove("dragging");
    for (const el of listEl.querySelectorAll(".account.drag-over")) {
      el.classList.remove("drag-over");
    }
    if (dragSourceId) suppressClickId = dragSourceId;
    dragSourceId = null;
  });

  row.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!dragSourceId || dragSourceId === accountId) return;
    const dragging = listEl.querySelector(`.account[data-id="${dragSourceId}"]`);
    if (!dragging || dragging === row) return;
    const rect = row.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    if (before) listEl.insertBefore(dragging, row);
    else listEl.insertBefore(dragging, row.nextSibling);
  });

  row.addEventListener("drop", async (e) => {
    e.preventDefault();
    await persistOrder();
  });

  row.querySelector(".rename").addEventListener("click", (e) => {
    e.stopPropagation();
    const account = latestAccounts.find((a) => a.id === accountId);
    if (account) beginInlineRename(row, account);
  });

  row.querySelector(".more").addEventListener("click", (e) => {
    e.stopPropagation();
    if (menuAccountId === accountId && !accountMenu.classList.contains("hidden")) {
      closeAccountMenu();
      return;
    }
    openAccountMenu(accountId, e.currentTarget);
  });
}

function render({ accounts, activeAccountId }) {
  latestAccounts = accounts || [];
  if (renamingId) {
    const stillThere = latestAccounts.some((a) => a.id === renamingId);
    if (stillThere) return;
    renamingId = null;
  }

  emptyEl.classList.toggle("hidden", latestAccounts.length > 0);

  const rows = [...listEl.querySelectorAll(".account")];
  const nextIds = latestAccounts.map((a) => a.id).join(",");
  const currentIds = rows.map((el) => el.dataset.id).join(",");
  const stuckRename = rows.some((el) => el.classList.contains("renaming") || el.querySelector(".rename-form"));
  if (nextIds === currentIds && currentIds && !stuckRename) {
    for (const account of latestAccounts) {
      const row = listEl.querySelector(`.account[data-id="${account.id}"]`);
      if (row) applyAccountVisuals(row, account, activeAccountId);
    }
    return;
  }

  listEl.innerHTML = "";
  for (const account of latestAccounts) {
    const row = document.createElement("div");
    row.className = "account";
    row.dataset.id = account.id;
    row.draggable = true;
    row.innerHTML = `
      <div class="avatar-wrap">
        <div class="avatar" aria-hidden="true"></div>
        <span class="unread-badge hidden"></span>
      </div>
      <div class="account-meta">
        <div class="account-name"></div>
      </div>
      <div class="account-actions">
        <button type="button" class="icon-btn rename" title="Rename">✎</button>
        <button type="button" class="icon-btn more" title="More">⋯</button>
      </div>
    `;
    applyAccountVisuals(row, account, activeAccountId);
    wireAccountRow(row, account.id);
    listEl.appendChild(row);
  }
}

toggleEl.addEventListener("click", () => {
  closeAccountMenu();
  applySidebarState(!isCollapsed());
});

sidebarEl.addEventListener(
  "pointerdown",
  () => {
    window.waMulti.focusShell();
  },
  true
);

nameEl.addEventListener("focus", () => {
  window.waMulti.focusShell();
});

formEl.addEventListener("submit", async (e) => {
  e.preventDefault();
  closeAccountMenu();
  if (isCollapsed()) {
    applySidebarState(false);
    window.waMulti.focusShell();
    nameEl.focus();
    return;
  }
  const name = nameEl.value.trim();
  nameEl.value = "";
  await window.waMulti.addAccount(name);
});

accountMenuMute.addEventListener("click", async (e) => {
  e.stopPropagation();
  const id = menuAccountId;
  closeAccountMenu();
  if (!id) return;
  await window.waMulti.toggleAccountMute(id);
});

accountMenuReload.addEventListener("click", async (e) => {
  e.stopPropagation();
  const id = menuAccountId;
  closeAccountMenu();
  if (!id) return;
  await window.waMulti.reloadAccount(id);
});

accountMenuRemove.addEventListener("click", async (e) => {
  e.stopPropagation();
  const id = menuAccountId;
  const account = latestAccounts.find((a) => a.id === id);
  closeAccountMenu();
  if (!id || !account) return;
  const choice = await window.waMulti.confirmRemoveAccount(account.name);
  if (!choice) return;
  await window.waMulti.removeAccount(id);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAccountMenu();
});

document.addEventListener("click", (e) => {
  if (!accountMenu.classList.contains("hidden") && !accountMenu.contains(e.target) && !e.target.closest(".more")) {
    closeAccountMenu();
  }
});

listEl.addEventListener("dragover", (e) => e.preventDefault());
listEl.addEventListener("drop", async (e) => {
  e.preventDefault();
  await persistOrder();
});

let currentResetTimer = null;

function applyUpdateState(state) {
  if (!state) return;
  const status = state.status || "idle";
  const message = state.message || "";
  updateStatus.textContent = message;
  updateStatus.classList.toggle("active", status === "checking" || status === "downloading" || status === "available");
  updateStatus.classList.toggle("error", status === "error");
  updateStatus.classList.toggle("ready", status === "ready" || status === "current");
  updateBtn.classList.remove("busy", "ready", "error", "current");
  if (currentResetTimer) {
    clearTimeout(currentResetTimer);
    currentResetTimer = null;
  }

  if (status === "ready") {
    updateBtn.textContent = "Restart to finish update";
    updateBtn.classList.add("ready");
    updateBtn.disabled = false;
    return;
  }

  if (status === "checking" || status === "downloading" || status === "available") {
    updateBtn.textContent =
      status === "downloading" ? `Downloading… ${state.progress || 0}%` : "Looking for updates…";
    updateBtn.classList.add("busy");
    updateBtn.disabled = true;
    return;
  }

  if (status === "error") {
    updateBtn.textContent = "Check for updates";
    updateBtn.classList.add("error");
    updateBtn.disabled = false;
    return;
  }

  if (status === "current") {
    updateBtn.textContent = "You're up to date";
    updateBtn.classList.add("current");
    updateBtn.disabled = false;
    currentResetTimer = setTimeout(() => {
      if (updateBtn.classList.contains("current")) {
        updateBtn.classList.remove("current");
        updateBtn.textContent = "Check for updates";
      }
      currentResetTimer = null;
    }, 4000);
    return;
  }

  updateBtn.textContent = "Check for updates";
  updateBtn.disabled = false;
}

updateBtn.addEventListener("click", async () => {
  closeAccountMenu();
  const state = await window.waMulti.getUpdateState();
  if (state?.status === "ready") {
    await window.waMulti.installUpdate();
    return;
  }
  updateBtn.disabled = true;
  updateBtn.classList.remove("ready", "error");
  updateBtn.classList.add("busy");
  updateBtn.textContent = "Looking for updates…";
  updateStatus.textContent = "Looking for updates…";
  updateStatus.classList.add("active");
  updateStatus.classList.remove("error", "ready");
  await window.waMulti.checkForUpdates();
});

window.waMulti.onUpdateState(applyUpdateState);
window.waMulti.getUpdateState().then(applyUpdateState);

applySidebarState(localStorage.getItem(STORAGE_KEY) === "1", false);
window.waMulti.onAccountsUpdated(render);
window.waMulti.getAccounts().then(render);
