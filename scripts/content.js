if (typeof window.debaitListenerAdded === 'undefined') {
    window.debaitListenerAdded = true;

    browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "showToast" || request.action === "updateToast") {
            showToast(request.message, request.type);
        }
    });

    function showToast(text, type) {
        const existingToast = document.getElementById("debait-toast");
        if (existingToast) {
            existingToast.remove();
        }

        const toast = document.createElement("div");
        toast.id = "debait-toast";
        toast.textContent = text;

        Object.assign(toast.style, {
            position: "fixed",
            bottom: "20px",
            right: "20px",
            backgroundColor: "#1a1a1a",
            color: "#ffffff",
            padding: "16px 24px",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            fontFamily: "sans-serif",
            fontSize: "14px",
            zIndex: "999999",
            maxWidth: "400px",
            lineHeight: "1.5",
            transition: "opacity 0.3s ease",
            borderLeft: type === "error" ? "4px solid #ef4444" : "4px solid #ff4757"
        });

        document.body.appendChild(toast);

        setTimeout(() => {
            if (toast) {
                toast.style.opacity = "0";
                setTimeout(() => toast.remove(), 300);
            }
        }, 8000);
    }
}