clearInterval(window.autoCourse);

const CLICK_DELAY = 0; 

// 🧠 Global Memory Bank
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
  try { 
    el.click(); 
    return true; 
  } catch {}
  try {
    el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true, view: win }));
    return true;
  } catch {}
  return false;
}

function visible(el) {
  return !!el && el.offsetParent !== null;
}

function autoScroll(win, doc) {
  try {
    // 1. Scroll the main document body
    const absoluteBottom = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
    win.scrollTo(0, absoluteBottom);
    doc.documentElement.scrollTop = absoluteBottom;
    doc.body.scrollTop = absoluteBottom;

    // 2. Scroll the specific inner containers
    const innerWrappers = doc.querySelectorAll('#page-wrap, .page-wrap, .page__wrapper, .lesson-main');
    innerWrappers.forEach(wrapper => {
      if (wrapper) {
        wrapper.scrollTop = wrapper.scrollHeight;
      }
    });
  } catch {}
}

function getQuestionText(quiz) {
  const el = quiz.querySelector(".quiz-card__title");
  if (!el) return "Unknown";
  const div = document.createElement("div");
  div.innerHTML = el.innerHTML;
  return div.textContent.trim().replace(/\s+/g, " ").substring(0, 120);
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
          if (label) {
            answers.push(label.textContent.trim());
          }
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
    
    const isTargetAnswer = answers.some(ans => {
      const cAns = cleanString(ans);
      const cOpt = cleanString(optionText);
      return cOpt === cAns; 
    });

    if (isTargetAnswer) {
      totalTargetsMatched++;
      if (opt.getAttribute("aria-checked") !== "true") {
        // 🎯 PATCH: Click the wrap if it exists, otherwise fallback to opt
        click(wrap || opt, win);
      } else {
        properlyCheckedMatched++;
      }
      if (!isMultiResponse) break;
    } else {
      if (isMultiResponse && opt.getAttribute("aria-checked") === "true") {
        // 🎯 PATCH: Click the wrap if it exists, otherwise fallback to opt
        click(wrap || opt, win);
      }
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
      
      if (checkMarkIcon) {
        exactTargetIndex = index;
      } else if (textBubble) {
        exactTargetIndex = parseInt(textBubble.textContent.trim(), 10) - 1;
      }
    }
    
    mapData.push({
      text: textContent,
      targetIndex: exactTargetIndex
    });
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

  const spaceEvent = new win.KeyboardEvent("keydown", { 
    bubbles: true, 
    cancelable: true, 
    key: " ", 
    keyCode: 32,
    which: 32
  });
  
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
  if (lists.length < 2) {
    quizState.isMatchingProcessing = false;
    return;
  }

  const draggablesList = lists[0];
  const dropzonesList = lists[1];

  let draggables = [...draggablesList.querySelectorAll(".draggable")];
  const dropzones = [...dropzonesList.querySelectorAll(".quiz-match__item--immobile, .droppable")];

  if (draggables.length === 0 || dropzones.length === 0) {
    quizState.isMatchingProcessing = false;
    return;
  }

  if (!quizState.matchingMap) {
    for (let i = 0; i < draggables.length; i++) {
      draggables = [...draggablesList.querySelectorAll(".draggable")];
      const dragEl = draggables[i];
      const targetZone = dropzones[i];

      if (dragEl && targetZone) {
        await forceInputSelection(dragEl, targetZone, win);
      }
    }
  } else {
    const instructions = quizState.matchingMap;

    for (let i = 0; i < instructions.length; i++) {
      const key = instructions[i];
      
      draggables = [...draggablesList.querySelectorAll(".draggable")];
      const matchingDragEl = draggables.find(el => {
        const txt = el.querySelector("[data-match-content='true']")?.textContent?.trim() || "";
        return txt === key.text;
      });

      const targetZone = dropzones[key.targetIndex];

      if (matchingDragEl && targetZone) {
        await forceInputSelection(matchingDragEl, targetZone, win);
      }
    }
  }

  quizState.phase = 'SUBMITTING';
  quizState.lastAction = Date.now();
  quizState.isMatchingProcessing = false;
}

function handleLabeledGraphic(doc, win) {
  const block = doc.querySelector(".block-labeled-graphic");
  if (!block) return false;
  
  const markers = [...block.querySelectorAll(".labeled-graphic-marker")].filter(visible);
  const unviewed = markers.find(btn => /not viewed/i.test(btn.getAttribute("aria-label") || ""));
  
  if (unviewed) {
    click(unviewed, win);
    return true;
  }
  
  const openBubble = block.querySelector(".bubble__body[aria-hidden='false']");
  if (openBubble) {
    const closeBtn = openBubble.querySelector(".bubble__close");
    if (click(closeBtn, win)) return true;
  }
  
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
    if (quizState.phase !== 'START') {
      quizState = getFreshQuizState();
    }
    return false;
  }

  if (quizState.isMatchingProcessing) return true;

  const now = Date.now();
  if (now - quizState.lastAction < 400) return true; 

  const currentQuestionText = getQuestionText(quiz);
  if (quizState.question && quizState.question !== currentQuestionText) {
    quizState = getFreshQuizState(currentQuestionText);
  }

  const isMatching = !!quiz.querySelector(".quiz-match");

  if (quizState.phase === 'START') {
    quizState.question = currentQuestionText;
    
    // 🧠 Check Global Memory Bank First
    const memory = courseKnowledgeBase[currentQuestionText];
    if (memory) {
      if (memory.type === 'choice') {
        quizState.correctAnswers = memory.answers;
        quizState.phase = 'SELECTING_CORRECT';
      } else if (memory.type === 'match') {
        quizState.matchingMap = memory.map;
        quizState.phase = 'SOLVING_MATCH';
      }
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
  const feedbackLabel = quiz.querySelector(".quiz-card__feedback-label");
  const feedbackText = feedbackLabel?.textContent?.trim() || "";

  if (quizState.phase === 'SUBMITTED' && feedbackVisible) {
    const isCorrect = feedbackText.toLowerCase() === 'correct';
    const isIncorrect = feedbackText.toLowerCase() === 'incorrect';
    
    if (isCorrect) {
      const storedKey = quizState.question;
      quizState = getFreshQuizState(); 
      quizState.question = storedKey; 
      
      if (submitBtn && visible(submitBtn) && submitBtn.textContent.trim().toLowerCase() === 'continue') {
        click(submitBtn, win);
      } else {
        const nextBtn = doc.querySelector(".continue-btn.brand--ui");
        if (nextBtn && visible(nextBtn)) {
          click(nextBtn, win);
          quizState = getFreshQuizState(); 
        }
      }
      return true;
    }
    
    if (isIncorrect) {
      quizState.attemptNum++;
      
      // 💾 Save to Global Memory Bank
      if (isMatching) {
        const mappingResult = parseMatchingFeedbackMap(quiz);
        if (mappingResult) {
          quizState.matchingMap = mappingResult;
          courseKnowledgeBase[quizState.question] = { type: 'match', map: mappingResult };
        }
      } else if (!quizState.correctAnswers) {
        const parsed = parseCorrectAnswers(quiz, doc);
        if (parsed) {
          quizState.correctAnswers = parsed;
          courseKnowledgeBase[quizState.question] = { type: 'choice', answers: parsed };
        }
      }
      
      if (retakeBtn && visible(retakeBtn)) {
        click(retakeBtn, win);
        quizState.phase = 'RESETTING';
        quizState.retrySelectionCounter = 0;
        quizState.lastAction = now;
      } else if (submitBtn && visible(submitBtn) && submitBtn.textContent.trim().toLowerCase() === 'continue') {
        click(submitBtn, win);
        quizState = getFreshQuizState();
      }
      return true;
    }
  }
  
  if (quizState.phase === 'RESETTING') {
    const isReset = !feedbackVisible || feedbackWrap?.getAttribute("aria-hidden") === "true";
    const nextPhase = isMatching ? 'SOLVING_MATCH' : 'SELECTING_CORRECT';
    if (isReset && (now - quizState.lastAction > 500)) {
      quizState.phase = nextPhase;
      quizState.lastAction = now;
    } else if (now - quizState.lastAction > 1800) {
      quizState.phase = nextPhase;
    }
    return true;
  }

  if (quizState.phase === 'SOLVING_MATCH') {
    solveMatchingBlockStable(quiz, win);
    return true;
  }
  
  if (quizState.phase === 'SELECTING_CORRECT') {
    if (quizState.correctAnswers && quizState.correctAnswers.length > 0) {
      const isVerifiedSynced = syncSelectionsWithAnswers(quiz, quizState.correctAnswers, win);
      quizState.retrySelectionCounter++;

      if (isVerifiedSynced || quizState.retrySelectionCounter > 5) {
        quizState.phase = 'SUBMITTING';
      }
      quizState.lastAction = now;
    } else {
      // 🎯 PATCH: If correct answers weren't parsed properly, fallback to Brute Forcer
      quizState.phase = 'SELECTING';
      quizState.lastAction = now;
    }
    return true;
  }
  
  // ⚙️ PATCH: BINARY BRUTE-FORCER INTEGRATION
  if (quizState.phase === 'SELECTING') {
    const isMultiResponse = !!quiz.querySelector(".quiz-multiple-response-option");
    
    if (isMultiResponse) {
      // Target the outer <li> wrappers
      const wraps = quiz.querySelectorAll(".quiz-multiple-response-option-wrap");
      if (wraps.length === 0) {
        quizState.phase = 'SUBMITTING';
        return true;
      }

      // Calculate max combinations based on size (2^N - 1)
      const totalCombinations = Math.pow(2, wraps.length) - 1;
      const pattern = (quizState.attemptNum % totalCombinations) + 1;
      
      for (let i = 0; i < wraps.length; i++) {
        const shouldBeChecked = (pattern & (1 << i)) !== 0;
        
        // Checkbox state lives on the inner div
        const checkbox = wraps[i].querySelector('.quiz-multiple-response-option');
        const isChecked = checkbox && checkbox.getAttribute("aria-checked") === "true";

        if (shouldBeChecked !== isChecked) {
          click(wraps[i], win); // Strike the outer <li> wrapper
        }
      }
    } else {
      // Standard Single Choice Iterator
      const wraps = quiz.querySelectorAll(".quiz-multiple-choice-option-wrap");
      if (wraps.length > 0) {
        const targetIndex = quizState.attemptNum % wraps.length;
        if (wraps[targetIndex]) {
          const checkbox = wraps[targetIndex].querySelector('.quiz-multiple-choice-option');
          if (checkbox && checkbox.getAttribute("aria-checked") !== "true") {
            click(wraps[targetIndex], win);
          }
        }
      }
    }
    
    quizState.phase = 'SUBMITTING';
    quizState.lastAction = now;
    return true;
  }
  
  if (quizState.phase === 'SUBMITTING') {
    if (submitBtn && visible(submitBtn)) {
      click(submitBtn, win);
      quizState.phase = 'SUBMITTED';
      quizState.lastAction = now;
    } else if (feedbackVisible) {
      quizState.phase = 'SUBMITTED';
    }
    return true;
  }
  
  return true;
}

// 📂 Dataset Export Function
window.downloadCourseData = function() {
  const answerCount = Object.keys(courseKnowledgeBase).length;
  if (answerCount === 0) {
    console.log("No data stored yet to download.");
    return;
  }

  let title = "Course_Dataset";
  try {
    const titleEl = document.querySelector(".js-header-text") || window.top.document.querySelector(".js-header-text");
    if (titleEl && titleEl.textContent) {
      title = titleEl.textContent.trim().replace(/[^a-zA-Z0-9]/g, '_');
    }
  } catch(e) {
    console.warn("Could not read title, using default filename.");
  }

  const wantDownload = window.confirm(`🎉 Extracted ${answerCount} correct answers.\n\nWould you like to download the dataset for:\n"${title}"?`);
  
  if (wantDownload) {
    const blob = new Blob([JSON.stringify(courseKnowledgeBase, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log("⬇️ Dataset downloaded successfully.");
  }
};

function handleFlashcards(doc, win) {
  // Target any flashcard section missing the '--flipped' class
  const unflippedCards = [...doc.querySelectorAll('.block-flashcard:not(.block-flashcard--flipped)')];

  for (let i = 0; i < unflippedCards.length; i++) {
    const card = unflippedCards[i];
    
    // Safer visibility check using actual rendered dimensions
    const rect = card.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      
      // 💾 HARVEST DATA: Grab text from the .fr-view containers
      const frontEl = card.querySelector('.block-flashcard__front .fr-view');
      const backEl = card.querySelector('.block-flashcard__back .fr-view');
      
      if (frontEl && backEl) {
        const frontText = frontEl.textContent.trim();
        const backText = backEl.textContent.trim();
        
        // Save to Global Memory Bank if it doesn't already exist
        if (frontText && !courseKnowledgeBase[frontText]) {
          console.log(`💾 Flashcard Harvested: [${frontText}] -> [${backText}]`);
          courseKnowledgeBase[frontText] = { 
            type: 'flashcard', 
            answer: backText 
          };
        }
      }

      // 🎯 TARGET CLICK: Strike the button first, fallback to the wrapper
      const flipBtn = card.querySelector('button.block-flashcard__flip');
      const frontFace = card.querySelector('.block-flashcard__front');
      
      if (flipBtn) {
        click(flipBtn, win);
      } else if (frontFace) {
        click(frontFace, win);
      }
      
      // Pause engine for one tick to let the CSS flip animation trigger
      return true; 
    }
  }
  
  return false;
}

function handleVideoTranscripts(doc, win) {
  const accordions = [...doc.querySelectorAll('.blocks-accordion__header')];
  const transcriptBtn = accordions.find(btn => {
    const textMatch = btn.textContent.toLowerCase().includes('transcript');
    const isClosed = btn.getAttribute('aria-expanded') === 'false';
    return textMatch && isClosed;
  });

  if (transcriptBtn && visible(transcriptBtn)) {
    click(transcriptBtn, win);
    return true; 
  }
  return false;
}

window.autoCourse = setInterval(() => {
  const win = findCourseFrame();
  if (!win) return;
  
  const doc = win.document;

  if (!win._exitListenerAttached) {
    win._exitListenerAttached = true;
    win.addEventListener("click", (e) => {
      if (e.target && typeof e.target.closest === 'function') {
        const isExitClick = e.target.closest(".courseExit__button");
        if (isExitClick) {
          window.downloadCourseData();
        }
      }
    }, true); 
  }

  // 1. Prioritize handling active quizzes
  if (handleQuiz(doc, win)) return;

  // ---> Open video transcripts to satisfy content review locks
  if (handleVideoTranscripts(doc, win)) return;

  // ---> Flip all un-flipped flashcards (and harvest their data)
  if (handleFlashcards(doc, win)) return;
  
  // 2. 🔥 NEW: Auto-exit protocol (Only runs if NO quiz is actively being processed)
  const progressEl = doc.querySelector(".nav-sidebar-header__progress-text");
  if (progressEl && progressEl.textContent.trim().toUpperCase().includes("100% COMPLETE")) {
    const exitBtn = doc.querySelector(".courseExit__button");
    if (exitBtn && visible(exitBtn)) {
      console.log("🎉 Course 100% Complete! Auto-triggering exit protocol...");
      clearInterval(window.autoCourse); // Stop the automation loop
      window.downloadCourseData();      // Ask to download the dataset
      click(exitBtn, win);              // Click the exit button
      return;                           // Terminate
    }
  }

  // 3. Normal course progression
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

console.log("🚀 Absolute Validation Engine with True Auto-Exit initialized.");
