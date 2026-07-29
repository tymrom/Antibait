# Antibait (Debaiter)

A lightweight browser extension that defuses clickbait headlines before you click. Right-click any link, and Antibait fetches the linked article, sends it to an LLM, and shows a one-sentence, neutral summary of what the article actually says — right in a toast notification, no tab switch required.

## How it works

1. Right-click a link and select **Debait** from the context menu.
2. The extension fetches the linked page and extracts the article title and body text.
   - It first tries a fast static fetch of the raw HTML.
   - If the page renders its content client-side (common for single-page apps and many social-media link redirects), it falls back to loading the page in a hidden background tab and reading the fully rendered DOM.
3. The extracted text is sent to the [Groq API](https://groq.com/) (`llama-3.1-8b-instant`) with a prompt asking for a single neutral, factual sentence.
4. The result appears as an on-page toast notification.

## Installation

### Firefox (temporary install, for development)

1. Clone this repository.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Click **Load Temporary Add-on…** and select the `manifest.json` file.

### Getting a Groq API key

1. Create a free account at [console.groq.com](https://console.groq.com/).
2. Generate an API key.
3. Open the extension's options page (click the toolbar icon → **Settings**) and paste the key in.

The key is stored locally via `browser.storage.local` and is never sent anywhere except directly to the Groq API.

## Project structure

```
Antibait/
├── manifest.json          # WebExtension (MV3) manifest
├── background.js          # Context menu, fetching, extraction, Groq API calls
├── scripts/
│   └── content.js         # Injected into the page to display the toast notification
├── popup/                 # Toolbar popup UI
├── options/                # Settings page (API key configuration)
└── icons/
```

## Permissions

| Permission | Why it's needed |
|---|---|
| `contextMenus` | Adds the "Debait" entry to the right-click menu on links |
| `activeTab` / `scripting` | Injects the toast-notification script into the current page |
| `tabs` | Opens a hidden background tab to render JavaScript-heavy pages |
| `storage` | Stores the Groq API key locally |
| `<all_urls>` (host permission) | Needed to fetch arbitrary linked articles and inject scripts into them |

## Known limitations

- Pages that require a login, are aggressively bot-protected, or serve no readable body text (e.g. video-only content) can't be summarized.
- Extraction quality depends on how cleanly a site marks up its article body; some sites may need site-specific tuning.
- Uses Groq's hosted API, so summarization requires an internet connection and a valid API key.