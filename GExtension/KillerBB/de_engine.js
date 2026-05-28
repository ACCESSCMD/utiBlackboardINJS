// ==========================================
// File: de_engine.js
// Version: 1.0.2 (Background Throttling Proof)
// Description: SCORM Auto-Completion Engine
// ==========================================

if (!window._de_engine_injected) {
    window._de_engine_injected = true;
    window._de_engine_running = false;
    window._de_paused = false;
    window._de_kill = false;
    window._de_time_formatted = "00:00";
    window._de_status_msg = "Idle";
    
    // Global tracking variables for absolute background time
    window._de_target_time = 0;
    window._de_paused_time_left = 0;

    window.startDEEngine = function (minutes, seconds, score) {
        if (window._de_engine_running) {
            console.log("⚡ DE Engine already running.");
            return;
        }

        window._de_engine_running = true;
        window._de_paused = false;
        window._de_kill = false;
        
        const scaledScore = score / 100;
        const delayMs = (minutes * 60 * 1000) + (seconds * 1000);
        
        // Calculate absolute target completion time (bulletproof against background throttling)
        window._de_target_time = Date.now() + delayMs;

        console.log(`🚀 DE Engine Started: Waiting ${minutes}m ${seconds}s (Score: ${score})`);

        const countdownInterval = setInterval(() => {
            if (window._de_kill) {
                console.log("🛑 DE Engine Killed.");
                clearInterval(countdownInterval);
                window._de_engine_running = false;
                window._de_status_msg = "Killed";
                return;
            }

            if (window._de_paused) {
                window._de_status_msg = "Paused";
                // When paused, we do NOT calculate time remaining against Date.now()
                // The remaining time is frozen via _de_paused_time_left in popup.js
                return; 
            }

            window._de_status_msg = "Running...";
            
            // Calculate absolute time remaining
            let remainingMs = window._de_target_time - Date.now();
            if (remainingMs < 0) remainingMs = 0;

            const m = Math.floor(remainingMs / 60000);
            const s = Math.floor((remainingMs % 60000) / 1000);
            window._de_time_formatted = `${m}:${s.toString().padStart(2, '0')}`;

            // Trigger completion
            if (remainingMs <= 0) {
                clearInterval(countdownInterval);
                window._de_time_formatted = "0:00";
                window._de_status_msg = "Submitting Score...";
                executeScormCompletion(score, scaledScore);
            }

        }, 500); // Poll every 500ms for snappier UI syncing, math keeps it precise
    };

    async function executeScormCompletion(score, scaledScore) {
        console.log("🚀 Executing SCORM completion...");

        let frame, win, doc, api;

        try {
            frame = document.querySelector('iframe[name="scorm-launch-iframe"]') ||
                    document.querySelector('iframe[src*="scorm"]') ||
                    document.querySelector('iframe');
                    
            if (frame) {
                win = frame.contentWindow;
                doc = frame.contentDocument || win.document;
                console.log("✅ Using iframe:", frame);
            } else {
                console.log("⚠️ SCORM iframe not found, checking main window");
                win = window;
                doc = document;
            }
        } catch (e) {
            win = window;
            doc = document;
        }

        function findAPI(w) {
            while (w) {
                try {
                    if (w.API_1484_11) return w.API_1484_11;
                    if (w.API) return w.API; 
                } catch (e) {}
                if (w === w.parent) break;
                w = w.parent;
            }
            return null;
        }

        try {
            api = findAPI(win);
        } catch (e) {}

        if (!api) {
            console.error("❌ SCORM API unfindable.");
            window._de_status_msg = "Failed: No SCORM API";
        } else {
            const safeSet = (key, val) => {
                try { api.SetValue(key, val); } catch (e) {}
            };
            const safeCall = (action, fn) => {
                try { fn(); } catch (e) {}
            };

            safeCall("Initialize", () => api.Initialize(""));
            safeSet("cmi.completion_status", "completed");
            safeSet("cmi.success_status", score >= 70 ? "passed" : "failed");
            safeSet("cmi.score.raw", String(score));
            safeSet("cmi.score.scaled", String(scaledScore));
            safeSet("cmi.score.min", "0");
            safeSet("cmi.score.max", "100");
            safeSet("cmi.location", "1");
            safeSet("cmi.progress_measure", "1");
            safeCall("Commit", () => api.Commit(""));
            
            console.log(`✅ Completion committed with score ${score}`);
            window._de_status_msg = "Success. Exiting...";
        }

        // Wait for LMS Save
        await new Promise(r => setTimeout(r, 3000));

        // Attempt Exit
        try {
            let exitBtn = doc.querySelector('[data-acc-text="Exit"]') ||
                [...doc.querySelectorAll('*')].find(el => el.textContent?.trim() === 'Exit');

            if (exitBtn) exitBtn.click();
        } catch (e) {}

        // Terminate
        setTimeout(() => {
            if (api) {
                try { api.Terminate(""); } catch (e) {}
            }
            try { win.close(); } catch (e) {}
            
            window._de_engine_running = false;
            window._de_status_msg = "Completed";
            console.log("🏁 Script fully concluded.");
        }, 2000);
    }
}