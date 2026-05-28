document.addEventListener('DOMContentLoaded', async () => {
  const btnStart = document.getElementById('btn-start');
  const btnPause = document.getElementById('btn-pause');
  const btnKill = document.getElementById('btn-kill');
  const statusText = document.getElementById('status-text');
  const statusDot = document.getElementById('status-dot');
  const scriptSelector = document.getElementById('script-selector');

  async function execInPage(func, args = []) {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return null;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, // <--- allFrames removed!
        world: 'MAIN',
        func: func,
        args: args
      });
      return results[0].result;
    } catch (e) {
      return null;
    }
  }

  async function syncUI() {
    const state = await execInPage(() => {
      return {
        running: !!window._iol_engine_running,
        paused: !!window._iol_paused
      };
    });

    if (!state || !state.running) {
      updateUI('idle');
    } else if (state.paused) {
      updateUI('paused');
    } else if (state.running) {
      updateUI('running');
    }
  }

  function updateUI(state) {
    statusDot.className = 'indicator';
    if (state === 'running') {
      statusText.innerText = 'Engine Running';
      statusDot.classList.add('running');
      btnStart.disabled = true;
      btnPause.disabled = false;
      btnPause.innerText = 'Pause';
      btnKill.disabled = false;
    } else if (state === 'paused') {
      statusText.innerText = 'Engine Paused';
      statusDot.classList.add('paused');
      btnStart.disabled = true;
      btnPause.disabled = false;
      btnPause.innerText = 'Resume';
      btnKill.disabled = false;
    } else {
      statusText.innerText = 'Idle / Not Injected';
      btnStart.disabled = false;
      btnPause.disabled = true;
      btnPause.innerText = 'Pause';
      btnKill.disabled = true;
    }
  }

  btnStart.addEventListener('click', async () => {
    let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Inject the selected script only to the top frame
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [scriptSelector.value],
      world: 'MAIN'
    });
    
    // Force flags to active state
    await execInPage(() => { window._iol_paused = false; window._iol_kill = false; });
    syncUI();
  });

  btnPause.addEventListener('click', async () => {
    const isCurrentlyPaused = btnPause.innerText === 'Resume';
    await execInPage((pauseState) => { window._iol_paused = pauseState; }, [!isCurrentlyPaused]);
    syncUI();
  });

  btnKill.addEventListener('click', async () => {
    await execInPage(() => { window._iol_kill = true; window._iol_engine_running = false; });
    syncUI();
  });

  syncUI();
  setInterval(syncUI, 1000);
});