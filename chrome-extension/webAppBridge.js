// webAppBridge.js — lets the local web app share the active outreach note
// with the extension, so LinkedIn search pages can offer a quick copy button.

(() => {
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;

    const data = event.data;
    if (data?.type !== "LRA_REMEMBER_OUTREACH_CONTEXT") return;

    chrome.runtime
      .sendMessage({
        type: "LRA_REMEMBER_OUTREACH_CONTEXT",
        context: data.context,
      })
      .catch(() => {
        // The web app should keep working if the extension was reloaded.
      });
  });
})();
