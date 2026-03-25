// ── RefCheck Options — Zotero Sync ────────────────────────────────────────────

const ZOTERO = "https://api.zotero.org";
let stopRequested = false;
let skipRequested = false;
let loadedCollections = []; // { key, name, libType, libId, count }
let projects = []; // [{ id, name }] from Supabase projects table

// ── HTML escape helper (prevents XSS) ────────────────────────────────────────
function esc(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ── Load Supabase key from storage ───────────────────────────────────────────
async function loadSupabaseKey() {
  const stored = await chrome.storage.local.get("refcheck_supabase_key");
  if (stored.refcheck_supabase_key) {
    CONFIG.SUPABASE_KEY = stored.refcheck_supabase_key;
  }
}

// ── Project Management (reads from Supabase projects table) ─────────────────
async function loadProjects() {
  if (!CONFIG.SUPABASE_KEY) {
    projects = [{ id: "default", name: "Default Library" }];
    renderProjectDropdown();
    renderProjectManageList();
    return;
  }
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
      projects = data; // [{ id, name, created_at }]
    } else {
      projects = [{ id: "default", name: "Default Library" }];
    }
  } catch (e) {
    projects = [{ id: "default", name: "Default Library" }];
  }
  renderProjectDropdown();
  renderProjectManageList();
}

// Returns the project ID used for filtering papers
function getSelectedProject() {
  const select = document.getElementById("project-select");
  return select?.value || "default";
}

function renderProjectDropdown() {
  const select = document.getElementById("project-select");
  const prev = select.value;
  select.innerHTML = "";
  projects.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  });
  if (prev && projects.some((p) => p.id === prev)) select.value = prev;
}

function renderProjectManageList() {
  const container = document.getElementById("project-list-manage");
  if (projects.length <= 1) {
    container.innerHTML = "";
    return;
  }
  let html =
    '<div style="font-size:11px;font-weight:600;color:#718096;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Your Projects</div>';
  projects.forEach((p, i) => {
    html += `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f0f4f8;">
      <span style="font-size:13px;font-weight:500;color:#1a202c;flex:1;">${esc(p.name)}</span>
      <span style="font-size:11px;color:#718096;font-family:monospace;">${esc(p.id)}</span>
      ${i === 0 ? '<span class="badge badge-gray" style="font-size:10px;">default</span>' : `<button class="btn btn-danger remove-project-btn" data-id="${esc(p.id)}" style="font-size:10px;padding:3px 8px;">Remove</button>`}
    </div>`;
  });
  container.innerHTML = html;

  container.querySelectorAll(".remove-project-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const proj = projects.find((p) => p.id === id);
      if (
        !confirm(
          `Remove project "${proj?.name}"?\n\nPapers in this project will NOT be deleted — they will still exist in Supabase. You can re-create the project to see them again.`,
        )
      )
        return;
      // Delete from Supabase projects table
      await fetch(
        `${CONFIG.SUPABASE_URL}/rest/v1/projects?id=eq.${encodeURIComponent(id)}`,
        {
          method: "DELETE",
          headers: {
            apikey: CONFIG.SUPABASE_KEY,
            Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
          },
        },
      );
      await loadProjects();
      renderDbList();
    });
  });
}

document
  .getElementById("add-project-btn")
  .addEventListener("click", async () => {
    const name = document.getElementById("new-project-name").value.trim();
    if (!name) {
      alert("Enter a project name.");
      return;
    }
    if (name.length > 60) {
      alert("Project name must be 60 characters or less.");
      return;
    }
    // Generate ID from name: lowercase, replace spaces/special chars with hyphens
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!id) {
      alert("Invalid project name.");
      return;
    }
    if (projects.some((p) => p.id === id)) {
      alert("A project with this ID already exists.");
      return;
    }
    // Insert into Supabase projects table
    const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/projects`, {
      method: "POST",
      headers: {
        apikey: CONFIG.SUPABASE_KEY,
        Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ id, name }),
    });
    if (!res.ok) {
      alert("Failed to create project: " + (await res.text()));
      return;
    }
    document.getElementById("new-project-name").value = "";
    await loadProjects();
    // Select the newly created project
    document.getElementById("project-select").value = id;
    renderDbList();
  });

// Refresh library when project changes
document.getElementById("project-select").addEventListener("change", () => {
  const proj = projects.find((p) => p.id === getSelectedProject());
  document.getElementById("db-library-title").textContent =
    `Project Library — ${proj?.name || getSelectedProject()}`;
  renderDbList();
});

// ── Load saved state ──────────────────────────────────────────────────────────
async function loadCreds() {
  const s = await chrome.storage.local.get([
    "zotero_user_id",
    "zotero_api_key",
    "zotero_group_id",
  ]);
  if (s.zotero_api_key) {
    document.getElementById("zotero-api-key").value = s.zotero_api_key;
  }
  if (s.zotero_user_id) {
    document.getElementById("zotero-user-id").value = s.zotero_user_id;
    document.getElementById("user-id-field").style.display = "block";
  }
  if (s.zotero_group_id) {
    document.getElementById("zotero-group-id").value = s.zotero_group_id;
  }
  // Re-load collections if credentials exist
  if (s.zotero_api_key && s.zotero_user_id) {
    await loadCollections(
      s.zotero_user_id,
      s.zotero_api_key,
      s.zotero_group_id || "",
    );
  }
}

// ── Verify API key → auto-fetch numeric User ID ───────────────────────────────
document.getElementById("verify-btn").addEventListener("click", async () => {
  const apiKey = document.getElementById("zotero-api-key").value.trim();
  if (!apiKey) {
    showStatus("Enter your API key first.", "red");
    return;
  }

  const btn = document.getElementById("verify-btn");
  btn.disabled = true;
  btn.textContent = "Verifying…";

  try {
    const res = await fetch(`${ZOTERO}/keys/${apiKey}`, {
      headers: { "Zotero-API-Key": apiKey },
    });
    if (!res.ok) throw new Error(`Invalid API key (${res.status})`);
    const data = await res.json();
    const userId = String(data.userID);

    document.getElementById("zotero-user-id").value = userId;
    document.getElementById("user-id-field").style.display = "block";

    await chrome.storage.local.set({
      zotero_api_key: apiKey,
      zotero_user_id: userId,
    });
    showStatus(`✓ Verified — User ID: ${userId}`, "green");

    const groupId = document.getElementById("zotero-group-id").value.trim();
    await loadCollections(userId, apiKey, groupId);
  } catch (e) {
    showStatus("✗ " + e.message, "red");
  } finally {
    btn.disabled = false;
    btn.textContent = "Verify & Load →";
  }
});

// ── Load group collections ────────────────────────────────────────────────────
document
  .getElementById("load-group-btn")
  .addEventListener("click", async () => {
    const apiKey = document.getElementById("zotero-api-key").value.trim();
    const userId = document.getElementById("zotero-user-id").value.trim();
    const groupId = document.getElementById("zotero-group-id").value.trim();
    if (!apiKey || !userId) {
      showStatus("Verify your API key first.", "red");
      return;
    }
    if (!groupId) {
      showStatus("Enter a Group ID.", "red");
      return;
    }
    await chrome.storage.local.set({ zotero_group_id: groupId });
    await loadCollections(userId, apiKey, groupId);
  });

// ── Fetch & render collections ────────────────────────────────────────────────
async function fetchCollections(libType, libId, apiKey) {
  const res = await fetch(
    `${ZOTERO}/${libType}/${libId}/collections?format=json&limit=100`,
    {
      headers: { "Zotero-API-Key": apiKey },
    },
  );
  if (!res.ok) throw new Error(`Collections fetch failed (${res.status})`);
  return await res.json();
}

async function loadCollections(userId, apiKey, groupId) {
  loadedCollections = [];
  const card = document.getElementById("collections-card");
  const list = document.getElementById("collections-list");
  list.innerHTML = `<div style="padding:14px;color:#718096;font-size:13px;">Loading collections…</div>`;
  card.style.display = "block";

  try {
    const personal = await fetchCollections("users", userId, apiKey);
    personal.forEach((c) => {
      loadedCollections.push({
        key: c.key,
        name: c.data.name,
        libType: "users",
        libId: userId,
        source: "Personal Library",
        numItems: c.meta?.numItems || 0,
      });
    });

    if (groupId) {
      try {
        const group = await fetchCollections("groups", groupId, apiKey);
        group.forEach((c) => {
          loadedCollections.push({
            key: c.key,
            name: c.data.name,
            libType: "groups",
            libId: groupId,
            source: "Group Library",
            numItems: c.meta?.numItems || 0,
          });
        });
      } catch (e) {
        showStatus("Group collections failed: " + e.message, "red");
      }
    }

    renderCollectionsList();
  } catch (e) {
    list.innerHTML = `<div style="padding:14px;color:#c53030;font-size:13px;">Error: ${esc(e.message)}</div>`;
  }
}

function renderCollectionsList() {
  const list = document.getElementById("collections-list");
  list.innerHTML = "";

  if (loadedCollections.length === 0) {
    list.innerHTML = `<div style="padding:14px;color:#718096;font-size:13px;">No collections found.</div>`;
    return;
  }

  const groups = {};
  loadedCollections.forEach((c) => {
    if (!groups[c.source]) groups[c.source] = [];
    groups[c.source].push(c);
  });

  Object.entries(groups).forEach(([source, colls]) => {
    const header = document.createElement("div");
    header.className = "coll-group-header";
    header.textContent = source;
    list.appendChild(header);

    colls.forEach((c) => {
      const row = document.createElement("label");
      row.className = "coll-item";
      row.innerHTML = `
        <input type="checkbox" class="coll-check" data-idx="${loadedCollections.indexOf(c)}" />
        <span class="coll-name">${esc(c.name)}</span>
        <span class="coll-count">${c.numItems} items</span>
      `;
      list.appendChild(row);
    });
  });
}

document.getElementById("check-all-btn").addEventListener("click", () => {
  document.querySelectorAll(".coll-check").forEach((cb) => (cb.checked = true));
});
document.getElementById("uncheck-all-btn").addEventListener("click", () => {
  document
    .querySelectorAll(".coll-check")
    .forEach((cb) => (cb.checked = false));
});

// ── Zotero API helpers ────────────────────────────────────────────────────────
async function fetchItemsFromCollection(libType, libId, collKey, apiKey) {
  const items = [];
  let start = 0;
  while (true) {
    const url = `${ZOTERO}/${libType}/${libId}/collections/${collKey}/items/top?format=json&limit=100&start=${start}`;
    const res = await fetch(url, { headers: { "Zotero-API-Key": apiKey } });
    if (!res.ok) throw new Error(`Zotero API error: ${res.status}`);
    const batch = await res.json();
    items.push(...batch);
    const total = parseInt(res.headers.get("Total-Results") || "0");
    start += 100;
    if (start >= total || batch.length === 0) break;
  }
  return items;
}

async function fetchAllItems(libType, libId, apiKey) {
  const items = [];
  let start = 0;
  while (true) {
    const url = `${ZOTERO}/${libType}/${libId}/items/top?format=json&limit=100&start=${start}`;
    const res = await fetch(url, { headers: { "Zotero-API-Key": apiKey } });
    if (!res.ok)
      throw new Error(
        `Zotero API error: ${res.status} — make sure your User ID is numeric (found on zotero.org/settings/keys)`,
      );
    const batch = await res.json();
    items.push(...batch);
    const total = parseInt(res.headers.get("Total-Results") || "0");
    start += 100;
    if (start >= total || batch.length === 0) break;
  }
  return items;
}

async function getChildren(libType, libId, itemKey, apiKey) {
  const url = `${ZOTERO}/${libType}/${libId}/items/${itemKey}/children?format=json`;
  const res = await fetch(url, { headers: { "Zotero-API-Key": apiKey } });
  if (!res.ok) return [];
  return await res.json();
}

async function downloadPdfBase64(libType, libId, attachKey, apiKey) {
  const url = `${ZOTERO}/${libType}/${libId}/items/${attachKey}/file`;
  const res = await fetch(url, {
    headers: { "Zotero-API-Key": apiKey },
    redirect: "follow",
  });
  if (!res.ok) return null;
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function parseCitationKey(extra) {
  const m = (extra || "").match(/Citation Key:\s*(\S+)/i);
  return m ? m[1] : null;
}

function generateCitationKey(item) {
  const author = (item.data.creators?.[0]?.lastName || "unknown")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  const year = (item.data.date || "").match(/\d{4}/)?.[0] || "xxxx";
  const word =
    (item.data.title || "")
      .split(/\s+/)
      .find((w) => w.length > 4)
      ?.toLowerCase()
      .replace(/[^a-z]/g, "") || "untitled";
  return `${author}${year}${word}`;
}

// ── Claude with retry on rate limit ──────────────────────────────────────────
async function claudeWithRetry(body, anthropicKey, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429 || res.status === 529) {
      const retryAfter = res.headers.get("retry-after");
      const waitSec = retryAfter
        ? parseInt(retryAfter)
        : Math.min(30 * attempt, 120);
      document.getElementById("progress-sub").textContent =
        `Rate limited — waiting ${waitSec}s before retry ${attempt}/${maxRetries}…`;
      await new Promise((r) => setTimeout(r, waitSec * 1000));
      continue;
    }

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error?.message || `HTTP ${res.status}`);
    }
    return await res.json();
  }
  throw new Error("Rate limit exceeded after all retries. Try again later.");
}

// ── Claude extraction ─────────────────────────────────────────────────────────
async function extractFromPdf(base64, paper, anthropicKey) {
  const prompt = `You are a research assistant. Read this full academic paper and extract its core content for future citation matching.

CRITICAL: The "verbatimQuotes" field must contain EXACT sentences or phrases copied character-for-character from the paper. These will be used for Ctrl+F search in the PDF. Do NOT paraphrase or summarize — copy the text exactly as it appears, preserving original wording, punctuation, and spelling.

PRIORITY for verbatimQuotes: Focus heavily on the RESULTS and DISCUSSION sections. These contain the paper's actual evidence — specific data points, statistical findings, key outcomes, and interpretive claims. Also include 1-2 quotes from the abstract or conclusion that state the paper's main contribution. Avoid generic methodology descriptions or literature review sentences.

Return ONLY this JSON object — no other text:
{
  "findings": [
    "Detailed finding or argument 1 (2-3 sentences)",
    "Detailed finding or argument 2 (2-3 sentences)",
    "Detailed finding or argument 3 (2-3 sentences)",
    "Detailed finding or argument 4 (2-3 sentences)",
    "Detailed finding or argument 5 (2-3 sentences)"
  ],
  "verbatimQuotes": [
    "Exact sentence from RESULTS section stating a key quantitative or qualitative finding",
    "Another exact sentence from RESULTS with specific data, statistics, or outcomes",
    "Exact sentence from RESULTS or DISCUSSION with an important interpretive claim",
    "Exact sentence from DISCUSSION stating a key implication or contribution",
    "Exact sentence from RESULTS with another significant finding or comparison",
    "Exact sentence from ABSTRACT or CONCLUSION stating the paper's main claim",
    "Another exact sentence from RESULTS with supporting evidence"
  ],
  "methodology": "Brief description of study design, participants, methods used",
  "keyArguments": [
    "Core theoretical or empirical argument 1",
    "Core theoretical or empirical argument 2",
    "Core theoretical or empirical argument 3"
  ],
  "citationUses": [
    "This paper can be cited to support claims about X",
    "This paper can be cited to support claims about Y",
    "This paper can be cited to support claims about Z"
  ],
  "studyContext": "Country or region where study participants were located (e.g. 'Germany', 'United States', 'Indonesia'). If no participants — conceptual paper, literature review, or theoretical framework — write 'Conceptual'."
}`;

  const data = await claudeWithRetry(
    {
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2500,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64,
              },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    },
    anthropicKey,
  );
  const txt = data.content?.map((c) => c.text || "").join("") || "";
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON in Claude response");
  return JSON.parse(m[0]);
}

async function extractFromAbstract(abstract, paper, anthropicKey) {
  const prompt = `You are a research assistant. Based on this paper's abstract, extract its core content for citation matching.

CRITICAL: The "verbatimQuotes" field must contain EXACT phrases copied character-for-character from the abstract. These will be used for Ctrl+F search. Do NOT paraphrase — copy the text exactly as written.

PAPER: "${paper.title}" (${paper.authors.join(", ")}, ${paper.year})
ABSTRACT: ${abstract}

Return ONLY this JSON object:
{
  "findings": ["Key finding 1", "Key finding 2", "Key finding 3"],
  "verbatimQuotes": ["Exact sentence from the abstract", "Another exact sentence from the abstract", "Another exact sentence from the abstract"],
  "methodology": "Brief description of methods if mentioned",
  "keyArguments": ["Core argument 1", "Core argument 2"],
  "citationUses": ["Can cite to support claims about X", "Can cite to support claims about Y"]
}`;

  const data = await claudeWithRetry(
    {
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    },
    anthropicKey,
  );
  const txt = data.content?.map((c) => c.text || "").join("") || "";
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON in Claude response");
  return JSON.parse(m[0]);
}

// ── Supabase helpers ──────────────────────────────────────────────────────────
async function fetchDbPapers() {
  const project = getSelectedProject();
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
    console.error("Supabase returned non-array — the 'project' column may not exist yet:", data);
    // Fallback: fetch all papers without project filter
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
    return Array.isArray(fallbackData) ? fallbackData : [];
  }
  return data;
}

async function fetchAllDbPapers() {
  const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/papers?select=*`, {
    headers: {
      apikey: CONFIG.SUPABASE_KEY,
      Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
    },
  });
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function upsertPaper(paper, findings, source) {
  const project = getSelectedProject();
  const res = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/papers`, {
    method: "POST",
    headers: {
      apikey: CONFIG.SUPABASE_KEY,
      Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      citation_key: paper.citationKey,
      title: paper.title,
      authors: paper.authors,
      year: paper.year,
      url: paper.url || "",
      findings,
      source,
      project,
      extracted_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) throw new Error(await res.text());
}

async function movePaper(citationKey, newProject) {
  const res = await fetch(
    `${CONFIG.SUPABASE_URL}/rest/v1/papers?citation_key=eq.${encodeURIComponent(citationKey)}`,
    {
      method: "PATCH",
      headers: {
        apikey: CONFIG.SUPABASE_KEY,
        Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ project: newProject }),
    },
  );
  if (!res.ok) throw new Error(await res.text());
}

async function deletePaper(citationKey) {
  await fetch(
    `${CONFIG.SUPABASE_URL}/rest/v1/papers?citation_key=eq.${encodeURIComponent(citationKey)}`,
    {
      method: "DELETE",
      headers: {
        apikey: CONFIG.SUPABASE_KEY,
        Authorization: `Bearer ${CONFIG.SUPABASE_KEY}`,
      },
    },
  );
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function showStatus(msg, color) {
  const el = document.getElementById("creds-status");
  el.textContent = msg;
  el.style.color = color === "green" ? "#276749" : "#c53030";
}

function setProgress(label, pct, sub) {
  document.getElementById("progress-wrap").style.display = "block";
  document.getElementById("progress-label").textContent = label;
  document.getElementById("progress-pct").textContent = pct + "%";
  document.getElementById("progress-fill").style.width = pct + "%";
  document.getElementById("progress-sub").textContent = sub || "";
}

function addLogRow(title, meta, status, type) {
  const tbody = document.getElementById("log-body");
  document.getElementById("log-wrap").style.display = "block";
  const badgeMap = {
    pdf: { cls: "badge-green", label: "FULL PDF" },
    abstract: { cls: "badge-blue", label: "ABSTRACT" },
    skip: { cls: "badge-gray", label: "—" },
    error: { cls: "badge-red", label: "ERROR" },
  };
  const statusMap = {
    pdf: { cls: "badge-green", label: "Extracted ✓" },
    abstract: { cls: "badge-blue", label: "Abstract ✓" },
    skip: { cls: "badge-gray", label: status },
    error: { cls: "badge-red", label: status },
  };
  const src = badgeMap[type] || badgeMap.skip;
  const st = statusMap[type] || statusMap.skip;
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><div class="log-title">${esc(title)}</div><div class="log-meta">${esc(meta)}</div></td>
    <td><span class="badge ${src.cls}">${src.label}</span></td>
    <td><span class="badge ${st.cls}">${st.label}</span></td>`;
  tbody.prepend(tr);
}

function updateLogSummary(done, skipped, failed, of) {
  document.getElementById("log-summary").textContent =
    `${done} extracted · ${skipped} skipped · ${failed} failed · ${of} processed`;
}

// ── Process a single Zotero item ──────────────────────────────────────────────
async function processItem(
  item,
  libType,
  libId,
  userId,
  apiKey,
  anthropicKey,
  existingPdf,
  existingAll,
) {
  const d = item.data;
  const citationKey = parseCitationKey(d.extra) || generateCitationKey(item);
  const title = d.title || citationKey;
  const authors = (d.creators || [])
    .filter((c) => c.creatorType === "author")
    .map((c) =>
      c.lastName ? `${c.lastName}, ${c.firstName || ""}`.trim() : c.name || "",
    )
    .filter(Boolean);
  const year = (d.date || "").match(/\d{4}/)?.[0] || "";
  const url = d.url || (d.DOI ? `https://doi.org/${d.DOI}` : "");
  const abstract = d.abstractNote || "";
  const paper = { citationKey, title, authors, year, url };
  const meta = `${authors[0] || ""} · ${year} · @${citationKey}`;

  const children = await getChildren(libType, libId, item.key, apiKey);
  const pdfAttach = children.find(
    (c) =>
      c.data?.itemType === "attachment" &&
      c.data?.contentType === "application/pdf" &&
      c.data?.linkMode !== "linked_url",
  );

  if (pdfAttach && !existingPdf.has(citationKey)) {
    const base64 = await downloadPdfBase64(
      libType,
      libId,
      pdfAttach.key,
      apiKey,
    );
    if (!base64) throw new Error("PDF download returned empty");
    const findings = await extractFromPdf(base64, paper, anthropicKey);
    await upsertPaper(paper, findings, "pdf");
    addLogRow(title, meta, "", "pdf");
    return "pdf";
  } else if (pdfAttach && existingPdf.has(citationKey)) {
    addLogRow(title, meta, "Already extracted (PDF)", "skip");
    return "skip";
  } else if (!existingAll.has(citationKey) && abstract) {
    const findings = await extractFromAbstract(abstract, paper, anthropicKey);
    await upsertPaper(paper, findings, "abstract");
    addLogRow(title, meta, "", "abstract");
    return "abstract";
  } else if (existingAll.has(citationKey)) {
    addLogRow(title, meta, "Already in DB", "skip");
    return "skip";
  } else {
    addLogRow(title, meta, "No PDF or abstract", "skip");
    return "skip";
  }
}

// ── Main sync ─────────────────────────────────────────────────────────────────
async function runSync() {
  const s = await chrome.storage.local.get([
    "zotero_user_id",
    "zotero_api_key",
    "zotero_group_id",
    "refcheck_apikey",
  ]);
  const userId = s.zotero_user_id?.trim();
  const zoteroKey = s.zotero_api_key?.trim();
  const groupId = s.zotero_group_id?.trim();
  const anthropicKey = s.refcheck_apikey?.trim() || CONFIG.ANTHROPIC_API_KEY;

  if (!userId || !zoteroKey) {
    alert("Click 'Verify & Load' to validate your API key first.");
    return;
  }

  stopRequested = false;
  skipRequested = false;
  document.getElementById("sync-btn").disabled = true;
  document.getElementById("stop-btn").style.display = "inline-block";
  document.getElementById("skip-btn").style.display = "inline-block";
  document.getElementById("log-body").innerHTML = "";
  document.getElementById("log-wrap").style.display = "none";

  let done = 0,
    skipped = 0,
    failed = 0;

  try {
    setProgress("Loading Supabase library…", 0, "");
    const existing = await fetchDbPapers();
    const existingPdf = new Set(
      existing.filter((p) => p.source === "pdf").map((p) => p.citation_key),
    );
    const existingAll = new Set(existing.map((p) => p.citation_key));

    const checkedBoxes = [...document.querySelectorAll(".coll-check:checked")];
    let allItems = [];

    const paperTypes = new Set([
      "journalArticle",
      "book",
      "bookSection",
      "conferencePaper",
      "report",
      "thesis",
      "preprint",
      "manuscript",
      "document",
    ]);

    if (checkedBoxes.length > 0) {
      for (const cb of checkedBoxes) {
        if (stopRequested) break;
        const coll = loadedCollections[parseInt(cb.dataset.idx)];
        setProgress(`Fetching collection: ${coll.name}…`, 2, "");
        const items = await fetchItemsFromCollection(
          coll.libType,
          coll.libId,
          coll.key,
          zoteroKey,
        );
        allItems.push(
          ...items
            .filter((it) => paperTypes.has(it.data.itemType))
            .map((it) => ({
              ...it,
              _libType: coll.libType,
              _libId: coll.libId,
            })),
        );
      }
      const seen = new Set();
      allItems = allItems.filter((it) =>
        seen.has(it.key) ? false : seen.add(it.key),
      );
    } else {
      setProgress("Fetching personal library…", 2, "");
      const personal = await fetchAllItems("users", userId, zoteroKey);
      personal
        .filter((it) => paperTypes.has(it.data.itemType))
        .forEach((it) =>
          allItems.push({ ...it, _libType: "users", _libId: userId }),
        );

      if (groupId) {
        setProgress("Fetching group library…", 5, "");
        const group = await fetchAllItems("groups", groupId, zoteroKey);
        group
          .filter((it) => paperTypes.has(it.data.itemType))
          .forEach((it) =>
            allItems.push({ ...it, _libType: "groups", _libId: groupId }),
          );
      }
    }

    document.getElementById("stat-zotero").textContent = allItems.length;
    const total = allItems.length;

    for (let i = 0; i < total; i++) {
      if (stopRequested) break;

      // Check if skip was requested for previous paper
      if (skipRequested) {
        skipRequested = false;
      }

      const item = allItems[i];
      const pct = Math.round(((i + 1) / total) * 100);
      setProgress(
        `Processing ${i + 1} of ${total}…`,
        pct,
        (item.data.title || "").slice(0, 70),
      );

      try {
        // Wrap processItem in a race with skip detection
        const result = await Promise.race([
          processItem(
            item,
            item._libType,
            item._libId,
            userId,
            zoteroKey,
            anthropicKey,
            existingPdf,
            existingAll,
          ),
          new Promise((resolve) => {
            const check = setInterval(() => {
              if (skipRequested || stopRequested) {
                clearInterval(check);
                resolve("skipped");
              }
            }, 200);
            // Clean up interval when processItem finishes first
            setTimeout(() => clearInterval(check), 300000);
          }),
        ]);

        if (result === "skipped" || skipRequested) {
          skipRequested = false;
          const title = item.data.title || item.key;
          const cKey = parseCitationKey(item.data.extra) || generateCitationKey(item);
          addLogRow(title, `@${cKey}`, "Skipped by user", "skip");
          skipped++;
        } else if (result === "pdf" || result === "abstract") {
          done++;
        } else {
          skipped++;
        }
      } catch (e) {
        console.error(e);
        addLogRow(
          item.data.title || item.key,
          `@${parseCitationKey(item.data.extra) || item.key}`,
          `Error: ${e.message?.slice(0, 60) || "Unknown"}`,
          "error",
        );
        failed++;
      }

      updateLogSummary(done, skipped, failed, i + 1);
      await new Promise((r) => setTimeout(r, 6000));
    }

    setProgress(
      stopRequested ? "Stopped." : "Sync complete ✓",
      100,
      `${done} extracted · ${skipped} skipped · ${failed} failed`,
    );
  } catch (e) {
    setProgress("Error: " + e.message, 0, "");
    console.error(e);
  }

  document.getElementById("sync-btn").disabled = false;
  document.getElementById("stop-btn").style.display = "none";
  document.getElementById("skip-btn").style.display = "none";
  await renderDbList();
}

// ── Render Project Library ──────────────────────────────────────────────────
async function renderDbList() {
  const papers = await fetchDbPapers();
  const full = papers.filter((p) => p.source === "pdf").length;
  const abs = papers.filter((p) => p.source !== "pdf").length;

  document.getElementById("stat-total").textContent = papers.length;
  document.getElementById("stat-full").textContent = full;
  document.getElementById("stat-abstract").textContent = abs;

  const container = document.getElementById("db-list");
  if (papers.length === 0) {
    container.innerHTML = `<div class="empty">No papers in this project yet. Run a sync to populate your library.</div>`;
    return;
  }

  // Build "Move to" options (all projects except current)
  const currentProjectId = getSelectedProject();
  const otherProjects = projects.filter((p) => p.id !== currentProjectId);

  container.innerHTML = `
    <table class="log-table">
      <thead><tr><th>Paper</th><th>Source</th><th>Extracted</th><th></th></tr></thead>
      <tbody id="db-tbody"></tbody>
    </table>`;

  const tbody = document.getElementById("db-tbody");
  papers.forEach((p) => {
    const tr = document.createElement("tr");
    const date = p.extracted_at
      ? new Date(p.extracted_at).toLocaleDateString()
      : "—";

    // Build move dropdown options
    let moveOpts = otherProjects
      .map((proj) => `<option value="${esc(proj.id)}">${esc(proj.name)}</option>`)
      .join("");

    tr.innerHTML = `
      <td>
        <div class="log-title">${esc(p.title || p.citation_key)}</div>
        <div class="log-meta">${esc((p.authors || []).join(", "))} · ${esc(p.year || "")}
          <span style="font-family:monospace;color:#2b6cb0;margin-left:6px">@${esc(p.citation_key)}</span>
        </div>
      </td>
      <td><span class="badge ${p.source === "pdf" ? "badge-green" : "badge-blue"}">
        ${p.source === "pdf" ? "FULL PDF" : "ABSTRACT"}
      </span></td>
      <td style="color:#718096;font-size:12px;">${esc(date)}</td>
      <td style="white-space:nowrap;">
        ${
          otherProjects.length > 0
            ? `<select class="move-select move-paper-select" data-key="${esc(p.citation_key)}">
                <option value="">Move to…</option>
                ${moveOpts}
              </select>`
            : ""
        }
        <button class="btn btn-danger delete-paper-btn" data-key="${esc(p.citation_key)}" style="margin-left:4px;">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  });

  // Wire up move dropdowns
  tbody.querySelectorAll(".move-paper-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const targetProject = sel.value;
      if (!targetProject) return;
      const key = sel.dataset.key;
      sel.disabled = true;
      try {
        await movePaper(key, targetProject);
        await renderDbList();
      } catch (e) {
        alert("Move failed: " + e.message);
        sel.disabled = false;
        sel.value = "";
      }
    });
  });

  // Wire up delete buttons
  tbody.querySelectorAll(".delete-paper-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(`Delete "${btn.dataset.key}" from Supabase?`)) return;
      btn.disabled = true;
      await deletePaper(btn.dataset.key);
      await renderDbList();
    });
  });
}

// ── Wire up ───────────────────────────────────────────────────────────────────
document.getElementById("sync-btn").addEventListener("click", runSync);
document.getElementById("skip-btn").addEventListener("click", () => {
  skipRequested = true;
  document.getElementById("progress-sub").textContent = "Skipping current paper…";
});
document.getElementById("stop-btn").addEventListener("click", () => {
  stopRequested = true;
  document.getElementById("stop-btn").disabled = true;
  document.getElementById("progress-sub").textContent =
    "Stopping after current item…";
});
document.getElementById("refresh-btn").addEventListener("click", renderDbList);

// ── Supabase key setup ───────────────────────────────────────────────────────
document.getElementById("save-supabase-btn").addEventListener("click", () => {
  const val = document.getElementById("supabase-key-input").value.trim();
  if (!val) {
    document.getElementById("supabase-key-status").textContent = "⚠ Enter a key";
    document.getElementById("supabase-key-status").style.color = "#c53030";
    return;
  }
  CONFIG.SUPABASE_KEY = val;
  chrome.storage.local.set({ refcheck_supabase_key: val });
  document.getElementById("supabase-key-status").textContent = "✓ Saved";
  document.getElementById("supabase-key-status").style.color = "#276749";
  loadProjects();
  renderDbList();
});

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  await loadSupabaseKey();
  // Pre-fill Supabase key input if already saved
  if (CONFIG.SUPABASE_KEY) {
    document.getElementById("supabase-key-input").value = CONFIG.SUPABASE_KEY;
    document.getElementById("supabase-key-status").textContent = "✓ Key loaded";
    document.getElementById("supabase-key-status").style.color = "#276749";
  }
  loadProjects();
  loadCreds();
  renderDbList();
})();
