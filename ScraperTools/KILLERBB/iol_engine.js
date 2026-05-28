if (!window._iol_engine_running) {
  window._iol_engine_running = true;
  window._iol_kill = false;
  window._iol_paused = false;

  const CLICK_DELAY = 0; 
  const courseKnowledgeBase = {};

  function getFreshQuizState(questionText = null) {
    return {
      question: questionText,
      phase: 'START',
      correctAnswers: null,
      attemptNum: 0,
      lastAction: 0,
      retrySelectionCounter: 0,
      matchingMap: null,
      isMatchingProcessing: false
    };
  }

  let quizState = getFreshQuizState();

  function findCourseFrame(win = window) {
    try {
      const doc = win.document;
      if (
        doc.querySelector(".block-knowledge__wrapper") || 
        doc.querySelector(".continue-btn") || 
        doc.querySelector(".process-card") || 
        doc.querySelector("[data-testid='arrow-next']") || 
        doc.querySelector(".block-labeled-graphic") || 
        doc.querySelector(".courseExit__button")
      ) {
        return win;
      }
      for (let i = 0; i < win.frames.length; i++) {
        try {
          const found = findCourseFrame(win.frames[i]);
          if (found) return found;
        } catch {}
      }
    } catch {}
    return null;
  }

  function click(el, win) {
    if (!el || !win) return false;
    try { el.click(); return true; } catch {}
    try { el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true, view: win })); return true; } catch {}
    return false;
  }

  function visible(el) {
    return !!el && el.offsetParent !== null;
  }

  function autoScroll(win, doc) {
    try {
      const absoluteBottom = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
      win.scrollTo(0, absoluteBottom);
      doc.documentElement.scrollTop = absoluteBottom;
      doc.body.scrollTop = absoluteBottom;

      const innerWrappers = doc.querySelectorAll('#page-wrap, .page-wrap, .page__wrapper, .lesson-main');
      innerWrappers.forEach(wrapper => {
        if (wrapper) wrapper.scrollTop = wrapper.scrollHeight;
      });
    } catch {}
  }

  function getQuestionText(quiz) {
    const el = quiz.querySelector(".quiz-card__title");
    if (!el) return "Unknown";
    
    // Clone it so we don't accidentally modify the live DOM
    const clone = el.cloneNode(true);
    
    // Replace <br> and </p> tags with spaces to prevent text mashing
    const html = clone.innerHTML
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/p>/gi, ' </p>');
        
    const div = document.createElement("div");
    div.innerHTML = html;
    
    return div.textContent.trim().replace(/\s+/g, " ");
  }

  function cleanString(str) {
    return str.trim()
              .replace(/\s+/g, " ")
              .replace(/\u00A0/g, " ")
              .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"")
              .toLowerCase();
  }

  function parseCorrectAnswers(quiz, doc) {
    const answers = [];
    const options = quiz.querySelectorAll(".quiz-multiple-response-option, .quiz-multiple-choice-option");
    
    options.forEach(opt => {
      const resultId = opt.getAttribute("aria-describedby");
      if (resultId) {
        const resultEl = doc.getElementById(resultId);
        if (resultEl) {
          const feedbackStatus = resultEl.textContent.trim().toLowerCase();
          if (
            feedbackStatus === "incorrectly unchecked" || 
            feedbackStatus === "correctly checked" ||
            feedbackStatus === "correctly selected" ||
            feedbackStatus === "incorrectly unselected"
          ) {
            const labelId = opt.getAttribute("aria-labelledby");
            const label = doc.getElementById(labelId);
            if (label) answers.push(label.textContent.trim());
          }
        }
      }
    });
    return answers.length > 0 ? answers : null;
  }

  function syncSelectionsWithAnswers(quiz, answers, win) {
    const wrapperText = quiz.querySelector(".block-knowledge__wrapper")?.getAttribute("aria-label") || "";
    const isMultiResponse = quiz.querySelectorAll(".quiz-multiple-response-option").length > 0 || wrapperText.toLowerCase().includes("multiple");
    const allOptions = [...quiz.querySelectorAll(".quiz-multiple-response-option, .quiz-multiple-choice-option")];
    
    let totalTargetsMatched = 0;
    let properlyCheckedMatched = 0;

    for (let i = 0; i < allOptions.length; i++) {
      const opt = allOptions[i];
      const wrap = opt.closest(".quiz-multiple-response-option-wrap, .quiz-multiple-choice-option-wrap");
      const textEl = wrap?.querySelector(".quiz-multiple-response-option__text, .quiz-multiple-choice-option__text");
      const optionText = textEl ? textEl.textContent.trim() : "";
      
      const isTargetAnswer = answers.some(ans => cleanString(optionText) === cleanString(ans));

      if (isTargetAnswer) {
        totalTargetsMatched++;
        if (opt.getAttribute("aria-checked") !== "true") click(wrap || opt, win);
        else properlyCheckedMatched++;
        if (!isMultiResponse) break;
      } else {
        if (isMultiResponse && opt.getAttribute("aria-checked") === "true") click(wrap || opt, win);
      }
    }
    return isMultiResponse ? (properlyCheckedMatched === totalTargetsMatched) : (properlyCheckedMatched > 0);
  }

  function parseMatchingFeedbackMap(quiz) {
    const rows = quiz.querySelectorAll(".quiz-match__listbrand--body, .quiz-match__list.brand--body");
    if (rows.length < 2) return null;

    const draggableItems = rows[0].querySelectorAll(".quiz-match__item");
    const bubbleFeedbackElements = quiz.querySelectorAll(".quiz-match__list--results .quiz-match__item-feedback");
    
    const mapData = [];
    draggableItems.forEach((item, index) => {
      const textEl = item.querySelector("[data-match-content='true']");
      const textContent = textEl ? textEl.textContent.trim() : "";
      const feedbackRow = bubbleFeedbackElements[index];
      let exactTargetIndex = index; 

      if (feedbackRow) {
        const checkMarkIcon = feedbackRow.querySelector("svg[data-icon='circle-check'], [aria-label='Check mark']");
        const textBubble = feedbackRow.querySelector(".quiz-match__item-feedback-bubble");
        if (checkMarkIcon) exactTargetIndex = index;
        else if (textBubble) exactTargetIndex = parseInt(textBubble.textContent.trim(), 10) - 1;
      }
      mapData.push({ text: textContent, targetIndex: exactTargetIndex });
    });
    return mapData.length > 0 ? mapData : null;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function forceInputSelection(el, target, win) {
    if (!el || !target) return;
    el.setAttribute("aria-hidden", "false");
    el.setAttribute("tabindex", "0");
    target.setAttribute("aria-hidden", "false");
    target.setAttribute("tabindex", "0");
    el.focus();
    await sleep(60);
    const spaceEvent = new win.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: " ", keyCode: 32, which: 32 });
    el.dispatchEvent(spaceEvent);
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
    await sleep(120); 
    target.focus();
    target.dispatchEvent(spaceEvent);
    target.dispatchEvent(new win.Event('change', { bubbles: true }));
    await sleep(200); 
  }

  async function solveMatchingBlockStable(quiz, win) {
    if (quizState.isMatchingProcessing) return;
    quizState.isMatchingProcessing = true;
    const lists = quiz.querySelectorAll(".quiz-match__list.brand--body");
    if (lists.length < 2) { quizState.isMatchingProcessing = false; return; }

    let draggables = [...lists[0].querySelectorAll(".draggable")];
    const dropzones = [...lists[1].querySelectorAll(".quiz-match__item--immobile, .droppable")];

    if (draggables.length === 0 || dropzones.length === 0) { quizState.isMatchingProcessing = false; return; }

    if (!quizState.matchingMap) {
      for (let i = 0; i < draggables.length; i++) {
        draggables = [...lists[0].querySelectorAll(".draggable")];
        if (draggables[i] && dropzones[i]) await forceInputSelection(draggables[i], dropzones[i], win);
      }
    } else {
      for (let i = 0; i < quizState.matchingMap.length; i++) {
        const key = quizState.matchingMap[i];
        draggables = [...lists[0].querySelectorAll(".draggable")];
        const matchingDragEl = draggables.find(el => (el.querySelector("[data-match-content='true']")?.textContent?.trim() || "") === key.text);
        if (matchingDragEl && dropzones[key.targetIndex]) await forceInputSelection(matchingDragEl, dropzones[key.targetIndex], win);
      }
    }
    quizState.phase = 'SUBMITTING';
    quizState.lastAction = Date.now();
    quizState.isMatchingProcessing = false;
  }

  function handleLabeledGraphic(doc, win) {
    const block = doc.querySelector(".block-labeled-graphic");
    if (!block) return false;
    const unviewed = [...block.querySelectorAll(".labeled-graphic-marker")].filter(visible).find(btn => /not viewed/i.test(btn.getAttribute("aria-label") || ""));
    if (unviewed) { click(unviewed, win); return true; }
    const openBubble = block.querySelector(".bubble__body[aria-hidden='false']");
    if (openBubble) { if (click(openBubble.querySelector(".bubble__close"), win)) return true; }
    return false;
  }

  function getActiveQuiz(doc) {
    const quizzes = [...doc.querySelectorAll(".block-knowledge__wrapper")];
    if (quizzes.length === 0) return null;
    return quizzes.find(q => {
      const btn = q.querySelector(".quiz-card__button");
      const retake = q.querySelector(".block-knowledge__retake");
      return (btn && visible(btn)) || (retake && visible(retake));
    }) || quizzes[0];
  }

  function handleQuiz(doc, win) {
    const quiz = getActiveQuiz(doc);
    if (!quiz) {
      if (quizState.phase !== 'START') quizState = getFreshQuizState();
      return false;
    }

    if (quizState.isMatchingProcessing) return true;
    const now = Date.now();
    if (now - quizState.lastAction < 400) return true; 

    const currentQuestionText = getQuestionText(quiz);
    if (quizState.question && quizState.question !== currentQuestionText) quizState = getFreshQuizState(currentQuestionText);

    const isMatching = !!quiz.querySelector(".quiz-match");

    if (quizState.phase === 'START') {
      quizState.question = currentQuestionText;
      const memory = courseKnowledgeBase[currentQuestionText];
      if (memory) {
        if (memory.type === 'choice') { quizState.correctAnswers = memory.answers; quizState.phase = 'SELECTING_CORRECT'; } 
        else if (memory.type === 'match') { quizState.matchingMap = memory.map; quizState.phase = 'SOLVING_MATCH'; }
      } else {
        quizState.phase = isMatching ? 'SOLVING_MATCH' : 'SELECTING';
      }
      quizState.lastAction = now;
      return true;
    }

    const submitBtn = quiz.querySelector(".quiz-card__button");
    const retakeBtn = quiz.querySelector(".block-knowledge__retake");
    const feedbackWrap = quiz.querySelector(".quiz-card__feedback-wrap");
    const feedbackVisible = feedbackWrap && visible(feedbackWrap);
    const feedbackText = quiz.querySelector(".quiz-card__feedback-label")?.textContent?.trim() || "";

    if (quizState.phase === 'SUBMITTED' && feedbackVisible) {
      if (feedbackText.toLowerCase() === 'correct') {
        
        if (!courseKnowledgeBase[quizState.question]) {
          if (isMatching) {
            const mappingResult = parseMatchingFeedbackMap(quiz);
            if (mappingResult) { courseKnowledgeBase[quizState.question] = { type: 'match', map: mappingResult }; }
          } else {
            const parsed = parseCorrectAnswers(quiz, doc);
            if (parsed) { 
              courseKnowledgeBase[quizState.question] = { type: 'choice', answers: parsed }; 
              console.log(`💾 Brute-Forcer Harvested Answer: [${parsed.join(" | ")}]`);
            }
          }
        }

        const storedKey = quizState.question;
        quizState = getFreshQuizState(); 
        quizState.question = storedKey; 
        
        if (submitBtn && visible(submitBtn) && submitBtn.textContent.trim().toLowerCase() === 'continue') click(submitBtn, win);
        else {
          const nextBtn = doc.querySelector(".continue-btn.brand--ui");
          if (nextBtn && visible(nextBtn)) { click(nextBtn, win); quizState = getFreshQuizState(); }
        }
        return true;
      }
      
      if (feedbackText.toLowerCase() === 'incorrect') {
        quizState.attemptNum++;
        if (isMatching) {
          const mappingResult = parseMatchingFeedbackMap(quiz);
          if (mappingResult) { quizState.matchingMap = mappingResult; courseKnowledgeBase[quizState.question] = { type: 'match', map: mappingResult }; }
        } else if (!quizState.correctAnswers) {
          const parsed = parseCorrectAnswers(quiz, doc);
          if (parsed) { quizState.correctAnswers = parsed; courseKnowledgeBase[quizState.question] = { type: 'choice', answers: parsed }; }
        }
        if (retakeBtn && visible(retakeBtn)) { click(retakeBtn, win); quizState.phase = 'RESETTING'; quizState.retrySelectionCounter = 0; quizState.lastAction = now; } 
        else if (submitBtn && visible(submitBtn) && submitBtn.textContent.trim().toLowerCase() === 'continue') { click(submitBtn, win); quizState = getFreshQuizState(); }
        return true;
      }
    }
    
    if (quizState.phase === 'RESETTING') {
      if ((!feedbackVisible || feedbackWrap?.getAttribute("aria-hidden") === "true") && (now - quizState.lastAction > 500)) {
        quizState.phase = isMatching ? 'SOLVING_MATCH' : 'SELECTING_CORRECT'; quizState.lastAction = now;
      } else if (now - quizState.lastAction > 1800) {
        quizState.phase = isMatching ? 'SOLVING_MATCH' : 'SELECTING_CORRECT';
      }
      return true;
    }

    if (quizState.phase === 'SOLVING_MATCH') { solveMatchingBlockStable(quiz, win); return true; }
    
    if (quizState.phase === 'SELECTING_CORRECT') {
      if (quizState.correctAnswers && quizState.correctAnswers.length > 0) {
        if (syncSelectionsWithAnswers(quiz, quizState.correctAnswers, win) || ++quizState.retrySelectionCounter > 5) quizState.phase = 'SUBMITTING';
        quizState.lastAction = now;
      } else {
        quizState.phase = 'SELECTING'; quizState.lastAction = now;
      }
      return true;
    }
    
    if (quizState.phase === 'SELECTING') {
      const isMultiResponse = !!quiz.querySelector(".quiz-multiple-response-option");
      
      if (isMultiResponse) {
        const wraps = quiz.querySelectorAll(".quiz-multiple-response-option-wrap");
        if (wraps.length === 0) { quizState.phase = 'SUBMITTING'; return true; }
        
        const totalCombinations = Math.pow(2, wraps.length) - 1;
        const pattern = (quizState.attemptNum % totalCombinations) + 1;
        
        for (let i = 0; i < wraps.length; i++) {
          const shouldBeChecked = (pattern & (1 << i)) !== 0;
          const checkbox = wraps[i].querySelector('.quiz-multiple-response-option');
          const isChecked = checkbox && checkbox.getAttribute("aria-checked") === "true";
          if (shouldBeChecked !== isChecked) click(wraps[i], win);
        }
      } else {
        const wraps = quiz.querySelectorAll(".quiz-multiple-choice-option-wrap");
        if (wraps.length > 0) {
          const targetIndex = quizState.attemptNum % wraps.length;
          if (wraps[targetIndex]) {
            const checkbox = wraps[targetIndex].querySelector('.quiz-multiple-choice-option');
            if (checkbox && checkbox.getAttribute("aria-checked") !== "true") click(wraps[targetIndex], win);
          }
        }
      }
      
      quizState.phase = 'SUBMITTING';
      quizState.lastAction = now;
      return true;
    }
    
    if (quizState.phase === 'SUBMITTING') {
      if (submitBtn && visible(submitBtn)) { click(submitBtn, win); quizState.phase = 'SUBMITTED'; quizState.lastAction = now; } 
      else if (feedbackVisible) quizState.phase = 'SUBMITTED';
      return true;
    }
    
    return true;
  }

  window.downloadCourseData = function(forceSilent = false) {
    const answerCount = Object.keys(courseKnowledgeBase).length;
    if (answerCount === 0) { console.log("No data stored yet to download."); return; }
    
    let title = "Course_Dataset";
    try { const titleEl = document.querySelector(".js-header-text") || window.top.document.querySelector(".js-header-text"); if (titleEl && titleEl.textContent) title = titleEl.textContent.trim().replace(/[^a-zA-Z0-9]/g, '_'); } catch(e) {}
    
    if (forceSilent || window.confirm(`🎉 Extracted ${answerCount} correct answers.\n\nWould you like to download the dataset for:\n"${title}"?`)) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(courseKnowledgeBase, null, 2)], { type: 'application/json' }));
      a.download = `${title}.json`;
      document.body.appendChild(a); 
      a.click(); 
      document.body.removeChild(a);
      console.log("⬇️ Dataset synchronized to disk successfully.");
    }
  };

  function handleFlashcards(doc, win) {
    const unflippedCards = [...doc.querySelectorAll('.block-flashcard:not(.block-flashcard--flipped)')];
    for (let i = 0; i < unflippedCards.length; i++) {
      const card = unflippedCards[i];
      if (card.getBoundingClientRect().width > 0 && card.getBoundingClientRect().height > 0) {
        const frontEl = card.querySelector('.block-flashcard__front .fr-view');
        const backEl = card.querySelector('.block-flashcard__back .fr-view');
        if (frontEl && backEl) {
          const frontText = frontEl.textContent.trim();
          const backText = backEl.textContent.trim();
          if (frontText && !courseKnowledgeBase[frontText]) {
            console.log(`💾 Flashcard Harvested: [${frontText}] -> [${backText}]`);
            courseKnowledgeBase[frontText] = { type: 'flashcard', answer: backText };
          }
        }
        const flipBtn = card.querySelector('button.block-flashcard__flip');
        const frontFace = card.querySelector('.block-flashcard__front');
        if (flipBtn) click(flipBtn, win); else if (frontFace) click(frontFace, win);
        return true; 
      }
    }
    return false;
  }

  function handleVideoTranscripts(doc, win) {
    const transcriptBtn = [...doc.querySelectorAll('.blocks-accordion__header')].find(btn => btn.textContent.toLowerCase().includes('transcript') && btn.getAttribute('aria-expanded') === 'false');
    if (transcriptBtn && visible(transcriptBtn)) { click(transcriptBtn, win); return true; }
    return false;
  }

  window.autoCourse = setInterval(() => {
    if (window._iol_kill) {
      console.log("🛑 Engine Killed via UI.");
      clearInterval(window.autoCourse);
      window._iol_engine_running = false;
      return;
    }

    if (window._iol_paused) return;

    const win = findCourseFrame();
    if (!win) return;
    const doc = win.document;

    if (!win._exitListenerAttached) {
      win._exitListenerAttached = true;
      win.addEventListener("click", (e) => {
        if (e.target && typeof e.target.closest === 'function') {
          const isExitClick = e.target.closest(".courseExit__button");
          if (isExitClick && window._iol_engine_running) {
            console.log("🚪 Exit Button Clicked. Syncing data synchronously before unmount...");
            clearInterval(window.autoCourse); 
            window._iol_engine_running = false; 
            window.downloadCourseData(true); 
          }
        }
      }, true); 
    }

    if (handleQuiz(doc, win)) return;
    if (handleVideoTranscripts(doc, win)) return;
    if (handleFlashcards(doc, win)) return;
    
    const progressEl = doc.querySelector(".nav-sidebar-header__progress-text");
    if (progressEl && progressEl.textContent.trim().toUpperCase().includes("100% COMPLETE")) {
      const exitBtn = doc.querySelector(".courseExit__button");
      if (exitBtn && visible(exitBtn)) {
        console.log("🎉 Course 100% Complete! Auto-triggering exit protocol...");
        clearInterval(window.autoCourse); 
        window._iol_engine_running = false;
        window.downloadCourseData(true); 
        click(exitBtn, win);              
        return;                           
      }
    }

    const nextBtn = doc.querySelector(".continue-btn.brand--ui");
    if (!nextBtn || nextBtn.disabled || !visible(nextBtn)) {
      autoScroll(win, doc);
    }
    
    if (handleLabeledGraphic(doc, win)) return;
    
    const timelineCards = [...doc.querySelectorAll(".timeline-card:not(.timeline-card--active)")].filter(visible);
    if (timelineCards.length > 0) {
       click(timelineCards[0], win);
       return;
    }

    if (click(doc.querySelector(".cover__header-content-action-link.overview__button-enrolled"), win)) return;
    if (click(doc.querySelector(".process-card--active .process-card__start"), win)) return;
    
    const processNext = doc.querySelector('[data-testid="arrow-next"]:not(.process-arrow--disabled)');
    if (processNext && processNext.getAttribute("aria-hidden") !== "true") {
      click(processNext, win);
      return;
    }
    
    if (nextBtn && !nextBtn.disabled && visible(nextBtn)) {
      click(nextBtn, win);
      return;
    }  
  }, CLICK_DELAY);

  console.log("🚀 Modular IOL Engine Injected and Running.");

} else {
  window._iol_paused = false;
  window._iol_kill = false;
  console.log("⚡ Engine already present. Resuming operations...");
}