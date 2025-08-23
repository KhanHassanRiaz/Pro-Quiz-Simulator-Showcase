let allQuestions = [], shuffledQuestions = [], currentUserAnswers = [];
let currentQuestionIndex = 0;
let timerInterval = null;
let totalTimeTaken = 0;
let quizTimerMinutes = 0;
let isPaused = false;
let timeLeft = 0;
let isSmartModeEnabled = false;
let incorrectlyAnswered = [];
let isAutoNextEnabledForQuiz = false;
let currentSessionKey = null;

async function startQuizFromBank() {
    if (subjectSelect.value === "") { alert("Please select a subject first."); return; }
    isSmartModeEnabled = bankQuizSmartModeCheckbox.checked;
    const autoNext = autoNextCheckbox.checked;
    const monthContainer = document.getElementById('quiz-month-select-container');
    let selectedOption;
    if (monthContainer.style.display === 'block') {
        const monthSelect = document.getElementById('quiz-month-select');
        selectedOption = monthSelect.options[monthSelect.selectedIndex];
    } else {
        selectedOption = subjectSelect.options[subjectSelect.selectedIndex];
    }
    try {
        const questionBank = await window.electronAPI.getQuizData(selectedOption.value);
        if (!questionBank) throw new Error(`Could not load data for ${selectedOption.text}.`);
        const mode = document.querySelector('input[name="quiz-mode"]:checked').value;
        if (mode === 'range') {
            if (rangeStartInput.value.trim() !== '' && isNaN(parseInt(rangeStartInput.value))) { alert('Invalid start number in range.'); return; }
            if (rangeEndInput.value.trim() !== '' && isNaN(parseInt(rangeEndInput.value))) { alert('Invalid end number in range.'); return; }
            const start = parseInt(rangeStartInput.value) || 1;
            const end = parseInt(rangeEndInput.value) || questionBank.length;
            if (start < 1 || end > questionBank.length || start > end) { alert('Invalid range. Please check your start and end numbers.'); return; }
            allQuestions = questionBank.slice(start - 1, end);
        } else {
            allQuestions = [...questionBank];
        }
        quizTimerMinutes = parseInt(bankTimerInput.value, 10);
        if(isNaN(quizTimerMinutes)) quizTimerMinutes = 0;
        initializeQuiz(false, autoNext, 'quizSession_bank');
    } catch (error) { showError(error); }
}

function startQuizFromPaste() {
    isSmartModeEnabled = pastedDataSmartModeCheckbox.checked;
    const autoNext = autoNextCheckbox.checked;
    try {
        allQuestions = parseQuizData(document.getElementById('question-input').value);
        if (allQuestions.length === 0) { alert('No valid questions found.'); return; }
        quizTimerMinutes = parseInt(pastedDataTimerInput.value, 10);
        if(isNaN(quizTimerMinutes)) quizTimerMinutes = 0;
        initializeQuiz(false, autoNext, 'quizSession_paste');
    } catch (error) { showError(error); }
}

async function generateCustomPaperQuiz() {
    const paperTimerEnabled = paperTimerCheckbox.checked;
    const autoNext = paperAutoNextCheckbox.checked;
    const smartMode = paperSmartModeCheckbox.checked;
    const targetTotalMCQsCustom = 100;
    const selectedCheckboxes = document.querySelectorAll('#subject-selection-container input[type="checkbox"]:checked');
    if (selectedCheckboxes.length === 0) {
        alert("Please select at least one subject to generate the paper.");
        return;
    }

    let combinedQuestions = [];
    let selectedSubjectsConfig = [];

    try {
        for (const checkbox of selectedCheckboxes) {
            const subjectId = checkbox.closest('.subject-row').getAttribute('data-subject-id');
            const subjectRow = checkbox.closest('.subject-row');
            const startInput = subjectRow.querySelector(`#paper-${subjectId}-start`);
            const endInput = subjectRow.querySelector(`#paper-${subjectId}-end`);
            const percentageInput = subjectRow.querySelector(`#paper-${subjectId}-percentage`);
            const percentage = parseInt(percentageInput.value, 10);
            if (isNaN(percentage) || percentage < 0 || percentage > 100) {
                alert(`Invalid percentage for ${subjectRow.querySelector('label').textContent}. Please enter a value between 0 and 100.`);
                return;
            }
            const questionBank = await window.electronAPI.getQuizData(subjectId);
            if (!questionBank) {
                alert(`Could not load data for subject: ${subjectRow.querySelector('label').textContent}. This subject will be skipped.`);
                continue;
            }
            const startValue = startInput.value.trim();
            const endValue = endInput.value.trim();
            let start = 1;
            let end = questionBank.length;
            if (startValue !== '') {
                start = parseInt(startValue);
                if (isNaN(start) || start < 1) {
                    alert(`Invalid start number for ${subjectRow.querySelector('label').textContent}. Please enter a valid number (1 or greater) or leave blank for all questions.`);
                    return;
                }
            }
            if (endValue !== '') {
                end = parseInt(endValue);
                if (isNaN(end) || end > questionBank.length) {
                    alert(`Invalid end number for ${subjectRow.querySelector('label').textContent}. End number cannot exceed total questions (${questionBank.length}). Please enter a valid number or leave blank for all questions.`);
                    return;
                }
            }
            if (start > end) {
                alert(`Invalid range for ${subjectRow.querySelector('label').textContent}. Start number (${start}) cannot be greater than end number (${end}).`);
                return;
            }
            let questionsToConsider = questionBank.slice(start - 1, end);
            selectedSubjectsConfig.push({
                subjectId,
                name: subjectRow.querySelector('label').textContent,
                questions: questionsToConsider,
                percentage: percentage
            });
        }

        let allocations = [];
        let currentTotalAllocated = 0;
        let totalConfiguredPercentage = selectedSubjectsConfig.reduce((sum, s) => sum + s.percentage, 0);
        if (totalConfiguredPercentage === 0) {
            alert("Total selected percentage is 0. Please adjust percentages to generate questions.");
            return;
        }
        for (const item of selectedSubjectsConfig) {
            const exactNum = targetTotalMCQsCustom * (item.percentage / totalConfiguredPercentage);
            const floorNum = Math.floor(exactNum);
            allocations.push({
                item: item,
                exact: exactNum,
                floor: floorNum,
                remainder: exactNum - floorNum,
                allocated: floorNum
            });
            currentTotalAllocated += floorNum;
        }
        let remainingToDistribute = targetTotalMCQsCustom - currentTotalAllocated;
        allocations.sort((a, b) => b.remainder - a.remainder);
        for (let i = 0; i < remainingToDistribute; i++) {
            if (i < allocations.length) {
                allocations[i].allocated++;
            }
        }
        for (const alloc of allocations) {
            const numToPick = Math.min(alloc.allocated, alloc.item.questions.length); 
            const shuffledBank = shuffleArray([...alloc.item.questions]);
            const picked = shuffledBank.slice(0, numToPick);
            combinedQuestions = combinedQuestions.concat(picked);
        }

        if (combinedQuestions.length === 0) {
            alert("No questions could be generated with the selected criteria. Please adjust your selections.");
            return;
        }
        
        if (combinedQuestions.length > targetTotalMCQsCustom) {
            allQuestions = shuffleArray(combinedQuestions).slice(0, targetTotalMCQsCustom);
            alert(`Note: Generated ${allQuestions.length} questions to match target of ${targetTotalMCQsCustom}.`);
        } else if (combinedQuestions.length < targetTotalMCQsCustom) {
             allQuestions = shuffleArray(combinedQuestions);
             alert(`Warning: Only ${allQuestions.length} questions could be generated, less than target of ${targetTotalMCQsCustom}. Some subject data might be insufficient.`);
        } else {
            allQuestions = shuffleArray(combinedQuestions);
        }

        quizTimerMinutes = paperTimerEnabled ? 90 : 0;
        isSmartModeEnabled = smartMode;

        initializeQuiz(false, autoNext, 'quizSession_ppsc_custom');

    } catch (error) {
        showError(error);
    }
}

async function generateDefaultPPSCPaper(timerEnabled = true, autoNext = true, smartMode = false) {
    const defaultTimerValue = 90;
    const targetTotalMCQs = 100;
    let allPpscRelevantSubjects = [];
    
    try {
        for (const [patternKey, percentage] of PPSC_PATTERN) {
            let questionBank;
            if (patternKey === 'ca_2025_group') {
                const caGroup = subjects.find(s => s.file === "ca_2025_group");
                let combinedCAQuestions = [];
                if(caGroup && caGroup.months) {
                    for (const month of caGroup.months) {
                        const monthData = await window.electronAPI.getQuizData(month.file);
                        if (monthData) combinedCAQuestions = combinedCAQuestions.concat(monthData);
                    }
                }
                questionBank = combinedCAQuestions.length > 0 ? combinedCAQuestions : null;
            } else {
                questionBank = await window.electronAPI.getQuizData(patternKey);
            }
            if (questionBank && questionBank.length > 0) {
                allPpscRelevantSubjects.push({
                    id: patternKey,
                    name: subjects.find(s => s.file === patternKey || (s.isGroup && s.file === patternKey))?.name || patternKey,
                    questions: questionBank,
                    percentage: percentage
                });
            } else {
                console.warn(`Subject ${patternKey} from PPSC pattern not found or data missing.`);
            }
        }

        if (allPpscRelevantSubjects.length === 0) {
            alert("Could not load any relevant subjects for PPSC pattern. Please ensure data files are present.");
            return;
        }
        
        let allocations = [];
        let currentTotalAllocated = 0;
        for (const item of allPpscRelevantSubjects) {
            const exactNum = targetTotalMCQs * (item.percentage / 100);
            const floorNum = Math.floor(exactNum);
            allocations.push({
                item: item,
                exact: exactNum,
                floor: floorNum,
                remainder: exactNum - floorNum,
                allocated: floorNum
            });
            currentTotalAllocated += floorNum;
        }

        let remainingToDistribute = targetTotalMCQs - currentTotalAllocated;
        allocations.sort((a, b) => b.remainder - a.remainder);
        for (let i = 0; i < remainingToDistribute; i++) {
            if (i < allocations.length) {
                allocations[i].allocated++;
            }
        }

        let combinedQuestions = [];
        for (const alloc of allocations) {
            const numToPick = Math.min(alloc.allocated, alloc.item.questions.length);
            const shuffledBank = shuffleArray([...alloc.item.questions]);
            const picked = shuffledBank.slice(0, numToPick);
            combinedQuestions = combinedQuestions.concat(picked);
        }

        allQuestions = shuffleArray(combinedQuestions);

        if (allQuestions.length === 0) {
            alert("No questions could be generated using the default PPSC pattern. Please check subject data files.");
            return;
        }

        if (allQuestions.length < targetTotalMCQs) {
            alert(`Warning: Only ${allQuestions.length} questions could be generated. Some subject data might be missing or insufficient.`);
        } else if (allQuestions.length > targetTotalMCQs) {
            allQuestions = allQuestions.slice(0, targetTotalMCQs);
        }

        quizTimerMinutes = timerEnabled ? defaultTimerValue : 0;
        isSmartModeEnabled = smartMode;
        initializeQuiz(false, autoNext, 'quizSession_ppsc_default');

    } catch (error) {
        showError(error);
    }
}

function initializeQuiz(resuming = false, autoNextSetting = true, sessionKey = null) {
    currentSessionKey = sessionKey;
    if (!resuming) {
        if (currentSessionKey) {
            clearSession(currentSessionKey);
        }
        shuffledQuestions = shuffleArray([...allQuestions]);
        currentUserAnswers = new Array(shuffledQuestions.length).fill(null);
        currentQuestionIndex = 0;
        totalTimeTaken = 0;
        timeLeft = quizTimerMinutes * 60;
        incorrectlyAnswered = [];
    }
    isAutoNextEnabledForQuiz = autoNextSetting;
    isPaused = false;
    pauseButton.textContent = 'Pause';
    pauseButton.classList.remove('paused');
    showScreen('quiz-screen');
    startTimer();
    displayQuestion();
}

function startTimer() {
    clearInterval(timerInterval);
    if (isPaused) return;
    const timerTick = () => {
        if (quizTimerMinutes > 0) timeLeft--;
        totalTimeTaken++;
        if (quizTimerMinutes > 0) {
            const min = Math.floor(timeLeft / 60);
            const sec = timeLeft % 60;
            timerDisplay.textContent = `Time: ${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
            if (timeLeft <= 0) {
                clearInterval(timerInterval);
                alert("Time's up!");
                finishQuiz();
            }
        }
    };
    if (quizTimerMinutes > 0) {
        const min = Math.floor(timeLeft / 60);
        const sec = timeLeft % 60;
        timerDisplay.textContent = `Time: ${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    } else {
        timerDisplay.textContent = 'No Timer';
    }
    timerInterval = setInterval(timerTick, 1000);
}

function togglePause() {
    isPaused = !isPaused;
    if (isPaused) {
        clearInterval(timerInterval);
        pauseButton.textContent = 'Resume';
        pauseButton.classList.add('paused');
        feedbackArea.textContent = 'Quiz Paused';
    } else {
        startTimer();
        pauseButton.textContent = 'Pause';
        pauseButton.classList.remove('paused');
        feedbackArea.textContent = '';
    }
    optionsContainer.style.pointerEvents = isPaused ? 'none' : 'auto';
    optionsContainer.style.opacity = isPaused ? 0.5 : 1;
}

function displayQuestion() {
    if (currentSessionKey) {
        saveSession(currentSessionKey);
    }
    const question = shuffledQuestions[currentQuestionIndex];
    questionText.textContent = question.question;
    const fragment = document.createDocumentFragment();
    question.options.forEach((option, index) => {
        const button = document.createElement('button');
        button.innerHTML = `<span class="option-prefix">${String.fromCharCode(65 + index)}.</span> ${option}`;
        button.onclick = () => selectAnswer(option);
        button.dataset.key = (index + 1).toString();
        fragment.appendChild(button);
    });
    optionsContainer.innerHTML = '';
    optionsContainer.appendChild(fragment);
    updateStatus();
}

function selectAnswer(selectedOption) {
    if (currentUserAnswers[currentQuestionIndex] !== null) return;
    currentUserAnswers[currentQuestionIndex] = selectedOption;
    const correct = shuffledQuestions[currentQuestionIndex].answer;
    const isCorrect = selectedOption === correct;
    feedbackArea.textContent = isCorrect ? 'Correct!' : `Incorrect. Correct answer is: ${correct}`;
    feedbackArea.style.color = isCorrect ? 'green' : 'red';
    if (!isCorrect && isSmartModeEnabled) {
        shuffledQuestions.push(shuffledQuestions[currentQuestionIndex]);
        currentUserAnswers.push(null);
        feedbackArea.textContent += " (This question will be asked again).";
        updateStatus();
    }
    if (currentSessionKey) {
        saveSession(currentSessionKey);
    }
    if (isAutoNextEnabledForQuiz) {
        setTimeout(goToNextQuestion, 2000);
    }
}

function finishQuiz() {
    clearInterval(timerInterval);
    incorrectlyAnswered = [];
    for (let i = 0; i < shuffledQuestions.length; i++) {
        const ans = currentUserAnswers[i];
        if (ans !== null && ans !== shuffledQuestions[i].answer) {
            if (!incorrectlyAnswered.some(item => item.questionObj.question === shuffledQuestions[i].question)) {
                incorrectlyAnswered.push({ questionObj: shuffledQuestions[i], userAnswer: ans });
            }
        }
    }
    if (currentSessionKey) {
        clearSession(currentSessionKey);
    }
    displayResults();
}

function displayResults() {
    let correct = 0, incorrect = 0, attempted = 0;
    const latestAnswers = {};
    for(let i = 0; i < shuffledQuestions.length; i++) {
        if(currentUserAnswers[i] !== null) {
            latestAnswers[shuffledQuestions[i].question] = { userAnswer: currentUserAnswers[i], correctAnswer: shuffledQuestions[i].answer };
        }
    }
    attempted = Object.keys(latestAnswers).length;
    for (const questionText in latestAnswers) {
        if (latestAnswers[questionText].userAnswer === latestAnswers[questionText].correctAnswer) {
            correct++;
        } else {
            incorrect++;
        }
    }
    const totalUniqueQuestions = allQuestions.length;
    const skipped = totalUniqueQuestions - attempted;
    showScreen('result-screen');
    document.getElementById('final-score').textContent = `Final Score: ${correct} out of ${totalUniqueQuestions}`;
    document.getElementById('attempted-questions').textContent = `Attempted: ${attempted}`;
    document.getElementById('correct-answers').textContent = `Correct: ${correct}`;
    document.getElementById('incorrect-answers').textContent = `Incorrect: ${incorrect}`;
    document.getElementById('skipped-questions').textContent = `Skipped: ${skipped}`;
    const mins = Math.floor(totalTimeTaken / 60);
    const secs = totalTimeTaken % 60;
    document.getElementById('time-taken').textContent = `Time Taken: ${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    const percentage = totalUniqueQuestions > 0 ? Math.round((correct / totalUniqueQuestions) * 100) : 0;
    document.getElementById('percentage').textContent = `You achieved ${percentage}%.`;
    document.getElementById('congrats-message').textContent = percentage >= 80 ? 'Congratulations! Excellent Performance!' : '';
    if (incorrectlyAnswered.length > 0) {
        reviewIncorrectBtn.style.display = 'block';
        populateReviewScreen();
    } else {
        reviewIncorrectBtn.style.display = 'none';
    }
}

function goToNextQuestion() { if(!isPaused && currentQuestionIndex < shuffledQuestions.length - 1) { currentQuestionIndex++; feedbackArea.textContent = ''; displayQuestion(); } else if (!isPaused) { finishQuiz(); } }
function goToPrevQuestion() { if(!isPaused && currentQuestionIndex > 0) { currentQuestionIndex--; feedbackArea.textContent = ''; displayQuestion(); } }
function updateStatus() { progressIndicator.textContent = `Question: ${currentQuestionIndex + 1} / ${shuffledQuestions.length}`; prevButton.disabled = currentQuestionIndex === 0; nextButton.disabled = currentQuestionIndex === shuffledQuestions.length - 1; }
function populateReviewScreen() { 
    reviewContainer.innerHTML = ''; 
    incorrectlyAnswered.forEach(item => { 
        const reviewItem = document.createElement('div'); 
        reviewItem.className = 'review-item'; 
        reviewItem.innerHTML = ` <p class="review-question">${item.questionObj.question}</p> <p class="review-user-answer">❌ Your Answer: ${item.userAnswer}</p> <p class="review-correct-answer">✔ Correct Answer: ${item.questionObj.answer}</p> `; 
        reviewContainer.appendChild(reviewItem); 
    }); 
}