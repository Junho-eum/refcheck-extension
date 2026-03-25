// ── Background Service Worker ─────────────────────────────────────────────────

// Store pending text to send when sidebar loads
let pendingText = null;

// Create context menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "refcheck-suggest",
    title: "💡 Suggest References",
    contexts: ["selection"],
    documentUrlPatterns: ["https://www.overleaf.com/*"],
  });

  // Enable side panel on all tabs by default
  chrome.sidePanel.setOptions({ enabled: true });
});

// Allow side panel to open on action click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "refcheck-suggest") return;

  const selectedText = info.selectionText?.trim();
  if (!selectedText) return;

  // Open panel first to preserve user gesture context
  await chrome.sidePanel.open({ tabId: tab.id });

  // Store text so sidebar poller picks it up
  pendingText = selectedText;
  await chrome.storage.local.set({ refcheck_pending_text: selectedText });
});

// Handle messages from content.js floating button and sidebar
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Floating button clicked — open sidebar and store text
  if (message.type === "FLOATING_BTN_CLICKED" && message.text) {
    const text = message.text.trim();
    if (!text) return;
    chrome.storage.local.set({ refcheck_pending_text: text });
    if (sender.tab?.id) {
      chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
    }
  }

  if (message.type === "TEXT_READY") {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#2b6cb0" });
  }

  // Sidebar asking if there's pending text
  if (message.type === "GET_PENDING") {
    chrome.action.setBadgeText({ text: "" });
    chrome.storage.local.get("refcheck_pending_text").then((stored) => {
      const text = stored.refcheck_pending_text || null;
      chrome.storage.local.remove("refcheck_pending_text");
      sendResponse(text);
    });
    return true;
  }
});
