browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
        id: "debait-link",
        title: "Debait",
        contexts: ["link"]
    });
});

// Facebook (and some other platforms) wrap outgoing links in a redirect URL,
// e.g. https://l.facebook.com/l.php?u=<encoded real URL>&h=...
// Unwrap it so we fetch/render the actual article instead of the redirect page.
function unwrapRedirectLink(url) {
    try {
        const parsed = new URL(url);

        if (parsed.hostname.endsWith("facebook.com") && parsed.pathname === "/l.php") {
            const real = parsed.searchParams.get("u");
            if (real) return decodeURIComponent(real);
        }

        // Generic fallback: some redirectors use a plain "u" or "url" query param.
        const genericParam = parsed.searchParams.get("url") || parsed.searchParams.get("u");
        if (genericParam && /^https?:\/\//i.test(genericParam)) {
            return genericParam;
        }
    } catch (e) {
        // Not a valid URL, or nothing to unwrap – return the original.
    }
    return url;
}

// Extracts the title + main body text from whatever document is currently loaded
// in a tab. Runs inside the page itself via scripting.executeScript, so it always
// sees the fully rendered DOM (post-JavaScript), not the raw HTML source.
function extractArticleFromPage() {
    const title = document.title;
    const scope = document.querySelector("article") || document.body;

    let paragraphs = Array.from(scope.querySelectorAll("p"))
        .map(p => p.textContent.trim())
        .filter(text => text.length > 20)
        .join("\n");

    if (!paragraphs) {
        paragraphs = Array.from(scope.querySelectorAll("div, span, li, h1, h2, h3"))
            .map(el => el.textContent.trim())
            .filter(text => text.length > 40)
            .join("\n");
    }

    return { title, paragraphs };
}

// Primary path: plain fetch() + static HTML parsing. Fast and cheap, but fails
// on JavaScript-rendered pages (SPAs, many news sites' AMP/paywall wrappers, etc.).
async function fetchStaticContent(url) {
    const response = await fetch(url, { headers: { "Accept": "text/html" } });

    if (!response.ok) {
        throw new Error(`The website returned an HTTP error ${response.status}. The link might be blocked, require login, or not exist.`);
    }

    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const title = doc.title;
    const scope = doc.querySelector("article") || doc.body || doc;

    let paragraphs = Array.from(scope.querySelectorAll("p"))
        .map(p => p.textContent.trim())
        .filter(text => text.length > 20)
        .join("\n");

    if (!paragraphs) {
        paragraphs = Array.from(scope.querySelectorAll("div, span, li"))
            .map(el => el.textContent.trim())
            .filter(text => text.length > 40)
            .join("\n");
    }

    return { title, paragraphs };
}

// Fallback path: open the link in a hidden background tab, let the browser actually
// execute the page's JavaScript, then read the rendered DOM. Needed for SPAs and any
// site whose content only exists after client-side rendering/hydration.
async function fetchRenderedContent(url, timeoutMs = 15000) {
    const tab = await browser.tabs.create({ url, active: false });

    try {
        await new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                browser.tabs.onUpdated.removeListener(listener);
                reject(new Error("Timed out waiting for the page to load."));
            }, timeoutMs);

            function listener(tabId, changeInfo) {
                if (tabId === tab.id && changeInfo.status === "complete") {
                    clearTimeout(timeoutId);
                    browser.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            }

            browser.tabs.onUpdated.addListener(listener);
        });

        // Give client-side rendered content a moment to hydrate after "complete".
        await new Promise(resolve => setTimeout(resolve, 1500));

        const results = await browser.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractArticleFromPage
        });

        return results[0].result;
    } finally {
        // Always close the hidden tab, even if extraction failed.
        try {
            await browser.tabs.remove(tab.id);
        } catch (e) {
            // Tab may already be closed.
        }
    }
}

browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "debait-link") {
        const linkUrl = unwrapRedirectLink(info.linkUrl);

        try {
            await browser.scripting.executeScript({
                target: { tabId: tab.id },
                files: ["scripts/content.js"]
            });
        } catch (e) {
            console.log("Script content.js is already injected or lacks permissions.", e);
        }

        browser.tabs.sendMessage(tab.id, {
            action: "showToast",
            message: "Fetching article content and analyzing..."
        });

        try {
            const storage = await browser.storage.local.get(["groqApiKey"]);
            const apiKey = storage.groqApiKey;

            if (!apiKey) {
                throw new Error("API key is not set. Please configure it in the extension options.");
            }

            let title, paragraphs;

            try {
                ({ title, paragraphs } = await fetchStaticContent(linkUrl));
            } catch (staticError) {
                // If the static fetch itself failed (network/HTTP error), don't
                // silently fall through — but an *empty* result is exactly the
                // case the rendered fallback exists for.
                paragraphs = "";
            }

            if (!paragraphs) {
                browser.tabs.sendMessage(tab.id, {
                    action: "updateToast",
                    message: "Static content not found, rendering the page..."
                });

                ({ title, paragraphs } = await fetchRenderedContent(linkUrl));
            }

            const truncatedContent = paragraphs.substring(0, 4000);

            if (!truncatedContent) {
                throw new Error("The website does not contain extractable text, even after rendering (it may require login or actively block automated access).");
            }

            const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "llama-3.1-8b-instant",
                    messages: [
                        {
                            role: "system",
                            content: "You are an assistant that exposes clickbait headlines. Based on the provided headline and article content, write EXACTLY ONE concise, neutral sentence explaining the true meaning or actual fact of the article. IMPORTANT: Your response must be in the SAME LANGUAGE as the provided article (English or Polish). Do not use any introductory phrases (e.g., 'This article is about...'). Output only the raw fact."
                        },
                        {
                            role: "user",
                            content: `Headline: ${title}\n\nArticle Content:\n${truncatedContent}`
                        }
                    ],
                    temperature: 0.1,
                    max_tokens: 150
                })
            });

            const groqData = await groqResponse.json();

            if (!groqResponse.ok) {
                throw new Error(groqData.error?.message || "Error when calling the Groq API.");
            }

            const debaitResult = groqData.choices[0].message.content;

            browser.tabs.sendMessage(tab.id, {
                action: "updateToast",
                message: debaitResult,
                type: "success"
            });

        } catch (error) {
            console.error("Debaiter Error:", error);
            browser.tabs.sendMessage(tab.id, {
                action: "updateToast",
                message: `Error: ${error.message}`,
                type: "error"
            });
        }
    }
});