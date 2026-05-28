document.addEventListener('DOMContentLoaded', async () => {
  const btnStart = document.getElementById('btn-start');
  const btnPause = document.getElementById('btn-pause');
  const btnKill = document.getElementById('btn-kill');
  const statusText = document.getElementById('status-text');
  const statusDot = document.getElementById('status-dot');
  const scriptSelector = document.getElementById('script-selector');
  
  // DE Specific Elements
  const deConfigPanel = document.getElementById('de-config-panel');
  const deLiveTimer = document.getElementById('de-live-timer');
  const inputMin = document.getElementById('de-min');
  const inputSec = document.getElementById('de-sec');
  const inputScore = document.getElementById('de-score');

  // SAFETY CHECK: Only use storage if Chrome has granted the permission
  const hasStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

  // GET CURRENT TAB ID TO STORE DATA INDEPENDENTLY
  let [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!currentTab) return;
  const tabKey = `settings_${currentTab.id}`;

  // Load Tab-Specific Saved Data
  if (hasStorage) {
    chrome.storage.local.get([tabKey], (data) => {
      const saved = data[tabKey] || {};
      
      if (saved.selectedScript) scriptSelector.value = saved.selectedScript;
      if (saved.deMin !== undefined) inputMin.value = saved.deMin;
      if (saved.deSec !== undefined) inputSec.value = saved.deSec;
      if (saved.deScore !== undefined) inputScore.value = saved.deScore;
      
      scriptSelector.dispatchEvent(new Event('change'));
    });
  } else {
    // If no storage (e.g. extension wasn't reloaded), just initialize UI normally
    scriptSelector.dispatchEvent(new Event('change'));
  }

  // Save Tab-Specific Data
  function saveConfig() {
    if (!hasStorage) return;
    const settingsToSave = {
      selectedScript: scriptSelector.value,
      deMin: inputMin.value,
      deSec: inputSec.value,
      deScore: inputScore.value
    };
    chrome.storage.local.set({ [tabKey]: settingsToSave });
  }

  scriptSelector.addEventListener('change', () => {
    saveConfig();
    
    if (scriptSelector.value === 'de_engine.js') {
      deConfigPanel.style.display = 'flex';
    } else {
      deConfigPanel.style.display = 'none';
    }
  });
  
  inputMin.addEventListener('input', saveConfig);
  inputSec.addEventListener('input', saveConfig);
  inputScore.addEventListener('input', saveConfig);

  // Execute Code in the Current Tab
  async function execInPage(func, args = []) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        world: 'MAIN',
        func: func,
        args: args
      });
      return results[0].result;
    } catch (e) {
      return null;
    }
  }

  // Sync the Popup UI with the Background Engine
  async function syncUI() {
    const state = await execInPage(() => {
      return {
        iol_running: !!window._iol_engine_running,
        iol_paused: !!window._iol_paused,
        de_running: !!window._de_engine_running,
        de_paused: !!window._de_paused,
        de_time: window._de_time_formatted || "0:00",
        de_status: window._de_status_msg || ""
      };
    });

    if (!state) {
        updateUI('idle');
        return;
    }

    const isRunning = state.iol_running || state.de_running;
    const isPaused = state.iol_paused || state.de_paused;

    if (!isRunning) {
      updateUI('idle');
    } else if (isPaused) {
      updateUI('paused', state);
    } else {
      updateUI('running', state);
    }
  }

  function updateUI(stateMode, stateData = null) {
    statusDot.className = 'indicator';
    
    if (stateData && (stateData.de_running || stateData.de_paused)) {
      deLiveTimer.style.display = 'block';
      deLiveTimer.innerText = stateData.de_time;
      if (stateData.de_status) statusText.innerText = stateData.de_status;
    } else {
      deLiveTimer.style.display = 'none';
    }

    if (stateMode === 'running') {
      if (!stateData || !stateData.de_running) statusText.innerText = 'Engine Running';
      statusDot.classList.add('running');
      btnStart.disabled = true;
      btnPause.disabled = false;
      btnPause.innerText = 'Pause';
      btnKill.disabled = false;
    } else if (stateMode === 'paused') {
      if (!stateData || !stateData.de_paused) statusText.innerText = 'Engine Paused';
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
    const selectedScript = scriptSelector.value;

    await chrome.scripting.executeScript({
      target: { tabId: currentTab.id },
      files: [selectedScript],
      world: 'MAIN'
    });
    
    if (selectedScript === 'de_engine.js') {
        const m = parseInt(inputMin.value, 10) || 0;
        const s = parseInt(inputSec.value, 10) || 0;
        const score = parseInt(inputScore.value, 10) || 0;
        
        await execInPage((min, sec, sc) => { 
            if(window.startDEEngine) window.startDEEngine(min, sec, sc); 
        }, [m, s, score]);
    } else {
        await execInPage(() => { window._iol_paused = false; window._iol_kill = false; });
    }
    syncUI();
  });

  btnPause.addEventListener('click', async () => {
    const isCurrentlyPaused = btnPause.innerText === 'Resume';
    await execInPage((pauseState) => { 
        window._iol_paused = pauseState; 
        
        if (window._de_engine_running) {
            window._de_paused = pauseState;
            if (pauseState) {
                window._de_paused_time_left = window._de_target_time - Date.now();
            } else {
                window._de_target_time = Date.now() + window._de_paused_time_left;
            }
        }
    }, [!isCurrentlyPaused]);
    syncUI();
  });

  btnKill.addEventListener('click', async () => {
    await execInPage(() => { 
        window._iol_kill = true; 
        window._iol_engine_running = false; 
        window._de_kill = true;
        window._de_engine_running = false;
    });
    syncUI();
  });

  syncUI();
  setInterval(syncUI, 1000);
});