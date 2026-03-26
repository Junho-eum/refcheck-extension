# RefCheck — Suggest References

A Chrome extension that surfaces relevant citations from your Zotero library as you write in Overleaf. Highlight any passage, click **💡 Suggest References**, and Claude ranks every paper in your library against that text — right in a browser sidebar.

-----

## How it works

1. **Highlight text** in your Overleaf document.
1. A floating **💡 Suggest References** button appears above the selection (or use the right-click context menu).
1. The sidebar opens and shows a preview of your selected text.
1. Click **Start Analysis** — Claude scores each paper in your library for relevance.
1. Results appear ranked by score, with expandable abstracts and citation keys.

Matching is powered by the **Claude Haiku** model via the Anthropic API. Your reference library is stored in **Supabase** (a Postgres backend) and synced from **Zotero**.

-----

## Prerequisites

|Requirement                                           |Notes                                                   |
|------------------------------------------------------|--------------------------------------------------------|
|Chrome (or Chromium-based browser)                    |Manifest V3 required                                    |
|[Anthropic API key](https://console.anthropic.com/)   |Starts with `sk-ant-`                                   |
|[Zotero account](https://www.zotero.org/)             |Free; needed to export your library                     |
|[Zotero API key](https://www.zotero.org/settings/keys)|Read-only access is sufficient                          |
|Supabase project                                      |Free tier works; you supply the project URL and anon key|

-----

## Installation

1. Download or clone this repository.
1. Open Chrome and go to `chrome://extensions`.
1. Enable **Developer mode** (toggle in the top-right corner).
1. Click **Load unpacked** and select the `refcheck-extension-main` folder.
1. The RefCheck icon appears in your toolbar.

-----

## Setup

### 1 — Anthropic API key

Open the sidebar by clicking the RefCheck toolbar icon on any Overleaf page. Paste your Anthropic API key into the setup box and click **Save**. The key is stored locally in `chrome.storage` and never transmitted anywhere except directly to `api.anthropic.com`.

### 2 — Supabase

RefCheck uses Supabase to store and query your reference library. You need a Supabase project with the schema below.

#### Database schema

Run the following SQL in your Supabase SQL editor:

```sql
-- Projects (optional grouping for multiple libraries)
create table projects (
  id   uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

-- Papers
create table papers (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  cite_key   text,
  title      text,
  abstract   text,
  authors    text,
  year       int,
  journal    text,
  created_at timestamptz default now()
);
```

Once your project is created, copy the **Project URL** and **anon/public key** from *Project Settings → API* and paste them into the RefCheck Options page.

### 3 — Zotero sync

Open the RefCheck **Options** page (right-click the toolbar icon → *Options*, or visit `chrome://extensions` and click *Details → Extension options*).

1. Enter your **Zotero API key** and **Zotero User ID** (found at zotero.org/settings/keys).
1. Optionally enter a **Group Library ID** to sync a shared group library instead of your personal library.
1. Click **Load Collections** to browse your Zotero collections.
1. Select a collection and click **Import to Supabase** to upload papers.

Papers are upserted by title, so re-running an import is safe.

-----

## Usage

### Analysing a passage

1. Navigate to any document on **overleaf.com**.
1. Select the text you want to find references for.
1. Click the **💡 Suggest References** floating button, or right-click and choose **💡 Suggest References** from the context menu.
1. The sidebar opens and shows a preview of your text. Choose a project from the dropdown (if you have more than one) and click **Start Analysis**.
1. Results are listed in descending order of relevance score (0–10). Click any result to expand the abstract.

### Stopping an analysis

Click **Stop** in the sidebar. The current paper finishes scoring and then the run halts.

### Managing projects

Use the **Options** page to create and delete projects. Deleting a project removes the project record but does not delete the papers associated with it — they can be reassigned by recreating the project.

-----

## Configuration

`config.js` contains a small set of constants. **Do not hardcode secret keys here** — they are visible to anyone who inspects the extension.

|Constant           |Default                    |Description                                              |
|-------------------|---------------------------|---------------------------------------------------------|
|`SUPABASE_URL`     |*(your project URL)*       |Set to your Supabase project URL                         |
|`SUPABASE_KEY`     |`""`                       |Set via the Options page; stored in `chrome.storage`     |
|`ANTHROPIC_API_KEY`|`""`                       |Set via the sidebar setup box; stored in `chrome.storage`|
|`MIN_SCORE`        |`2`                        |Papers scoring below this threshold are hidden           |
|`MODEL`            |`claude-haiku-4-5-20251001`|Claude model used for scoring                            |
|`MAX_TOKENS`       |`2000`                     |Maximum tokens per API response                          |

-----

## File overview

```
refcheck-extension-main/
├── manifest.json      # Extension manifest (Manifest V3)
├── config.js          # Shared configuration constants
├── background.js      # Service worker — context menu, sidebar, message routing
├── content.js         # Injected into Overleaf — floating "Suggest References" button
├── sidebar.html       # Sidebar UI markup
├── sidebar.js         # Sidebar logic — scoring, results display, Supabase queries
├── options.html       # Options page markup
├── options.js         # Options logic — Zotero sync, project management
└── icons/
    ├── icon-16.png
    ├── icon-48.png
    └── icon-128.png
```

-----

## Permissions

|Permission                   |Why it’s needed                                           |
|-----------------------------|----------------------------------------------------------|
|`contextMenus`               |Right-click “Suggest References” menu item                |
|`storage`                    |Save API keys and selected project locally                |
|`activeTab`                  |Read the active Overleaf tab when the context menu is used|
|`scripting`                  |Inject the floating button content script                 |
|`sidePanel`                  |Open the sidebar panel                                    |
|`https://www.overleaf.com/*` |Host permission for the content script                    |
|`https://api.anthropic.com/*`|Claude API calls from the sidebar                         |
|`https://*.supabase.co/*`    |Supabase database queries                                 |
|`https://api.zotero.org/*`   |Zotero library sync in the Options page                   |

-----

## Privacy & security

- API keys are stored only in `chrome.storage.local` on your device.
- Selected text is sent to the Anthropic API solely for relevance scoring and is not retained by this extension.
- No data is sent to any server controlled by this extension; all external calls go directly to Anthropic, Supabase, and Zotero using credentials you provide.

-----

