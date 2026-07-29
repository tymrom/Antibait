document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('api-key');
    const statusMsg = document.getElementById('status');
    const form = document.getElementById('options-form');

    browser.storage.local.get(['groqApiKey']).then((result) => {
        if (result.groqApiKey) {
            apiKeyInput.value = result.groqApiKey;
        }
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const apiKeyValue = apiKeyInput.value.trim();

        browser.storage.local.set({ groqApiKey: apiKeyValue }).then(() => {
            statusMsg.textContent = 'API key saved successfully';
            statusMsg.className = 'status-message success';
            
            setTimeout(() => {
                statusMsg.textContent = '';
                statusMsg.className = 'status-message';
            }, 3000);
        }).catch((error) => {
            statusMsg.textContent = 'An error occurred while saving the API key.';
            statusMsg.className = 'status-message error';
            console.error(error);
        });
    });
});