// ── Content Script — Floating "Suggest References" button on Overleaf ────────

(function () {
  let btn = null;

  function createButton() {
    const el = document.createElement("button");
    el.textContent = "💡 Suggest References";
    Object.assign(el.style, {
      position: "absolute",
      zIndex: "999999",
      padding: "6px 14px",
      background: "linear-gradient(135deg,#2b6cb0,#2c5282)",
      color: "#fff",
      border: "none",
      borderRadius: "6px",
      fontSize: "12px",
      fontWeight: "600",
      fontFamily: "'Inter','Segoe UI',system-ui,sans-serif",
      cursor: "pointer",
      boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
      whiteSpace: "nowrap",
      display: "none",
      transition: "opacity 0.15s",
      opacity: "0",
    });
    el.addEventListener("mousedown", (e) => {
      // Prevent the mousedown from clearing the selection
      e.preventDefault();
      e.stopPropagation();
    });
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const text = window.getSelection()?.toString().trim();
      if (!text) return;
      // Send selected text to background to open sidebar
      chrome.runtime.sendMessage({
        type: "FLOATING_BTN_CLICKED",
        text,
      });
      hideButton();
    });
    document.body.appendChild(el);
    return el;
  }

  function showButton(x, y) {
    if (!btn) btn = createButton();
    btn.style.left = x + "px";
    btn.style.top = y + "px";
    btn.style.display = "block";
    // Force reflow then fade in
    btn.offsetHeight;
    btn.style.opacity = "1";
  }

  function hideButton() {
    if (!btn) return;
    btn.style.opacity = "0";
    setTimeout(() => {
      if (btn) btn.style.display = "none";
    }, 150);
  }

  // Show button when user finishes selecting text (mouseup)
  document.addEventListener("mouseup", (e) => {
    // Small delay so the selection is finalized
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (!text || text.length < 5) {
        hideButton();
        return;
      }

      // Position button near the end of the selection
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // Place above the selection, centered horizontally
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      let left = rect.left + scrollX + rect.width / 2 - 80;
      let top = rect.top + scrollY - 38;

      // Keep within viewport
      if (left < 10) left = 10;
      if (top < 10) top = rect.bottom + scrollY + 6;

      showButton(left, top);
    }, 10);
  });

  // Hide button when clicking elsewhere (not on the button itself)
  document.addEventListener("mousedown", (e) => {
    if (btn && e.target !== btn) {
      hideButton();
    }
  });

  // Hide on keydown (e.g. Escape, or user starts typing)
  document.addEventListener("keydown", () => {
    hideButton();
  });
})();
