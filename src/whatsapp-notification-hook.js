(() => {
  if (window.__hatsappNotifHooked) return;
  window.__hatsappNotifHooked = true;

  const handlers = new Map();
  const meta = new Map();

  function makeId() {
    return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  }

  function track(id, target, info) {
    meta.set(id, info);
    handlers.set(id, () => {
      try {
        if (typeof target.onclick === "function") {
          target.onclick.call(target, { type: "click", target });
        }
      } catch {}
      for (const fn of (target.__clickListeners || []).slice()) {
        try {
          fn.call(target, { type: "click", target });
        } catch {}
      }
    });
  }

  function openChatByTitle(title) {
    const clean = String(title || "").trim();
    if (!clean) return false;

    const titled = Array.from(document.querySelectorAll("[title]"));
    for (const node of titled) {
      if ((node.getAttribute("title") || "").trim() !== clean) continue;
      const row =
        node.closest('[role="listitem"]') ||
        node.closest('div[tabindex="0"]') ||
        node.closest("div[data-testid]") ||
        node;
      if (row && typeof row.click === "function") {
        row.click();
        return true;
      }
    }

    const texts = Array.from(document.querySelectorAll("span, div"));
    for (const node of texts) {
      if ((node.textContent || "").trim() !== clean) continue;
      if (node.children && node.children.length > 3) continue;
      const row =
        node.closest('[role="listitem"]') ||
        node.closest('div[tabindex="0"]') ||
        node;
      if (row && typeof row.click === "function") {
        row.click();
        return true;
      }
    }
    return false;
  }

  function fakeNotification(title, options = {}) {
    const id = makeId();
    const info = {
      title: String(title || ""),
      body: String(options.body || ""),
      tag: String(options.tag || ""),
    };
    const target = {
      title: info.title,
      body: info.body,
      tag: info.tag,
      data: options.data,
      onclick: null,
      onclose: null,
      onerror: null,
      onshow: null,
      __clickListeners: [],
      close() {
        handlers.delete(id);
        meta.delete(id);
      },
      addEventListener(type, fn) {
        if (type === "click" && typeof fn === "function") {
          this.__clickListeners.push(fn);
        }
      },
      removeEventListener(type, fn) {
        if (type !== "click") return;
        this.__clickListeners = this.__clickListeners.filter((x) => x !== fn);
      },
      dispatchEvent(ev) {
        if (ev && ev.type === "click") {
          const run = handlers.get(id);
          if (run) run();
          return true;
        }
        return false;
      },
      // keep id for debugging
      __hatsappId: id,
    };

    track(id, target, info);

    try {
      if (window.__hatsappBridge && window.__hatsappBridge.sendNotification) {
        window.__hatsappBridge.sendNotification({
          id,
          title: info.title,
          body: info.body,
          tag: info.tag,
        });
      }
    } catch {}

    return target;
  }

  window.Notification = function (title, options) {
    return fakeNotification(title, options || {});
  };
  window.Notification.permission = "granted";
  window.Notification.requestPermission = async () => "granted";

  try {
    const proto = ServiceWorkerRegistration.prototype;
    const original = proto.showNotification;
    proto.showNotification = function (title, options) {
      fakeNotification(title, options || {});
      return Promise.resolve(undefined);
    };
    window.__hatsappOriginalShowNotification = original;
  } catch {}

  window.__hatsappHandleNotificationClick = function (id, title) {
    try {
      window.focus();
    } catch {}

    const run = handlers.get(id);
    if (run) {
      run();
      handlers.delete(id);
      return "handler";
    }

    const stored = meta.get(id);
    const guess = (stored && stored.title) || title || "";
    if (openChatByTitle(guess)) return "dom-title";

    return "miss";
  };
})();
