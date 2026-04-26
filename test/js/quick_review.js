(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const state = {
    dictMeta: null,
    selectedDictId: null,
    selectedUnitIds: new Set(),
    loadedWords: [],
    activeWords: [],
    idx: 0,
    round: 0,
    roundWrongMap: new Map(),
    allWrongMap: new Map(),
    transVisible: false,
    sessionStarted: false
  };

  const elSelDict = $("#sel-dict");
  const elUnits = $("#units");
  const elLimit = $("#num-limit");
  const elShuffle = $("#chk-shuffle");

  const elBtnLoad = $("#btn-load");
  const elBtnAll = $("#btn-all");
  const elBtnNone = $("#btn-none");
  const elBtnExport = $("#btn-export");

  const elEmpty = $("#empty-state");
  const elReviewState = $("#review-state");
  const elRoundEnd = $("#round-end");

  const elPillRound = $("#pill-round");
  const elPillProgress = $("#pill-progress");
  const elPillWrong = $("#pill-wrong");
  const elPillTotalWrong = $("#pill-total-wrong");

  const elWordIndex = $("#word-index");
  const elWordName = $("#word-name");
  const elWordTrans = $("#word-trans");

  const elBtnShow = $("#btn-show");
  const elBtnKnown = $("#btn-known");
  const elBtnUnknown = $("#btn-unknown");

  const elRoundEndTitle = $("#round-end-title");
  const elRoundEndDesc = $("#round-end-desc");
  const elBtnNextRound = $("#btn-next-round");
  const elBtnRestart = $("#btn-restart");

  function wordKeyOf(word) {
    const t = Array.isArray(word.trans) ? word.trans.join("\n") : String(word.trans || "");
    return `${word.name}||${t}`;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function uniqBy(arr, keyFn) {
    const seen = new Set();
    const out = [];
    for (const item of arr) {
      const key = keyFn(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  function displayTrans(word) {
    const a = Array.isArray(word.trans) ? word.trans : [String(word.trans || "")];
    return a.map((x) => String(x).trim()).filter(Boolean).join(" / ") || "(无释义)";
  }

  async function loadDictionaryMeta() {
    const r = await fetch("dictionary.json", { cache: "no-store" });
    if (!r.ok) throw new Error(`读取 dictionary.json 失败: ${r.status}`);
    const data = await r.json();
    if (!data || !Array.isArray(data.dictionaries)) throw new Error("dictionary.json 格式不正确");
    state.dictMeta = data;
  }

  function renderDictOptions() {
    const dicts = state.dictMeta?.dictionaries || [];
    elSelDict.innerHTML = dicts.map((d) => `<option value="${d.id}">${d.id}${d.name ? ` · ${d.name}` : ""}</option>`).join("");
    state.selectedDictId = dicts[0]?.id || null;
    if (state.selectedDictId) {
      elSelDict.value = state.selectedDictId;
      renderUnits();
    }
  }

  function currentDict() {
    return (state.dictMeta?.dictionaries || []).find((d) => d.id === state.selectedDictId) || null;
  }

  function renderUnits() {
    const dict = currentDict();
    if (!dict) {
      elUnits.innerHTML = "<div class=\"empty\">未找到词书</div>";
      return;
    }

    elUnits.innerHTML = (dict.units || []).map((u) => {
      const checked = state.selectedUnitIds.has(u.id) ? "checked" : "";
      return `
        <div class="unit">
          <label><input type="checkbox" data-unit-id="${u.id}" ${checked} /> ${u.id} · ${u.name || u.id}</label>
          <span class="count">约 ${u.wordCount ?? "?"} 词</span>
        </div>
      `;
    }).join("");
  }

  async function loadSelectedWords() {
    const dict = currentDict();
    if (!dict) throw new Error("请先选择词书");
    const selectedUnits = (dict.units || []).filter((u) => state.selectedUnitIds.has(u.id));
    if (!selectedUnits.length) throw new Error("请至少选择 1 个单元");

    const all = [];
    for (const u of selectedUnits) {
      const r = await fetch(u.file, { cache: "no-store" });
      if (!r.ok) throw new Error(`读取 ${u.file} 失败: ${r.status}`);
      const words = await r.json();
      if (!Array.isArray(words)) continue;
      for (const w of words) {
        if (!w || !w.name) continue;
        all.push({
          name: String(w.name).trim(),
          trans: Array.isArray(w.trans) ? w.trans : [String(w.trans || "")],
          dictId: dict.id,
          unitId: u.id,
          sourceFile: u.file
        });
      }
    }

    const unique = uniqBy(all, wordKeyOf);
    const maxN = Math.max(10, Math.min(5000, Number(elLimit.value || 300)));
    const ordered = elShuffle.checked ? shuffle(unique) : unique;
    return ordered.slice(0, maxN);
  }

  function setMode(mode) {
    const isReview = mode === "review";
    const isEnd = mode === "end";
    elEmpty.classList.toggle("hidden", isReview || isEnd);
    elReviewState.classList.toggle("hidden", !isReview);
    elRoundEnd.classList.toggle("hidden", !isEnd);
  }

  function updatePills() {
    elPillRound.textContent = `第 ${state.round} 轮`;
    elPillProgress.textContent = `${Math.min(state.idx + 1, state.activeWords.length)} / ${state.activeWords.length}`;
    elPillWrong.textContent = `本轮错词 ${state.roundWrongMap.size}`;
    elPillTotalWrong.textContent = `累计错词 ${state.allWrongMap.size}`;
    elBtnExport.disabled = state.allWrongMap.size === 0;
  }

  function renderCurrentWord() {
    const word = state.activeWords[state.idx];
    if (!word) {
      endRound();
      return;
    }

    state.transVisible = false;
    elWordIndex.textContent = `第 ${state.idx + 1} / ${state.activeWords.length} 个`;
    elWordName.textContent = word.name;
    elWordTrans.textContent = displayTrans(word);
    elWordTrans.classList.add("hidden");
    updatePills();
  }

  function markWord(known) {
    const word = state.activeWords[state.idx];
    if (!word) return;
    const k = wordKeyOf(word);

    if (!known) {
      if (!state.roundWrongMap.has(k)) {
        state.roundWrongMap.set(k, { ...word, wrongCountInRound: 1 });
      }
      const prev = state.allWrongMap.get(k);
      state.allWrongMap.set(k, {
        ...word,
        wrongCountTotal: (prev?.wrongCountTotal || 0) + 1,
        firstWrongRound: prev?.firstWrongRound || state.round,
        lastWrongRound: state.round
      });
    }

    state.idx += 1;
    if (state.idx >= state.activeWords.length) {
      endRound();
    } else {
      renderCurrentWord();
    }
  }

  function endRound() {
    const wrongCount = state.roundWrongMap.size;
    if (wrongCount > 0) {
      elRoundEndTitle.textContent = `第 ${state.round} 轮完成：错词 ${wrongCount} 个`;
      elRoundEndDesc.textContent = "建议继续下一轮，仅复习这一轮错词。";
      elBtnNextRound.disabled = false;
    } else {
      elRoundEndTitle.textContent = `第 ${state.round} 轮完成：全对`;
      elRoundEndDesc.textContent = state.allWrongMap.size
        ? "本轮已无错词。你可以导出累计错词，或重新开始新一轮。"
        : "很好，这一轮没有错词。";
      elBtnNextRound.disabled = true;
    }
    updatePills();
    setMode("end");
  }

  function startRound(words, roundNo) {
    state.activeWords = words.slice();
    state.round = roundNo;
    state.idx = 0;
    state.roundWrongMap = new Map();

    if (!state.activeWords.length) {
      setMode("end");
      elRoundEndTitle.textContent = "没有可复习的词";
      elRoundEndDesc.textContent = "请重新选择词书和单元。";
      elBtnNextRound.disabled = true;
      return;
    }

    setMode("review");
    renderCurrentWord();
  }

  function exportWrongWords() {
    const items = Array.from(state.allWrongMap.values()).map((x) => ({
      name: x.name,
      trans: x.trans,
      dictId: x.dictId,
      unitId: x.unitId,
      sourceFile: x.sourceFile,
      wrongCountTotal: x.wrongCountTotal,
      firstWrongRound: x.firstWrongRound,
      lastWrongRound: x.lastWrongRound
    }));

    if (!items.length) {
      alert("当前没有错词可导出");
      return;
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      totalWrongWords: items.length,
      totalRoundsFinished: state.round,
      words: items
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `quick_review_wrong_words_round${state.round}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 600);
  }

  function bindEvents() {
    elSelDict.addEventListener("change", () => {
      state.selectedDictId = elSelDict.value;
      state.selectedUnitIds.clear();
      const dict = currentDict();
      if (dict && Array.isArray(dict.units) && dict.units[0]) {
        state.selectedUnitIds.add(dict.units[0].id);
      }
      renderUnits();
    });

    elUnits.addEventListener("change", (e) => {
      const cb = e.target.closest("input[type=checkbox][data-unit-id]");
      if (!cb) return;
      const id = cb.dataset.unitId;
      if (cb.checked) state.selectedUnitIds.add(id);
      else state.selectedUnitIds.delete(id);
    });

    elBtnAll.addEventListener("click", () => {
      const dict = currentDict();
      if (!dict) return;
      state.selectedUnitIds = new Set((dict.units || []).map((u) => u.id));
      renderUnits();
    });

    elBtnNone.addEventListener("click", () => {
      state.selectedUnitIds.clear();
      renderUnits();
    });

    elBtnLoad.addEventListener("click", async () => {
      try {
        elBtnLoad.disabled = true;
        const words = await loadSelectedWords();
        state.loadedWords = words;
        state.allWrongMap = new Map();
        state.sessionStarted = true;
        startRound(words, 1);
      } catch (err) {
        alert(String(err?.message || err));
      } finally {
        elBtnLoad.disabled = false;
      }
    });

    elBtnShow.addEventListener("click", () => {
      state.transVisible = !state.transVisible;
      elWordTrans.classList.toggle("hidden", !state.transVisible);
    });

    elBtnKnown.addEventListener("click", () => markWord(true));
    elBtnUnknown.addEventListener("click", () => markWord(false));

    elBtnNextRound.addEventListener("click", () => {
      const next = Array.from(state.roundWrongMap.values());
      if (!next.length) return;
      const words = elShuffle.checked ? shuffle(next) : next;
      startRound(words, state.round + 1);
    });

    elBtnRestart.addEventListener("click", () => {
      if (!state.loadedWords.length) return;
      const words = elShuffle.checked ? shuffle(state.loadedWords) : state.loadedWords.slice();
      startRound(words, 1);
    });

    elBtnExport.addEventListener("click", exportWrongWords);

    document.addEventListener("keydown", (e) => {
      const isTyping = e.target && e.target.closest && e.target.closest("input, textarea, select");
      if (isTyping) return;
      if (!state.sessionStarted) return;
      if (elReviewState.classList.contains("hidden")) {
        if (e.key === "Enter" && !elBtnNextRound.disabled) {
          e.preventDefault();
          elBtnNextRound.click();
        }
        return;
      }

      if (e.key === " ") {
        e.preventDefault();
        elBtnShow.click();
      } else if (e.key.toLowerCase() === "a") {
        e.preventDefault();
        elBtnKnown.click();
      } else if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        elBtnUnknown.click();
      }
    });
  }

  async function init() {
    try {
      await loadDictionaryMeta();
      renderDictOptions();
      const dict = currentDict();
      if (dict && Array.isArray(dict.units) && dict.units[0]) {
        state.selectedUnitIds.add(dict.units[0].id);
        renderUnits();
      }
      bindEvents();
      setMode("empty");
    } catch (err) {
      alert(`初始化失败: ${String(err?.message || err)}`);
    }
  }

  init();
})();
