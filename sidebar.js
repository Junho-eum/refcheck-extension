// ── Sidebar Logic ─────────────────────────────────────────────────────────────

let apiKey = "";
let dbPapers = [];
let isRunning = false;
let stopRequested = false;
let expanded = null;
let pendingTextForAnalysis = null;

// ── HTML escape helper (prevents XSS) ────────────────────────────────────────
function esc(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  // Load saved API key and Supabase key
  const stored = await chrome.storage.local.get([
    "refcheck_apikey",
    "refcheck_supabase_key",
  ]);
  apiKey = stored.refcheck_apikey || CONFIG.ANTHROPIC_API_KEY || "";

  // Load Supabase key from storage if config is blank
  if (!CONFIG.SUPABASE_KEY && stored.refcheck_supabase_key) {
    CONFIG.SUPABASE_KEY = stored.refcheck_supabase_key;
  }

  if (!apiKey) {
    document.getElementById("setup-box").style.display = "block";
  }

  // Setup key save button
  document.getElementById("save-key-btn").addEventListener("click", () => {
    const val = document.getElementById("api-key-input").value.trim();
    if (val.startsWith("sk-ant-")) {
      apiKey = val;
      chrome.storage.local.set({ refcheck_apikey: val });
      document.getElementById("setup-box").style.display = "none";
      document.getElementById("key-status").textContent = "✓ Saved";
      document.getElementById("key-status").style.color = "#276749";
    } else {
      document.getElementById("key-status").textContent =
        "⚠ Key must start with sk-ant-";
      document.getElementById("key-status").style.color = "#c53030";
    }
  });

  // Load projects into dropdown
  await loadProjectDropdown();

  // Wire up Start Analysis button
  document
    .getElementById("start-analysis-btn")
    .addEventListener("click", () => {
      if (!pendingTextForAnalysis) return;
      const text = pendingTextForAnalysis;
      pendingTextForAnalysis = null;
      document.getElementById("analysis-controls").style.display = "none";
      analyzeText(text);
    });

  // Wire up Stop Analysis button
  document
    .getElementById("stop-analysis-btn")
    .addEventListener("click", () => {
      stopRequested = true;
      document.getElementById("stop-analysis-btn").disabled = true;
      document.getElementById("progress-sub").textContent =
        "Stopping after current paper…";
    });

  // ── Poll storage for pending text ─────────────────────────────────────────
  checkPendingText();

  // Also listen for direct messages as fallback
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "ANALYZE_TEXT" && message.text) {
      showPendingText(message.text);
    }
  });

  // Poll every 500ms when sidebar is open
  setInterval(checkPendingText, 500);
}

async function checkPendingText() {
  // Always check — even during analysis (new text cancels the running one)
  const stored = await chrome.storage.local.get("refcheck_pending_text");
  const text = stored.refcheck_pending_text;
  if (text) {
    await chrome.storage.local.remove("refcheck_pending_text");
    // If analysis is running, stop it — new text takes over
    if (isRunning) {
      stopRequested = true;
    }
    showPendingText(text);
  }
}

// ── Show pending text and analysis controls ─────────────────────────────────
function showPendingText(text) {
  pendingTextForAnalysis = text;
  document.getElementById("empty-state").style.display = "none";
  document.getElementById("analysis-controls").style.display = "block";
  document.getElementById("pending-preview-text").textContent =
    text.length > 300 ? text.slice(0, 300) + "…" : text;
}

// ── Load project dropdown from Supabase projects table ──────────────────────
async function loadProjectDropdown() {
  let projects = [{ id: "default", name: "Default Library" }];

  if (CONFIG.SUPABASE_KEY) {
    try {
      const res = await fetch(
        `${CONFIG.SUPABASE_URL}/rest/v1/projects?select=*&order=created_at.asc`,
        {
          headers: {
            apikey: CONFIG.SUPABASE_KEY,
            Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
          },
        },
      );
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        projects = data;
      }
    } catch (e) {
      // fallback to default
    }
  }

  const select = document.getElementById("project-select");
  select.innerHTML = "";
  projects.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  });

  // Restore last selected project
  const lastProj = await chrome.storage.local.get("refcheck_selected_project");
  if (lastProj.refcheck_selected_project) {
    select.value = lastProj.refcheck_selected_project;
  }

  // Save selection on change
  select.addEventListener("change", () => {
    chrome.storage.local.set({ refcheck_selected_project: select.value });
  });
}

// ── Load papers from selected project ───────────────────────────────────────
async function loadPapers() {
  if (!CONFIG.SUPABASE_KEY) {
    document.getElementById("header-sub").textContent =
      "⚠ Supabase key not set — configure in Library Manager";
    dbPapers = [];
    return;
  }
  const select = document.getElementById("project-select");
  const project = select?.value || "default";
  try {
    const res = await fetch(
      `${CONFIG.SUPABASE_URL}/rest/v1/papers?select=*&project=eq.${encodeURIComponent(project)}`,
      {
        headers: {
          apikey: CONFIG.SUPABASE_KEY,
          Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
        },
      },
    );
    const data = await res.json();
    if (!Array.isArray(data)) {
      // Fallback if project column doesn't exist
      const fallback = await fetch(
        `${CONFIG.SUPABASE_URL}/rest/v1/papers?select=*`,
        {
          headers: {
            apikey: CONFIG.SUPABASE_KEY,
            Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
          },
        },
      );
      const fallbackData = await fallback.json();
      dbPapers = Array.isArray(fallbackData) ? fallbackData : [];
    } else {
      dbPapers = data;
    }
    document.getElementById("header-sub").textContent =
      `${dbPapers.length} papers in "${esc(project)}" · highlight text to search`;
  } catch (e) {
    dbPapers = [];
    document.getElementById("header-sub").textContent =
      "⚠ Could not load library";
  }
}

// ── Score color helpers ───────────────────────────────────────────────────────
const SC = (s) =>
  s >= 8 ? "#276749" : s >= 6 ? "#2b6cb0" : s >= 4 ? "#b7791f" : "#c53030";
const SBg = (s) =>
  s >= 8 ? "#f0fff4" : s >= 6 ? "#ebf4ff" : s >= 4 ? "#fffbeb" : "#fff5f5";
const SBo = (s) =>
  s >= 8 ? "#9ae6b4" : s >= 6 ? "#90cdf4" : s >= 4 ? "#fbd38d" : "#feb2b2";
const SL = (s) =>
  s >= 8 ? "Strong" : s >= 6 ? "Good" : s >= 4 ? "Partial" : "Weak";

// ── Main analysis function ────────────────────────────────────────────────────
async function analyzeText(text) {
  // If already running, wait for it to stop
  if (isRunning) return;
  if (!text) return;
  if (!apiKey) {
    document.getElementById("setup-box").style.display = "block";
    document.getElementById("key-status").textContent =
      "Please enter your API key first.";
    document.getElementById("key-status").style.color = "#c53030";
    return;
  }

  isRunning = true;
  stopRequested = false;
  expanded = null;

  // Load papers from the selected project
  await loadPapers();

  // Show UI
  document.getElementById("empty-state").style.display = "none";
  document.getElementById("analysis-controls").style.display = "none";
  document.getElementById("preview-box").style.display = "block";
  document.getElementById("progress-box").style.display = "block";
  document.getElementById("stop-analysis-btn").disabled = false;
  document.getElementById("footer").style.display = "none";
  document.getElementById("preview-text").textContent =
    text.length > 200 ? text.slice(0, 200) + "…" : text;
  document.getElementById("results-container").innerHTML = "";

  const total = dbPapers.length;
  let step = 0;
  let errors = 0;
  const allResults = [];

  for (const row of dbPapers) {
    if (stopRequested) break;

    const pct = Math.round((step / total) * 100);
    document.getElementById("progress-fill").style.width = pct + "%";
    document.getElementById("progress-label").textContent =
      `Checking ${step + 1} of ${total}…`;
    document.getElementById("progress-sub").textContent = (
      row.title || ""
    ).slice(0, 60);

    const findingsText = [
      ...(row.findings?.findings || []),
      ...(row.findings?.keyArguments || []),
      ...(row.findings?.citationUses || []),
      row.findings?.methodology || "",
      row.findings?.studyContext
        ? `Study context: ${row.findings.studyContext}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    if (!findingsText.trim()) {
      step++;
      continue;
    }

    const prompt = `You are a research assistant helping an academic find citation support. Using the extracted findings below, evaluate how well this paper supports the input text.

PAPER: "${row.title}" (${(row.authors || []).join(", ")}, ${row.year})

EXTRACTED FINDINGS:
${findingsText}

TEXT TO SUPPORT:
${text}

SCORING RULES:
- Score 8-10: Paper directly supports one or more complete sentences with matching evidence. Score even higher (9-10) if it supports multiple consecutive sentences.
- Score 6-7: Paper supports the theme or underlying idea of a full sentence, even if framed differently
- Score 4-5: Paper provides relevant background or partial evidence for a sentence
- Score 2-3: Paper is topically related and could be cited as context
- Score 0-1: Paper is genuinely unrelated

MATCHING RULES — critical:
- Each "sentence" field must be a COMPLETE sentence copied verbatim from the input text. Never use fragments or partial phrases.
- If multiple consecutive sentences are all supported by this paper, combine them into one match entry and give a higher score.
- Only include a sentence if the paper meaningfully supports it. Skip sentences the paper does not address.

Return ONLY this JSON:
{
  "overallScore": <0-10>,
  "keyFindings": ["finding 1", "finding 2", "finding 3"],
  "sentenceMatches": [
    { "sentence": "<complete sentence(s) copied verbatim from input>", "score": <0-10>, "citationNote": "<how this paper supports this sentence>" }
  ]
}`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: CONFIG.MODEL,
          max_tokens: CONFIG.MAX_TOKENS,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!res.ok) {
        errors++;
        step++;
        continue;
      }

      const data = await res.json();
      const txt = data.content?.map((c) => c.text || "").join("") || "";
      const jsonMatch = txt.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        step++;
        continue;
      }

      let parsed;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        step++;
        continue;
      }

      if (parsed.overallScore >= CONFIG.MIN_SCORE) {
        allResults.push({
          row,
          relevanceScore: parsed.overallScore,
          keyFindings: parsed.keyFindings || [],
          sentenceMatches: parsed.sentenceMatches || [],
        });
        allResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
        renderResults(allResults);
      }
    } catch (e) {
      errors++;
    }

    step++;
  }

  // Done
  const wasStopped = stopRequested;
  document.getElementById("progress-fill").style.width = "100%";
  document.getElementById("progress-label").textContent = wasStopped
    ? "Stopped"
    : "Complete";
  const summary =
    `${allResults.length} relevant papers found` +
    (wasStopped ? ` · stopped at ${step}/${total}` : "") +
    (errors > 0 ? ` · ${errors} errors` : "");
  document.getElementById("progress-sub").textContent = summary;

  setTimeout(() => {
    document.getElementById("progress-box").style.display = "none";
  }, 2000);

  document.getElementById("footer").style.display = "block";
  document.getElementById("footer-text").textContent =
    `${allResults.length} results · ${step} of ${total} searched` +
    (errors > 0 ? ` · ${errors} failed` : "");

  if (allResults.length === 0 && !wasStopped) {
    document.getElementById("results-container").innerHTML = `
      <div style="text-align:center;padding:30px 16px;color:#a0aec0;font-size:12px;line-height:1.7;">
        No strong matches found.<br>Try uploading more PDFs to your RefCheck library.
      </div>`;
  }

  isRunning = false;
  stopRequested = false;

  // If new text arrived while we were running, show it now
  if (pendingTextForAnalysis) {
    showPendingText(pendingTextForAnalysis);
  }
}

// ── Render results (XSS-safe) ────────────────────────────────────────────────
function renderResults(results) {
  const container = document.getElementById("results-container");
  container.innerHTML = "";

  results.forEach((r, idx) => {
    const authors = r.row.authors || [];
    const firstAuth = authors.length > 0 ? authors[0].split(" ").pop() : "";
    const citeRef = `@${firstAuth}${authors.length > 1 ? " et al." : ""} — ${r.row.year} — ${r.row.title}`;

    const card = document.createElement("div");
    card.className = "result-card";
    card.style.borderLeft = `4px solid ${SC(r.relevanceScore)}`;

    // ── Header ──────────────────────────────────────────────────────────────
    const header = document.createElement("div");
    header.className = "result-header";
    header.innerHTML = `
      <div class="score-wrap">
        <div class="score-box" style="background:${SBg(r.relevanceScore)};border:1px solid ${SBo(r.relevanceScore)};color:${SC(r.relevanceScore)}">
          ${r.relevanceScore}
        </div>
        <div class="score-label" style="color:${SC(r.relevanceScore)}">${SL(r.relevanceScore)}</div>
      </div>
      <div class="result-meta">
        <div class="result-title">
          ${esc(r.row.title)}
          <span class="source-badge" style="background:${r.row.source === "pdf" ? "#f0fff4" : "#ebf4ff"};color:${r.row.source === "pdf" ? "#276749" : "#2b6cb0"};border:1px solid ${r.row.source === "pdf" ? "#9ae6b4" : "#90cdf4"}">
            ${r.row.source === "pdf" ? "FULL" : "ABS"}
          </span>
        </div>
        <div class="result-authors">${esc(authors.join(", "))} · ${esc(String(r.row.year))}</div>
        <span class="cite-badge" title="${esc(citeRef)}">${esc(citeRef)}</span>
        <div class="result-finding">${esc(r.keyFindings?.[0] || "")}</div>
      </div>
      <div class="chevron">▼</div>
    `;

    header.addEventListener("click", () => {
      const body = card.querySelector(".result-expanded");
      if (expanded === idx) {
        expanded = null;
        body.style.display = "none";
        header.querySelector(".chevron").textContent = "▼";
      } else {
        container
          .querySelectorAll(".result-expanded")
          .forEach((el) => (el.style.display = "none"));
        container
          .querySelectorAll(".chevron")
          .forEach((el) => (el.textContent = "▼"));
        expanded = idx;
        body.style.display = "block";
        header.querySelector(".chevron").textContent = "▲";
      }
    });

    // ── Expanded body ────────────────────────────────────────────────────────
    const body = document.createElement("div");
    body.className = "result-expanded";
    body.style.display = "none";

    // Key findings
    const findings = (r.keyFindings || []).filter(Boolean);
    if (findings.length > 0) {
      let html = `<span class="section-label" style="color:#2b6cb0;">Key Findings</span>`;
      findings.forEach((f) => {
        html += `<div class="finding-item">
          <span class="finding-dot">·</span>
          <span class="finding-text">${esc(f)}</span>
        </div>`;
      });
      body.innerHTML += html;
    }

    // Sentence matches
    const matches = (r.sentenceMatches || [])
      .filter((m) => m.score >= 3)
      .sort((a, b) => b.score - a.score);

    if (matches.length > 0) {
      body.innerHTML += `<span class="section-label" style="color:#276749;">Matches</span>`;
      matches.forEach((m, mi) => {
        body.innerHTML += `
          <div class="match-card" style="background:${SBg(m.score)};border:1px solid ${SBo(m.score)}">
            <span class="match-score-badge" style="background:${SBg(m.score)};color:${SC(m.score)};border:1px solid ${SBo(m.score)}">${m.score}/10</span>
            <div class="match-sentence">"${esc(m.sentence)}"</div>
            <div class="match-note">${esc(m.citationNote)}</div>
            <div class="find-evidence-container" data-ridx="${idx}" data-midx="${mi}" style="margin-top:6px;"></div>
          </div>`;
      });
    }

    // Actions row
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "card-actions";
    if (r.row.url) {
      const link = document.createElement("a");
      link.className = "open-link";
      link.href = r.row.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "→ Open paper ↗";
      actionsDiv.appendChild(link);
    }
    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.dataset.key = r.row.citation_key;
    copyBtn.textContent = "📋 Copy \\cite{}";
    copyBtn.addEventListener("click", (e) => {
      const key = e.target.dataset.key;
      navigator.clipboard.writeText(`\\cite{${key}}`).then(() => {
        e.target.textContent = "✓ Copied!";
        setTimeout(() => {
          e.target.textContent = "📋 Copy \\cite{}";
        }, 1500);
      });
    });
    actionsDiv.appendChild(copyBtn);
    body.appendChild(actionsDiv);

    // Wire up "Find in Paper" buttons
    body.querySelectorAll(".find-evidence-container").forEach((container) => {
      const rIdx = parseInt(container.dataset.ridx);
      const mIdx = parseInt(container.dataset.midx);
      const match = results[rIdx].sentenceMatches.filter((m) => m.score >= 3).sort((a, b) => b.score - a.score)[mIdx];
      const row = results[rIdx].row;

      const findBtn = document.createElement("button");
      findBtn.textContent = "🔍 Find in Paper";
      Object.assign(findBtn.style, {
        fontSize: "10px", padding: "4px 10px", background: "#ebf4ff",
        color: "#2b6cb0", border: "1px solid #90cdf4", borderRadius: "4px",
        cursor: "pointer", fontFamily: "inherit", fontWeight: "600",
      });
      findBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        findBtn.disabled = true;
        findBtn.textContent = "Searching…";
        try {
          const phrases = await findExactPhrases(row, match);
          renderFoundPhrases(container, phrases);
        } catch (err) {
          container.innerHTML = `<div style="font-size:11px;color:#c53030;margin-top:4px;">Failed: ${esc(err.message)}</div>`;
        }
      });
      container.appendChild(findBtn);
    });

    card.appendChild(header);
    card.appendChild(body);
    container.appendChild(card);
  });
}

// ── Find exact phrases from paper via Claude ────────────────────────────────
async function findExactPhrases(row, match) {
  const verbatimQuotes = (row.findings?.verbatimQuotes || []).filter(Boolean);
  const hasVerbatim = verbatimQuotes.length > 0;

  const summaryText = [
    ...(row.findings?.findings || []),
    ...(row.findings?.keyArguments || []),
    ...(row.findings?.citationUses || []),
    row.findings?.methodology || "",
  ]
    .filter(Boolean)
    .join("\n\n");

  let prompt;

  if (hasVerbatim) {
    // Papers with verbatim quotes — Claude picks from real text
    const quotesBlock = verbatimQuotes
      .map((q, i) => `[${i + 1}] "${q}"`)
      .join("\n");

    prompt = `You have EXACT VERBATIM QUOTES extracted from an academic paper, plus a summary of findings. A user wants to Ctrl+F in the PDF to find relevant sections.

PAPER: "${row.title}" (${(row.authors || []).join(", ")}, ${row.year})

VERBATIM QUOTES FROM THE PAPER (these appear exactly in the PDF):
${quotesBlock}

SUMMARY OF FINDINGS:
${summaryText}

THE USER'S TEXT BEING SUPPORTED:
"${match.sentence}"

HOW THE PAPER SUPPORTS IT:
${match.citationNote}

YOUR TASK: Pick the 2-3 most relevant VERBATIM QUOTES above that relate to this match. Return them as COMPLETE, READABLE sentences — do NOT shorten or fragment them. Copy them exactly as they appear above. The user will read these to understand the evidence and also use them for Ctrl+F in the PDF.

Return ONLY this JSON — no other text:
{ "phrases": ["full verbatim sentence 1", "full verbatim sentence 2"], "confidence": "high" }`;
  } else {
    // Papers without verbatim quotes — best effort from summaries
    prompt = `You have SUMMARIZED findings from an academic paper (not verbatim text). A user wants to Ctrl+F in the PDF to find relevant sections. Since these are summaries, focus on specific technical terms, proper nouns, statistics, method names, and distinctive jargon that the authors almost certainly used verbatim.

PAPER: "${row.title}" (${(row.authors || []).join(", ")}, ${row.year})

SUMMARIZED FINDINGS (not exact quotes):
${summaryText}

THE USER'S TEXT BEING SUPPORTED:
"${match.sentence}"

HOW THE PAPER SUPPORTS IT:
${match.citationNote}

YOUR TASK: Identify 3-4 SHORT search terms (2-8 words) that are most likely to appear verbatim in the original paper. Focus on:
- Specific numbers, percentages, or statistics mentioned (e.g. "63% of", "N=42")
- Technical method names (e.g. "structural equation modeling", "thematic analysis")
- Distinctive compound terms or jargon (e.g. "privacy fatigue", "selective disclosure")
- Named frameworks, scales, or theories (e.g. "Technology Acceptance Model", "System Usability Scale")
- Proper nouns (country names, tool names, author names referenced)

Do NOT generate full sentences — keep phrases short and specific.

Return ONLY this JSON — no other text:
{ "phrases": ["search term 1", "search term 2", "search term 3", "search term 4"], "confidence": "low" }`;
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: CONFIG.MODEL,
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  const txt = data.content?.map((c) => c.text || "").join("") || "";
  const jsonMatch = txt.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON in response");
  const parsed = JSON.parse(jsonMatch[0]);
  return {
    phrases: parsed.phrases || [],
    confidence: parsed.confidence || (hasVerbatim ? "high" : "low"),
  };
}

function renderFoundPhrases(container, result) {
  const { phrases, confidence } = result;
  const isHigh = confidence === "high";
  const borderColor = isHigh ? "#9ae6b4" : "#fbd38d";
  const labelColor = isHigh ? "#276749" : "#b7791f";
  const labelText = isHigh
    ? "Search phrases — from paper text"
    : "Search phrases — approximate (re-sync paper for exact matches)";

  let html = `<div style="padding:6px 9px;background:rgba(255,255,255,0.6);border-left:3px solid ${borderColor};border-radius:0 4px 4px 0;font-size:11px;color:#2d3748;line-height:1.6;">
    <span style="font-size:9px;font-weight:600;color:${labelColor};text-transform:uppercase;letter-spacing:0.05em;">${labelText}</span>`;
  phrases.forEach((phrase) => {
    html += `<div class="phrase-copy" data-phrase="${esc(phrase)}" style="margin-top:4px;padding:4px 8px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:4px;cursor:pointer;font-family:monospace;font-size:11px;display:flex;justify-content:space-between;align-items:center;">
      <span>${esc(phrase)}</span>
      <span style="font-size:9px;color:#2b6cb0;margin-left:8px;flex-shrink:0;">copy</span>
    </div>`;
  });
  html += `</div>`;
  container.innerHTML = html;

  container.querySelectorAll(".phrase-copy").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(el.dataset.phrase).then(() => {
        el.querySelector("span:last-child").textContent = "✓";
        setTimeout(() => {
          el.querySelector("span:last-child").textContent = "copy";
        }, 1500);
      });
    });
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────
init();
