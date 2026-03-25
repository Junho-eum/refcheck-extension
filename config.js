// ── RefCheck Configuration ────────────────────────────────────────────────────
// API keys are entered by the user in the extension UI and stored in chrome.storage.
// Do NOT hardcode secret keys here — they would be visible to anyone who installs the extension.

const CONFIG = {
  SUPABASE_URL: "https://vtmmxmaabhicctwjzltl.supabase.co",
  SUPABASE_KEY: "", // Set via chrome.storage — see options page

  // Leave blank — user enters their key in the sidebar setup box
  ANTHROPIC_API_KEY: "",

  // Minimum score to show a result (0-10)
  MIN_SCORE: 2,

  // Model to use for matching
  MODEL: "claude-haiku-4-5-20251001",
  MAX_TOKENS: 2000,
};
