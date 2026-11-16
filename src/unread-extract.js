module.exports = `(() => {
  try {
    const title = String(document.title || "");
    const titleMatch = title.match(/^\\((\\d+)\\)/);
    if (titleMatch) return Math.min(99, parseInt(titleMatch[1], 10) || 0);

    let total = 0;
    const nodes = document.querySelectorAll(
      '[aria-label*="unread message" i], [aria-label*="unread messages" i], span[data-testid="icon-unread-count"], div[data-testid="icon-unread-count"]'
    );
    for (const node of nodes) {
      const label = node.getAttribute("aria-label") || "";
      const fromLabel = label.match(/(\\d+)\\s+unread/i);
      if (fromLabel) {
        total += parseInt(fromLabel[1], 10) || 0;
        continue;
      }
      const text = (node.textContent || "").trim();
      if (/^\\d+$/.test(text)) total += parseInt(text, 10) || 0;
      else if (text.endsWith("+")) {
        const n = parseInt(text, 10);
        if (Number.isFinite(n)) total += n;
      }
    }
    if (total > 0) return Math.min(99, total);
  } catch {}
  return 0;
})()`;
