browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
        id: "debait-link",
        title: "Debait",
        contexts: ["link"]
    });
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "debait-link") {
        const linkUrl = info.linkUrl;

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
            // Retrieve the API key from storage
            const storage = await browser.storage.local.get(['groqApiKey']);
            const apiKey = storage.groqApiKey;

            if (!apiKey) {
                throw new Error("API key is not set. Please configure it in the extension options.");
            }

            // Fetch the content of the link
            const response = await fetch(linkUrl, {
                headers: { "Accept": "text/html" }
            });

            if (!response.ok) {
                throw new Error(`The website returned an HTTP error ${response.status}. The link might be blocked, require login, or not exist.`);
            }

            const html = await response.text();

            // Parsing the HTML to extract the title and paragraphs
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const title = doc.title;

            // Prefer content inside <article>/main content wrappers if present,
            // otherwise fall back to the whole document.
            const scope = doc.querySelector('article') || doc.body || doc;

            // Primary extraction: real <p> tags.
            let paragraphs = Array.from(scope.querySelectorAll('p'))
                .map(p => p.textContent.trim())
                .filter(text => text.length > 20)
                .join('\n');

            // Fallback: some sites render text in divs/spans instead of <p>.
            if (!paragraphs) {
                paragraphs = Array.from(scope.querySelectorAll('div, span, li'))
                    .map(el => el.textContent.trim())
                    .filter(text => text.length > 40)
                    .join('\n');
            }

            // Cutting the content to a maximum of 4000 characters to avoid exceeding API limits
            const truncatedContent = paragraphs.substring(0, 4000);

            if (!truncatedContent) {
                throw new Error("The website does not contain text in static HTML (likely the content is loaded via JavaScript) or blocks content retrieval by the extension.");
            }

            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
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