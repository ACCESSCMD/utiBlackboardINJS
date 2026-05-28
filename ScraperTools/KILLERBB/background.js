chrome.action.onClicked.addListener((tab) => {
  chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    files: ['engine.js'],
    world: 'MAIN' // This is critical. It forces the script to run natively in the page, not in Chrome's isolated sandbox.
  });
});