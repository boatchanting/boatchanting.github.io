/** ===========================
 *  德语背单词网页 App（纯原生）
 *  需求函数（必须实现）见下方同名函数
 *  =========================== */

(() => {
  "use strict";

  /** ---------- Constants / Keys ---------- */
  const TZ = "Australia/Sydney";

  const LS_KEYS = {
    settings: "de_vocab_settings",
    progress: "de_vocab_progress_words",
    wrong: "de_vocab_quiz_wrong_words",
    stats: "de_vocab_quiz_stats",
    // daily log: de_vocab_daily_log_YYYY-MM-DD
  };

  const DEFAULT_SETTINGS = {
    goalType: "words",        // "words" | "chunks"
    goalValue: 30,
    lastDate: null,
    lastSelection: { dictId: null, unitIds: [], order: "as-is" },
    shortcutsEnabled: true,
    shortcutsNumberSelect: true
  };

  /** ---------- State ---------- */
  const state = {
    dictMeta: null,
    selectedDictId: null,
    selectedUnitIds: new Set(),
    selectedOrder: "as-is",

    unitsByDict: new Map(),   // dictId -> units[]
    unitsIndex: new Map(),    // unitId -> unit meta {id,name,file,wordCount,...}

    unitWordsCache: new Map(),// unitFile -> word objects

    mergedWords: [],
    chunks: [],
    chunkIndex: 0,
    studySelectedWordKey: null,

    progress: {},             // wordKey -> { learnedAt }
    settings: structuredClone(DEFAULT_SETTINGS),

    quiz: null,               // { mode, words, i, correct, wrong, wrongItems, answered, chunkUID, poolWords, selectionSig, ... }
    view: "study"             // "study" | "quiz" | "wrong" | "settings"
  };

  /** ---------- DOM refs ---------- */
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const elApp = $(".app");

  const elSelDict = $("#sel-dict");
  const elUnits = $("#units");
  const elBtnSelectAll = $("#btn-select-all");
  const elBtnSelectNone = $("#btn-select-none");
  const elBtnLoad = $("#btn-load");
  const elOrder = $("#sel-order");

  const elPillStatus = $("#pill-status");
  const elPillSelected = $("#pill-selected");
  const elPillWords = $("#pill-words");
  const elPillChunks = $("#pill-chunks");
  const elHintFetch = $("#hint-fetch");

  const elViewRoot = $("#view-root");
  const elToastWrap = $("#toast-wrap");

  const elModalImport = $("#modal-import");
  const elImportClose = $("#import-close");
  const elImportCancel = $("#import-cancel");
  const elImportConfirm = $("#import-confirm");
  const elImportFile = $("#import-file");

  /** ---------- Utilities ---------- */
  function formatSydneyDate(d = new Date()) {
    // YYYY-MM-DD in Australia/Sydney
    // Using Intl for stable format
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(d);
    const get = (type) => parts.find(p => p.type === type)?.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  }
  function dailyLogKey(dateStr) {
    return `de_vocab_daily_log_${dateStr}`;
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

  function toast(title, message="", tone="default") {
    const node = document.createElement("div");
    node.className = "toast";
    const pill = tone === "ok" ? "ok" : tone === "bad" ? "bad" : tone === "warn" ? "warn" : "";
    node.innerHTML = `
      <div style="min-width:0">
        <p class="t">${escapeHtml(title)} ${pill ? `<span class="pill ${pill}" style="margin-left:8px">${pill==="ok"?"OK":pill==="bad"?"错误":"提示"}</span>` : ""}</p>
        ${message ? `<p class="m">${escapeHtml(message)}</p>` : ""}
      </div>
      <button class="x" aria-label="关闭">✕</button>
    `;
    node.querySelector(".x").addEventListener("click", () => node.remove());
    elToastWrap.appendChild(node);
    setTimeout(() => { if (node.isConnected) node.remove(); }, 4200);
  }

  function hashString(str) {
    // small non-crypto hash for stable ids
    let h1 = 0x811c9dc5;
    for (let i=0; i<str.length; i++){
      h1 ^= str.charCodeAt(i);
      h1 = (h1 + ((h1<<1)+(h1<<4)+(h1<<7)+(h1<<8)+(h1<<24))) >>> 0;
    }
    return ("0000000" + (h1 >>> 0).toString(16)).slice(-8);
  }

  function wordKeyOf(word) {
    const t = Array.isArray(word.trans) ? word.trans.join("\n") : String(word.trans ?? "");
    return "w_" + hashString(`${word.name}\n${t}`.trim());
  }

  function displayTrans(word) {
    const arr = Array.isArray(word.trans) ? word.trans : [String(word.trans ?? "")];
    const cleaned = arr.map(s => String(s).trim()).filter(Boolean);
    return cleaned.length ? cleaned.join(" / ") : "（无释义）";
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i=a.length-1; i>0; i--) {
      const j = Math.floor(Math.random()*(i+1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function uniqBy(arr, keyFn) {
    const seen = new Set();
    const out = [];
    for (const x of arr) {
      const k = keyFn(x);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(x);
    }
    return out;
  }

  /** ---------- Storage API (required) ---------- */
  function saveSetting() {
    writeJSON(LS_KEYS.settings, state.settings);
  }
  function loadSetting() {
    const s = readJSON(LS_KEYS.settings, structuredClone(DEFAULT_SETTINGS));
    state.settings = Object.assign(structuredClone(DEFAULT_SETTINGS), s || {});
    if (!state.settings.lastSelection) state.settings.lastSelection = structuredClone(DEFAULT_SETTINGS.lastSelection);
    state.settings.shortcutsEnabled = state.settings.shortcutsEnabled !== false;
    state.settings.shortcutsNumberSelect = state.settings.shortcutsNumberSelect !== false;
    return state.settings;
  }
  function saveProgress() {
    writeJSON(LS_KEYS.progress, state.progress);
  }
  function loadProgress() {
    state.progress = readJSON(LS_KEYS.progress, {});
    if (!state.progress || typeof state.progress !== "object") state.progress = {};
    return state.progress;
  }

  function ensureDailyLog() {
    const today = formatSydneyDate();
    if (state.settings.lastDate !== today) {
      state.settings.lastDate = today;
      saveSetting();
      // create daily log if not present
      const key = dailyLogKey(today);
      const existing = readJSON(key, null);
      if (!existing) {
        const fresh = {
          date: today,
          goalType: state.settings.goalType,
          goalValue: state.settings.goalValue,
          learnedWordsCount: 0,
          learnedChunksCount: 0,
          learnedWordKeys: [],
          chunksCompleted: {}, // chunkUID -> ts
          createdAt: Date.now()
        };
        writeJSON(key, fresh);
      }
    } else {
      // still ensure today's exists
      const key = dailyLogKey(today);
      if (!readJSON(key, null)) {
        writeJSON(key, {
          date: today,
          goalType: state.settings.goalType,
          goalValue: state.settings.goalValue,
          learnedWordsCount: 0,
          learnedChunksCount: 0,
          learnedWordKeys: [],
          chunksCompleted: {},
          createdAt: Date.now()
        });
      }
    }
  }

  function readTodayLog() {
    const today = formatSydneyDate();
    return readJSON(dailyLogKey(today), {
      date: today,
      goalType: state.settings.goalType,
      goalValue: state.settings.goalValue,
      learnedWordsCount: 0,
      learnedChunksCount: 0,
      learnedWordKeys: [],
      chunksCompleted: {},
      createdAt: Date.now()
    });
  }
  function writeTodayLog(log) {
    writeJSON(dailyLogKey(formatSydneyDate()), log);
  }

  /** ---------- Data loading (required) ---------- */
  async function loadDictionary() {
    // MUST fetch()
    try {
      const res = await fetch("dictionary.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.dictMeta = data;
      elHintFetch.style.display = "none";
      return data;
    } catch (e) {
      elHintFetch.style.display = "block";
      toast("无法读取 dictionary.json", String(e?.message || e), "bad");
      throw e;
    }
  }

  async function loadUnitWords(unitFile) {
    // MUST fetch()
    if (state.unitWordsCache.has(unitFile)) return state.unitWordsCache.get(unitFile);
    try {
      const res = await fetch(unitFile, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = await res.json();
      if (!Array.isArray(arr)) throw new Error("单元 JSON 格式应为数组");
      const mapped = arr.map((w, idx) => ({
        name: String(w.name ?? "").trim(),
        trans: Array.isArray(w.trans) ? w.trans.map(x => String(x)) : [String(w.trans ?? "")],
        _idx: idx
      })).filter(w => w.name);
      state.unitWordsCache.set(unitFile, mapped);
      elHintFetch.style.display = "none";
      return mapped;
    } catch (e) {
      elHintFetch.style.display = "block";
      toast(`无法读取 ${unitFile}`, String(e?.message || e), "bad");
      throw e;
    }
  }

  async function mergeWords() {
    // Merge selected units into state.mergedWords (de-dup by wordKey)
    const dict = getSelectedDict();
    if (!dict) {
      state.mergedWords = [];
      return [];
    }
    const unitMetas = dict.units.filter(u => state.selectedUnitIds.has(u.id));
    const all = [];
    for (const u of unitMetas) {
      const words = await loadUnitWords(u.file);
      for (const w of words) {
        const word = {
          name: w.name,
          trans: w.trans,
          unitId: u.id,
          unitName: u.name || u.id,
          file: u.file
        };
        word.wordKey = wordKeyOf(word);
        all.push(word);
      }
    }
    // de-dup, keep first occurrence (preserve order)
    let merged = [];
    const seen = new Set();
    for (const w of all) {
      if (seen.has(w.wordKey)) continue;
      seen.add(w.wordKey);
      merged.push(w);
    }

    // apply ordering
    const order = state.selectedOrder;
    if (order === "az") {
      merged = merged.slice().sort((a,b) => a.name.localeCompare(b.name, "de"));
    } else if (order === "za") {
      merged = merged.slice().sort((a,b) => b.name.localeCompare(a.name, "de"));
    } else if (order === "shuffle") {
      merged = shuffle(merged);
    }

    state.mergedWords = merged;

    const chunks = createChunks(merged, 15);
    state.chunks = chunks;
    state.chunkIndex = 0;

    updateSidebarPills();
    elPillStatus.textContent = merged.length ? "已加载" : "未加载";
    elPillStatus.className = "pill " + (merged.length ? "ok" : "");

    return merged;
  }

  /** ---------- Chunk (required) ---------- */
  function createChunks(wordList, size=15) {
    const chunks = [];
    for (let i=0; i<wordList.length; i+=size) {
      chunks.push(wordList.slice(i, i+size));
    }
    return chunks;
  }

  function getSelectedDict() {
    if (!state.dictMeta?.dictionaries?.length) return null;
    return state.dictMeta.dictionaries.find(d => d.id === state.selectedDictId) || null;
  }

  function selectionSignature() {
    const units = Array.from(state.selectedUnitIds).sort();
    return `${state.selectedDictId || "?"}::${units.join("+") || "none"}::${state.selectedOrder}`;
  }

  function chunkUIDFor(chunkIndex, chunkWords) {
    const sig = selectionSignature();
    const body = chunkWords.map(w => w.wordKey).join("|");
    return `${sig}::chunk${chunkIndex+1}::${hashString(body)}`;
  }

  function isDesktopShortcutEnv() {
    if (typeof window === "undefined") return false;
    if (typeof window.matchMedia !== "function") return true;
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }

  function isTypingTarget(target) {
    const el = target instanceof Element ? target : null;
    if (!el) return false;
    if (el.closest('input, textarea, select, [contenteditable="true"]')) return true;
    return false;
  }

  function parseStudyDigitIndex(e) {
    // 1..9 => word 1..9, 0 => word 10, Shift+1..5 => word 11..15
    if (e.code.startsWith("Numpad")) {
      const n = Number(e.code.slice("Numpad".length));
      if (!Number.isInteger(n) || n < 0 || n > 9) return null;
      return n === 0 ? 10 : n;
    }
    if (!e.code.startsWith("Digit")) return null;
    const n = Number(e.code.slice("Digit".length));
    if (!Number.isInteger(n) || n < 0 || n > 9) return null;
    if (e.shiftKey) {
      if (n >= 1 && n <= 5) return n + 10;
      return null;
    }
    return n === 0 ? 10 : n;
  }

  function setSelectedStudyWord(wordKey) {
    state.studySelectedWordKey = wordKey || null;
    $$(".word-card", elViewRoot).forEach(card => {
      card.classList.toggle("shortcut-selected", !!wordKey && card.dataset.wordkey === wordKey);
    });
  }

  function getSelectedStudyWord() {
    const chunk = state.chunks[state.chunkIndex] || [];
    return chunk.find(w => w.wordKey === state.studySelectedWordKey) || null;
  }

  function selectStudyWordByIndex(index, { open=true, scroll=true } = {}) {
    const cards = $$(".word-card", elViewRoot);
    if (!cards.length || index < 0 || index >= cards.length) return false;
    const card = cards[index];
    const key = card.dataset.wordkey || null;
    if (!key) return false;
    setSelectedStudyWord(key);

    if (open) {
      card.classList.add("open");
      const top = $(".word-top", card);
      if (top) top.setAttribute("aria-expanded", "true");
    }
    if (scroll) {
      card.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
    return true;
  }

  function markSelectedStudyWordAsWrong() {
    const word = getSelectedStudyWord();
    if (!word) return false;
    addWrongWords([word], { source: "study" });
    toast("已加入错词本", word.name, "warn");
    renderChunk();
    return true;
  }

  function handleStudyShortcuts(e) {
    if (!state.settings.shortcutsEnabled) return;
    if (state.settings.shortcutsNumberSelect) {
      const idx = parseStudyDigitIndex(e);
      if (idx !== null) {
        if (selectStudyWordByIndex(idx - 1)) e.preventDefault();
        return;
      }
    }

    if (e.repeat) return;
    const key = e.key.toLowerCase();
    if (key === "l") {
      const word = getSelectedStudyWord();
      if (!word) return;
      e.preventDefault();
      markWordLearned(word.wordKey);
      return;
    }
    if (key === "w") {
      if (markSelectedStudyWordAsWrong()) e.preventDefault();
      return;
    }
    if (key === "[") {
      const btn = $("#btn-prev-chunk", elViewRoot);
      if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
      return;
    }
    if (key === "]") {
      const btn = $("#btn-next-chunk", elViewRoot);
      if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
      return;
    }
    if (key === "q") {
      const btn = $("#btn-start-quiz", elViewRoot);
      if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
      return;
    }
  }

  function handleQuizShortcuts(e) {
    if (!state.settings.shortcutsEnabled) return;
    const choices = $$(".choice", elViewRoot);

    // 1..6 answer selection
    if (choices.length) {
      let idx = null;
      if (e.code.startsWith("Digit") || e.code.startsWith("Numpad")) {
        const raw = Number(e.code.replace("Digit", "").replace("Numpad", ""));
        if (Number.isInteger(raw) && raw >= 1 && raw <= 6) idx = raw - 1;
      }
      if (idx !== null) {
        const btn = choices[idx];
        if (btn && !btn.disabled) {
          e.preventDefault();
          btn.click();
          return;
        }
      }
    }

    if (e.key === "Enter") {
      const btnNext = $("#btn-next-q", elViewRoot);
      if (btnNext && !btnNext.disabled) {
        e.preventDefault();
        btnNext.click();
      }
      return;
    }
    if (e.key === "Escape") {
      const btnQuit = $("#btn-quit-quiz", elViewRoot);
      if (btnQuit && !btnQuit.disabled) {
        e.preventDefault();
        btnQuit.click();
      }
    }
  }

  function handleGlobalShortcuts(e) {
    if (!isDesktopShortcutEnv()) return;
    if (!state.settings.shortcutsEnabled) return;
    if (elModalImport.classList.contains("open")) return;
    if (isTypingTarget(e.target)) return;

    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const map = { "1": "study", "2": "quiz", "3": "wrong", "4": "settings" };
      const v = map[e.key];
      if (v) {
        e.preventDefault();
        setView(v);
      }
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (state.view === "study") handleStudyShortcuts(e);
    else if (state.view === "quiz") handleQuizShortcuts(e);
  }

  /** ---------- Study view (required) ---------- */
  function renderWordCard(word) {
    const learned = !!state.progress[word.wordKey];
    const wrongMap = readJSON(LS_KEYS.wrong, {});
    const isWrong = !!wrongMap?.[word.wordKey];

    const card = document.createElement("div");
    card.className = "word-card";
    card.dataset.wordkey = word.wordKey;

    card.innerHTML = `
      <div class="word-top" role="button" tabindex="0" aria-expanded="false" title="点击展开/收起释义">
        <div class="word-de">${escapeHtml(word.name)}</div>
        <div class="word-tags">
          ${learned ? `<span class="tag learned">已掌握</span>` : ``}
          ${isWrong ? `<span class="tag wrong">错词本</span>` : ``}
          <span class="tag">${escapeHtml(word.unitId)}</span>
        </div>
      </div>
      <div class="word-trans">
        ${escapeHtml(displayTrans(word))}
      </div>
      <div class="word-actions">
        <button class="btn-small btn-learned" data-act="learn" ${learned ? "disabled" : ""}>${learned ? "✓ 已掌握" : "已掌握"}</button>
        <button class="btn-small btn-danger" data-act="mark-wrong">标记错词</button>
      </div>
    `;

    const top = card.querySelector(".word-top");
    const toggle = () => {
      const open = card.classList.toggle("open");
      top.setAttribute("aria-expanded", open ? "true" : "false");
    };
    top.addEventListener("click", toggle);
    top.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });

    card.addEventListener("click", (e) => {
      setSelectedStudyWord(word.wordKey);
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      const k = word.wordKey;
      if (act === "learn") {
        markWordLearned(k);
      } else if (act === "mark-wrong") {
        markSelectedStudyWordAsWrong();
      }
      e.stopPropagation();
    });

    return card;
  }

  function markWordLearned(wordKey) {
    if (state.progress[wordKey]) return; // no undo (keeps daily stats consistent)
    state.progress[wordKey] = { learnedAt: Date.now() };
    saveProgress();

    // daily log
    const log = readTodayLog();
    if (!log.learnedWordKeys.includes(wordKey)) {
      log.learnedWordKeys.push(wordKey);
      log.learnedWordsCount = log.learnedWordKeys.length;
      writeTodayLog(log);
    }

    // if chunk fully learned -> mark chunk completed in daily log + auto start quiz
    const chunk = state.chunks[state.chunkIndex] || [];
    const allLearned = chunk.length > 0 && chunk.every(w => !!state.progress[w.wordKey]);
    if (allLearned) {
      const uid = chunkUIDFor(state.chunkIndex, chunk);
      if (!log.chunksCompleted[uid]) {
        log.chunksCompleted[uid] = Date.now();
        log.learnedChunksCount = Object.keys(log.chunksCompleted).length;
        writeTodayLog(log);
      }
      updateSidebarPills();
      renderChunk(); // refresh UI first
      toast("本块完成 ✅", "将自动进入测验（模式A → 模式B）", "ok");
      // Auto enter quiz
      setTimeout(() => startChunkQuiz(), 450);
      return;
    }

    updateSidebarPills();
    renderChunk();
  }

  function renderChunk() {
    const totalChunks = state.chunks.length;
    if (!totalChunks) {
      state.studySelectedWordKey = null;
      elViewRoot.innerHTML = `
        <div class="view">
          <div class="view-title">
            <div>
              <h1>学习</h1>
              <div class="pill">请选择词库与单元，然后点击「加载所选单元」</div>
            </div>
          </div>
          <div class="hint">
            你可以：<br/>
            1) 左侧勾选一个或多个单元（会合并单词）<br/>
            2) 每 15 个单词划分为一个词块（Chunk）<br/>
            3) 每学完一个词块（本块 15 词都点“已掌握”）会自动进入测验（A+B）<br/>
          </div>
        </div>
      `;
      return;
    }

    const idx = state.chunkIndex;
    const chunk = state.chunks[idx];
    const learnedCountInChunk = chunk.filter(w => !!state.progress[w.wordKey]).length;
    const chunkDone = learnedCountInChunk === chunk.length;

    const today = readTodayLog();
    const goalType = state.settings.goalType;
    const goalValue = Math.max(1, Number(state.settings.goalValue) || 1);
    const cur = goalType === "words" ? (today.learnedWordsCount || 0) : (today.learnedChunksCount || 0);
    const pct = Math.min(100, Math.round((cur / goalValue) * 100));

    const chunkUID = chunkUIDFor(idx, chunk);

    elViewRoot.innerHTML = `
      <div class="view">
        <div class="view-title">
          <div>
            <h1>学习 · 词块 ${idx+1} / ${totalChunks}</h1>
            <div class="row" style="margin-top:6px">
              <span class="pill">${escapeHtml(selectionSignature())}</span>
              <span class="pill ${chunkDone ? "ok" : ""}">本块已掌握 ${learnedCountInChunk}/${chunk.length}</span>
              <span class="pill">本块ID：${escapeHtml(chunkUID.slice(0, 22))}…</span>
            </div>
          </div>
          <div class="meta">
            <button id="btn-prev-chunk" ${idx===0 ? "disabled" : ""}>上一块</button>
            <button id="btn-next-chunk" ${idx===totalChunks-1 ? "disabled" : ""}>下一块</button>
            <div class="row" style="gap:8px">
              <input id="inp-jump" type="number" min="1" max="${totalChunks}" value="${idx+1}" style="width:86px" />
              <button id="btn-jump">跳转</button>
            </div>
          </div>
        </div>

        <div class="panel" style="border:none; box-shadow:none; background:transparent">
          <div class="row" style="justify-content:space-between; align-items:flex-end; gap:12px">
            <div style="flex:1; min-width:240px">
              <div class="row" style="justify-content:space-between; margin-bottom:8px">
                <span class="pill">今日目标：${escapeHtml(goalType==="words" ? "词数" : "词块")} × ${goalValue}</span>
                <span class="pill ${pct>=100 ? "ok" : ""}">今日进度：${cur}/${goalValue}（${pct}%）</span>
              </div>
              <div class="progress" aria-label="今日打卡进度条"><div style="width:${pct}%"></div></div>
            </div>
            <div class="row" style="justify-content:flex-end">
              <button id="btn-start-quiz" class="btn-primary">开始测验（A+B）</button>
              <button id="btn-finish-chunk" class="${chunkDone ? "btn-primary" : ""}">完成本块学习</button>
            </div>
          </div>

          <div class="divider"></div>

          <div class="words" id="words"></div>
        </div>
      </div>
    `;

    const wordsWrap = $("#words", elViewRoot);
    const frag = document.createDocumentFragment();
    for (const w of chunk) frag.appendChild(renderWordCard(w));
    wordsWrap.appendChild(frag);
    if (!chunk.some(w => w.wordKey === state.studySelectedWordKey)) {
      state.studySelectedWordKey = chunk[0]?.wordKey || null;
    }
    setSelectedStudyWord(state.studySelectedWordKey);

    $("#btn-prev-chunk", elViewRoot).addEventListener("click", () => { state.chunkIndex--; renderChunk(); });
    $("#btn-next-chunk", elViewRoot).addEventListener("click", () => { state.chunkIndex++; renderChunk(); });
    $("#btn-jump", elViewRoot).addEventListener("click", () => {
      const v = Number($("#inp-jump", elViewRoot).value || 1);
      const n = Math.max(1, Math.min(totalChunks, v));
      state.chunkIndex = n - 1;
      renderChunk();
    });

    $("#btn-start-quiz", elViewRoot).addEventListener("click", () => startChunkQuiz());
    $("#btn-finish-chunk", elViewRoot).addEventListener("click", () => {
      // Consider this as "学完一个词块" → start quiz, even if not all marked learned
      toast("进入测验", "模式A（德→中）结束后自动进入模式B（中→德）", "ok");
      startChunkQuiz();
    });
  }

  /** ---------- Quiz (required) ---------- */
  function startChunkQuiz() {
    const chunk = state.chunks[state.chunkIndex] || [];
    if (!chunk.length) return;
    const uid = chunkUIDFor(state.chunkIndex, chunk);

    // pool words used as distractors: prefer whole merged list
    const pool = (state.mergedWords && state.mergedWords.length) ? state.mergedWords : chunk;

    state.quiz = {
      mode: "A",                 // A: de->zh, B: zh->de
      words: chunk.slice(),
      i: 0,
      correct: 0,
      wrong: 0,
      wrongItems: [],            // {wordKey, name, trans, mode}
      answered: false,
      chunkUID: uid,
      poolWords: pool.slice(),
      selectionSig: selectionSignature(),
      lastAnswer: null
    };

    setView("quiz");
    startQuizModeA();
  }

  function startQuizModeA() {
    if (!state.quiz) return;
    state.quiz.mode = "A";
    state.quiz.i = 0;
    state.quiz.answered = false;
    state.quiz.lastAnswer = null;
    renderQuizPage();
  }

  function startQuizModeB() {
    if (!state.quiz) return;
    state.quiz.mode = "B";
    state.quiz.i = 0;
    state.quiz.answered = false;
    state.quiz.lastAnswer = null;
    renderQuizPage();
  }

  function generateChoices(questionWord, mode) {
    // mode A: de -> zh options
    // mode B: zh -> de options
    const pool = state.quiz?.poolWords || state.mergedWords || [];
    const correct = (mode === "A")
      ? displayTrans(questionWord)
      : questionWord.name;

    let optionPool = [];
    if (mode === "A") {
      optionPool = pool.map(w => displayTrans(w));
    } else {
      optionPool = pool.map(w => w.name);
    }
    optionPool = optionPool.map(s => String(s).trim()).filter(Boolean);

    // de-dup with correct included
    const uniquePool = Array.from(new Set(optionPool));
    const distractors = uniquePool.filter(x => x !== correct);

    const picked = shuffle(distractors).slice(0, 5);
    const choices = shuffle([correct, ...picked]);

    // Ensure exactly 6 displayed (pad with disabled dummy)
    while (choices.length < 6) choices.push("（无更多选项）");
    return { correct, choices };
  }

  function renderQuizPage() {
    if (!state.quiz) {
      elViewRoot.innerHTML = `
        <div class="view">
          <div class="view-title">
            <div>
              <h1>测验</h1>
              <div class="pill">当前没有进行中的测验。请先在「学习」中加载单元并进入词块。</div>
            </div>
          </div>
        </div>
      `;
      return;
    }

    const q = state.quiz;
    const total = q.words.length;
    const curWord = q.words[q.i];
    const mode = q.mode;

    const modeName = mode === "A" ? "模式 A：德语 → 中文（6选1）" : "模式 B：中文 → 德语（6选1）";
    const prompt = mode === "A" ? curWord.name : displayTrans(curWord);

    const { correct, choices } = generateChoices(curWord, mode);

    elViewRoot.innerHTML = `
      <div class="view">
        <div class="view-title">
          <div>
            <h1>测验 · ${escapeHtml(modeName)}</h1>
            <div class="row" style="margin-top:6px">
              <span class="pill">题目 ${q.i+1} / ${total}</span>
              <span class="pill">当前词块：${escapeHtml(q.chunkUID.slice(0, 22))}…</span>
              <span class="pill ${q.wrong ? "warn" : ""}">正确 ${q.correct} · 错误 ${q.wrong}</span>
            </div>
          </div>
          <div class="meta">
            <button id="btn-quit-quiz">退出测验</button>
          </div>
        </div>

        <div class="quiz-wrap">
          <div class="quiz-card">
            <div class="quiz-head">
              <div>
                <div class="title">请选出正确答案</div>
                <div class="small">点击选项立即判分（显示对/错），然后进入下一题。</div>
              </div>
              <div class="row">
                <span class="pill">${mode === "A" ? "题干：德语" : "题干：中文"}</span>
                <span class="pill">${mode === "A" ? "选项：中文释义" : "选项：德语单词"}</span>
              </div>
            </div>

            <div class="quiz-prompt">${escapeHtml(prompt)}</div>

            <div class="choices" id="choices">
              ${choices.map((c, i) => `
                <button class="choice" data-choice="${escapeHtml(c)}" data-idx="${i}">
                  <span class="idx">${i+1}</span>
                  <span>${escapeHtml(c)}</span>
                </button>
              `).join("")}
            </div>

            <div class="row" style="margin-top:12px; justify-content:flex-end">
              <button id="btn-next-q" disabled>下一题</button>
            </div>
          </div>
        </div>
      </div>
    `;

    $("#btn-quit-quiz", elViewRoot).addEventListener("click", () => {
      state.quiz = null;
      toast("已退出测验", "你可以回到学习区继续。", "warn");
      setView("study");
    });

    const choicesWrap = $("#choices", elViewRoot);
    const btnNext = $("#btn-next-q", elViewRoot);

    const lockChoices = () => {
      $$(".choice", choicesWrap).forEach(b => b.disabled = true);
    };

    const markResult = (chosen) => {
      const all = $$(".choice", choicesWrap);
      all.forEach(btn => {
        const val = btn.getAttribute("data-choice");
        if (val === "（无更多选项）") {
          btn.classList.add("disabled");
          btn.disabled = true;
        }
      });

      // highlight correct / wrong
      all.forEach(btn => {
        const val = btn.getAttribute("data-choice");
        if (val === correct) btn.classList.add("correct");
        if (val === chosen && chosen !== correct) btn.classList.add("wrong");
      });
    };

    const goNext = () => {
      if (!state.quiz) return;
      state.quiz.answered = false;
      state.quiz.lastAnswer = null;
      state.quiz.i++;

      if (state.quiz.i >= total) {
        // mode A -> mode B, mode B -> summary
        if (state.quiz.mode === "A") {
          toast("模式 A 完成", "自动进入模式 B（中文→德语）", "ok");
          startQuizModeB();
        } else {
          renderQuizSummary();
        }
        return;
      }
      renderQuizPage();
    };

    btnNext.addEventListener("click", goNext);

    choicesWrap.addEventListener("click", (e) => {
      const btn = e.target.closest(".choice");
      if (!btn || btn.disabled) return;
      if (state.quiz.answered) return;
      const chosen = btn.getAttribute("data-choice");

      // ignore dummy choice
      if (chosen === "（无更多选项）") return;

      state.quiz.answered = true;
      state.quiz.lastAnswer = { chosen, correct };

      // scoring
      const isCorrect = chosen === correct;
      if (isCorrect) state.quiz.correct++;
      else {
        state.quiz.wrong++;
        state.quiz.wrongItems.push({
          wordKey: curWord.wordKey,
          name: curWord.name,
          trans: curWord.trans,
          mode: state.quiz.mode
        });
      }

      lockChoices();
      markResult(chosen);
      btnNext.disabled = false;

      // auto-next after a short delay
      setTimeout(() => { if ($("#btn-next-q", elViewRoot)) goNext(); }, 650);
    });
  }

  function renderQuizSummary() {
    if (!state.quiz) return;

    const q = state.quiz;
    const total = q.words.length * 2; // A + B total questions (conceptually)
    const answered = q.correct + q.wrong;

    // persist chunk stats
    const stats = readJSON(LS_KEYS.stats, {});
    const prev = stats[q.chunkUID] || { attempts: 0, bestCorrect: 0, lastCorrect: 0, lastAt: null };
    const curCorrect = q.correct;
    const updated = {
      attempts: (prev.attempts || 0) + 1,
      bestCorrect: Math.max(prev.bestCorrect || 0, curCorrect),
      lastCorrect: curCorrect,
      lastAt: Date.now(),
      selectionSig: q.selectionSig
    };
    stats[q.chunkUID] = updated;
    writeJSON(LS_KEYS.stats, stats);

    const uniqueWrong = uniqBy(q.wrongItems, x => x.wordKey);

    elViewRoot.innerHTML = `
      <div class="view">
        <div class="view-title">
          <div>
            <h1>测验总结</h1>
            <div class="row" style="margin-top:6px">
              <span class="pill ok">正确：${q.correct}</span>
              <span class="pill ${q.wrong ? "warn" : "ok"}">错误：${q.wrong}</span>
              <span class="pill">本次作答：${answered}（A+B）</span>
            </div>
          </div>
          <div class="meta">
            <button id="btn-back-study">返回学习</button>
          </div>
        </div>

        <div class="quiz-card">
          <div class="row" style="justify-content:space-between; gap:10px">
            <div class="row">
              <span class="pill">词块：${escapeHtml(q.chunkUID.slice(0, 22))}…</span>
              <span class="pill">统计：第 ${updated.attempts} 次测验 · 最佳正确 ${updated.bestCorrect}</span>
            </div>
            <div class="row" style="justify-content:flex-end">
              <button id="btn-retry">重新测验</button>
              <button id="btn-next-chunk" ${state.chunkIndex >= state.chunks.length-1 ? "disabled" : ""}>下一词块</button>
              <button id="btn-add-wrong" class="btn-danger" ${uniqueWrong.length ? "" : "disabled"}>加入错词本</button>
            </div>
          </div>

          <div class="divider"></div>

          <div class="row" style="justify-content:space-between">
            <div><b>错题列表</b> <span class="pill">${uniqueWrong.length} 个词</span></div>
            <div class="pill">提示：可在「错词本」中进行专项测验（A+B）</div>
          </div>

          <div class="summary-list" id="wrong-list">
            ${uniqueWrong.length ? uniqueWrong.map(it => `
              <div class="summary-item">
                <div class="a">
                  <div class="de">${escapeHtml(it.name)}</div>
                  <div class="zh">${escapeHtml(displayTrans(it))}</div>
                </div>
                <span class="pill ${it.mode==="A" ? "warn" : ""}">${it.mode==="A" ? "错于A" : "错于B"}</span>
              </div>
            `).join("") : `<div class="hint">没有错题！你太强了。可以直接进入下一词块继续学习。</div>`}
          </div>
        </div>
      </div>
    `;

    $("#btn-back-study", elViewRoot).addEventListener("click", () => {
      state.quiz = null;
      setView("study");
    });
    $("#btn-retry", elViewRoot).addEventListener("click", () => {
      // restart same chunk quiz
      const words = (state.chunks[state.chunkIndex] || []).slice();
      const uid = chunkUIDFor(state.chunkIndex, words);
      state.quiz = {
        mode: "A",
        words,
        i: 0,
        correct: 0,
        wrong: 0,
        wrongItems: [],
        answered: false,
        chunkUID: uid,
        poolWords: (state.mergedWords && state.mergedWords.length) ? state.mergedWords.slice() : words,
        selectionSig: selectionSignature(),
        lastAnswer: null
      };
      startQuizModeA();
    });
    $("#btn-next-chunk", elViewRoot).addEventListener("click", () => {
      state.quiz = null;
      if (state.chunkIndex < state.chunks.length-1) state.chunkIndex++;
      setView("study");
    });
    $("#btn-add-wrong", elViewRoot).addEventListener("click", () => {
      addWrongWords(uniqueWrong, { source: "quiz" });
      toast("已加入错词本", `共 ${uniqueWrong.length} 个词`, "ok");
      // keep summary but update buttons
      renderQuizSummary();
    });
  }

  function addWrongWords(words, { source="quiz" } = {}) {
    const wrongMap = readJSON(LS_KEYS.wrong, {});
    for (const w of words) {
      const k = w.wordKey || wordKeyOf(w);
      const prev = wrongMap[k] || null;
      wrongMap[k] = {
        wordKey: k,
        name: w.name,
        trans: Array.isArray(w.trans) ? w.trans : [String(w.trans ?? "")],
        wrongCount: (prev?.wrongCount || 0) + 1,
        lastWrongAt: Date.now(),
        source
      };
    }
    writeJSON(LS_KEYS.wrong, wrongMap);
  }

  /** ---------- Wrong words (required) ---------- */
  function renderWrongWords() {
    const wrongMap = readJSON(LS_KEYS.wrong, {});
    const entries = Object.values(wrongMap || {}).sort((a,b) => (b.lastWrongAt||0) - (a.lastWrongAt||0));

    elViewRoot.innerHTML = `
      <div class="view">
        <div class="view-title">
          <div>
            <h1>错词本</h1>
            <div class="row" style="margin-top:6px">
              <span class="pill ${entries.length ? "warn" : "ok"}">共 ${entries.length} 个错词</span>
              <span class="pill">localStorage：<span style="font-family:var(--mono)">${escapeHtml(LS_KEYS.wrong)}</span></span>
            </div>
          </div>
          <div class="meta">
            <input id="wrong-search" type="text" placeholder="搜索：德语 / 中文" style="width:220px" />
            <button id="btn-wrong-quiz" class="btn-primary" ${entries.length ? "" : "disabled"}>错词专项测验（A+B）</button>
            <button id="btn-wrong-clear" class="btn-danger" ${entries.length ? "" : "disabled"}>清空错词本</button>
          </div>
        </div>

        <div class="list" id="wrong-list">
          ${entries.length ? entries.map(it => `
            <div class="list-item" data-k="${escapeHtml(it.wordKey)}">
              <div class="info">
                <div class="de">${escapeHtml(it.name)}</div>
                <div class="zh">${escapeHtml((it.trans||[]).join(" / "))}</div>
                <div class="meta">
                  <span class="kpi">错次数：${it.wrongCount || 0}</span>
                  <span class="kpi">最近：${it.lastWrongAt ? new Date(it.lastWrongAt).toLocaleString() : "—"}</span>
                  <span class="kpi">来源：${escapeHtml(it.source || "—")}</span>
                </div>
              </div>
              <div class="row" style="justify-content:flex-end">
                <button class="btn-small btn-danger" data-act="del">删除</button>
              </div>
            </div>
          `).join("") : `<div class="hint">暂无错词。你可以在测验总结页点击「加入错词本」，或在学习卡片里「标记错词」。</div>`}
        </div>
      </div>
    `;

    const list = $("#wrong-list", elViewRoot);
    const inp = $("#wrong-search", elViewRoot);

    list.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const item = e.target.closest(".list-item");
      if (!item) return;
      const k = item.dataset.k;
      const map = readJSON(LS_KEYS.wrong, {});
      delete map[k];
      writeJSON(LS_KEYS.wrong, map);
      toast("已删除错词", k, "ok");
      renderWrongWords();
    });

    inp.addEventListener("input", () => {
      const q = inp.value.trim().toLowerCase();
      $$(".list-item", list).forEach(it => {
        const de = it.querySelector(".de")?.textContent?.toLowerCase() || "";
        const zh = it.querySelector(".zh")?.textContent?.toLowerCase() || "";
        it.style.display = (!q || de.includes(q) || zh.includes(q)) ? "" : "none";
      });
    });

    $("#btn-wrong-clear", elViewRoot).addEventListener("click", () => {
      if (!confirm("确定清空错词本吗？此操作不可撤销。")) return;
      writeJSON(LS_KEYS.wrong, {});
      toast("已清空错词本", "", "ok");
      renderWrongWords();
    });

    $("#btn-wrong-quiz", elViewRoot).addEventListener("click", () => startWrongWordsQuiz());
  }

  function startWrongWordsQuiz() {
    const wrongMap = readJSON(LS_KEYS.wrong, {});
    const wrongWords = Object.values(wrongMap || {}).map(it => ({
      wordKey: it.wordKey,
      name: it.name,
      trans: it.trans
    }));

    if (!wrongWords.length) {
      toast("错词本为空", "先加入一些错词再来测验吧。", "warn");
      return;
    }

    // For wrong quiz, pool should include wrongWords + current mergedWords if available to create decent distractors
    const pool = uniqBy([...(state.mergedWords||[]), ...wrongWords], w => (w.wordKey || wordKeyOf(w)));

    // We quiz by chunks of 15 wrong words; start from first chunk
    const chunks = createChunks(wrongWords, 15);
    const idx = 0;
    const chunk = chunks[idx];

    state.quiz = {
      mode: "A",
      words: chunk.slice(),
      i: 0,
      correct: 0,
      wrong: 0,
      wrongItems: [],
      answered: false,
      chunkUID: `wrongbook::chunk${idx+1}::${hashString(chunk.map(w => w.wordKey).join("|"))}`,
      poolWords: pool.slice(),
      selectionSig: "wrongbook",
      lastAnswer: null,
      _wrongbook: { all: wrongWords, chunks, chunkIndex: idx }
    };

    setView("quiz");
    startQuizModeA();
  }

  /** ---------- Settings / Punch-in (required: settings+daily log) ---------- */
  function renderSettings() {
    const today = readTodayLog();
    const goalType = state.settings.goalType;
    const goalValue = Math.max(1, Number(state.settings.goalValue) || 1);
    const shortcutsEnabled = state.settings.shortcutsEnabled !== false;
    const shortcutsNumberSelect = state.settings.shortcutsNumberSelect !== false;

    const cur = goalType === "words" ? (today.learnedWordsCount || 0) : (today.learnedChunksCount || 0);
    const pct = Math.min(100, Math.round((cur / goalValue) * 100));
    const done = pct >= 100;

    const stats = readJSON(LS_KEYS.stats, {});
    const statsCount = Object.keys(stats || {}).length;
    const wrongMap = readJSON(LS_KEYS.wrong, {});
    const wrongCount = Object.keys(wrongMap || {}).length;
    const progressCount = Object.keys(state.progress || {}).length;

    elViewRoot.innerHTML = `
      <div class="view settings-view">
        <div class="view-title">
          <div>
            <h1>设置 / 打卡</h1>
            <div class="row" style="margin-top:6px">
              <span class="pill">今日：${escapeHtml(today.date)}</span>
              <span class="pill ${done ? "ok" : ""}">打卡：${done ? "已完成 ✅" : "未完成"}</span>
              <span class="pill">已掌握总词：${progressCount}</span>
              <span class="pill">错词：${wrongCount}</span>
              <span class="pill">测验记录：${statsCount}</span>
            </div>
          </div>
          <div class="meta">
            <button id="btn-clear-all" class="btn-danger">清空全部数据</button>
          </div>
        </div>

        <div class="quiz-card">
          <div class="row goal-form">
            <div class="goal-field-main">
              <label>每日目标类型</label>
              <select id="set-goal-type">
                <option value="words" ${goalType==="words" ? "selected" : ""}>每日目标词数</option>
                <option value="chunks" ${goalType==="chunks" ? "selected" : ""}>每日目标词块数</option>
              </select>
            </div>
            <div class="goal-field-num">
              <label>目标数值</label>
              <input id="set-goal-value" type="number" min="1" value="${goalValue}" />
            </div>
            <button id="btn-save-settings" class="btn-primary">保存设置</button>
          </div>

          <div class="divider"></div>

          <div class="row goal-progress">
            <span class="pill">今日目标：${escapeHtml(goalType==="words" ? "词数" : "词块")} × ${goalValue}</span>
            <span class="pill ${done ? "ok" : ""}">今日进度：${cur}/${goalValue}（${pct}%）</span>
          </div>
          <div class="progress"><div style="width:${pct}%"></div></div>

          <div class="divider"></div>

          <div class="col shortcut-settings">
            <label class="shortcut-row">
              <input id="set-shortcuts-enabled" type="checkbox" ${shortcutsEnabled ? "checked" : ""} />
              启用桌面快捷键
            </label>
            <label class="shortcut-row">
              <input id="set-shortcuts-number" type="checkbox" ${shortcutsNumberSelect ? "checked" : ""} />
              学习页数字选词（1-9/0，Shift+1~5 对应第 11-15 词）
            </label>
            <div class="hint shortcut-help">
              <b>快捷键说明（桌面端）</b><br/>
              学习：1-9/0 或 Shift+1~5 选词，L 标记已掌握，W 标记错词，[ / ] 切换词块，Q 开始测验<br/>
              测验：1-6 选答案，Enter 下一题，Esc 退出测验<br/>
              全局：Alt+1 学习，Alt+2 测验，Alt+3 错词本，Alt+4 设置
            </div>
          </div>

          <div class="divider"></div>

          <div class="hint">
            <b>localStorage 键设计（本应用使用）：</b><br/>
            <code>${escapeHtml(LS_KEYS.settings)}</code>：用户每日目标设置<br/>
            <code>de_vocab_daily_log_YYYY-MM-DD</code>：今日学习统计（每天自动刷新）<br/>
            <code>${escapeHtml(LS_KEYS.progress)}</code>：所有已掌握单词<br/>
            <code>${escapeHtml(LS_KEYS.wrong)}</code>：错题及错误次数<br/>
            <code>${escapeHtml(LS_KEYS.stats)}</code>：每个词块测验统计
          </div>
        </div>
      </div>
    `;

    $("#btn-save-settings", elViewRoot).addEventListener("click", () => {
      const t = $("#set-goal-type", elViewRoot).value;
      const v = Math.max(1, Number($("#set-goal-value", elViewRoot).value || 1));
      state.settings.goalType = (t === "chunks") ? "chunks" : "words";
      state.settings.goalValue = v;
      state.settings.shortcutsEnabled = !!$("#set-shortcuts-enabled", elViewRoot)?.checked;
      state.settings.shortcutsNumberSelect = !!$("#set-shortcuts-number", elViewRoot)?.checked;
      saveSetting();

      // sync today's log goal fields (non-destructive)
      const log = readTodayLog();
      log.goalType = state.settings.goalType;
      log.goalValue = state.settings.goalValue;
      writeTodayLog(log);

      toast("设置已保存", `${state.settings.goalType==="words" ? "每日词数" : "每日词块"}：${state.settings.goalValue}`, "ok");
      renderSettings();
      updateSidebarPills();
    });

    $("#btn-clear-all", elViewRoot).addEventListener("click", () => {
      if (!confirm("确定清空全部 de_vocab_* 数据吗？此操作不可撤销。")) return;
      const keys = [];
      for (let i=0; i<localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("de_vocab_")) keys.push(k);
      }
      keys.forEach(k => localStorage.removeItem(k));
      toast("已清空全部数据", "页面将刷新以重置状态。", "warn");
      setTimeout(() => location.reload(), 350);
    });
  }

  /** ---------- View routing ---------- */
  function setView(view) {
    state.view = view;
    elApp.classList.toggle("view-settings", view === "settings");
    // tab UI
    $$(".tab").forEach(t => t.setAttribute("aria-selected", (t.dataset.view === view) ? "true" : "false"));

    if (view === "study") renderChunk();
    else if (view === "quiz") {
      if (state.quiz) renderQuizPage();
      else {
        elViewRoot.innerHTML = `
          <div class="view">
            <div class="view-title">
              <div>
                <h1>测验</h1>
                <div class="pill">当前没有进行中的测验。请在「学习」完成词块后自动进入，或手动点「开始测验」。</div>
              </div>
            </div>
          </div>
        `;
      }
    }
    else if (view === "wrong") renderWrongWords();
    else if (view === "settings") renderSettings();
  }

  /** ---------- Sidebar rendering ---------- */
  function updateSidebarPills() {
    const countUnits = state.selectedUnitIds.size;
    elPillSelected.textContent = `已选 ${countUnits} 个单元`;

    const words = state.mergedWords.length;
    const chunks = state.chunks.length;
    elPillWords.textContent = `${words} 词`;
    elPillChunks.textContent = `${chunks} 块`;

    // quick daily goal progress in status pill
    const today = readTodayLog();
    const goalType = state.settings.goalType;
    const goalValue = Math.max(1, Number(state.settings.goalValue) || 1);
    const cur = goalType === "words" ? (today.learnedWordsCount || 0) : (today.learnedChunksCount || 0);
    const pct = Math.min(100, Math.round((cur / goalValue) * 100));

    if (words) {
      elPillStatus.textContent = `已加载 · 今日 ${pct}%`;
      elPillStatus.className = "pill " + (pct>=100 ? "ok" : "");
    } else {
      elPillStatus.textContent = "未加载";
      elPillStatus.className = "pill";
    }
  }

  function renderSidebarDictionaries() {
    const data = state.dictMeta;
    const dicts = (data && Array.isArray(data.dictionaries)) ? data.dictionaries : [];
    elSelDict.innerHTML = dicts.map(d => {
      const title = d.name ? `${d.id} · ${d.name}` : d.id;
      return `<option value="${escapeHtml(d.id)}">${escapeHtml(title)}</option>`;
    }).join("");

    // restore selection
    const lastDict = state.settings?.lastSelection?.dictId;
    const pick = dicts.find(d => d.id === lastDict) ? lastDict : (dicts[0]?.id || null);
    if (pick) elSelDict.value = pick;
    state.selectedDictId = pick;

    renderUnitsForSelectedDict();
  }

  function renderUnitsForSelectedDict() {
    const dict = getSelectedDict();
    if (!dict) {
      elUnits.innerHTML = `<div class="hint">dictionary.json 中未找到词库。</div>`;
      return;
    }

    // build index map for quick access
    state.unitsIndex.clear();
    for (const u of dict.units || []) state.unitsIndex.set(u.id, u);

    // restore unit selection (only for this dict)
    state.selectedUnitIds.clear();
    const lastSel = state.settings?.lastSelection;
    const lastUnits = Array.isArray(lastSel?.unitIds) ? lastSel.unitIds : [];
    const sameDict = lastSel?.dictId === dict.id;
    if (sameDict) {
      for (const id of lastUnits) if (state.unitsIndex.has(id)) state.selectedUnitIds.add(id);
    }

    // if nothing selected, preselect first unit for friendliness
    if (state.selectedUnitIds.size === 0 && dict.units?.length) state.selectedUnitIds.add(dict.units[0].id);

    // order restore
    const lastOrder = lastSel?.order || "as-is";
    state.selectedOrder = lastOrder;
    elOrder.value = state.selectedOrder;

    elUnits.innerHTML = (dict.units || []).map(u => {
      const checked = state.selectedUnitIds.has(u.id);
      return `
        <div class="unit">
          <div class="left">
            <input type="checkbox" ${checked ? "checked" : ""} data-unit-id="${escapeHtml(u.id)}" />
            <div class="meta">
              <div class="name">${escapeHtml(u.name || u.id)}</div>
              <div class="desc">${escapeHtml(u.file)} · 约 ${u.wordCount ?? "?"} 词</div>
            </div>
          </div>
          <span class="pill">${escapeHtml(u.id)}</span>
        </div>
      `;
    }).join("");

    // footer pills
    updateSidebarPills();
  }

  /** ---------- Export / Import ---------- */
  function exportData() {
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 1,
      keys: {}
    };
    for (let i=0; i<localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (!k.startsWith("de_vocab_")) continue;
      payload.keys[k] = localStorage.getItem(k);
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `de_vocab_export_${formatSydneyDate()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 800);
    toast("已导出数据", a.download, "ok");
  }

  function openImportModal() {
    elImportFile.value = "";
    elModalImport.classList.add("open");
  }
  function closeImportModal() {
    elModalImport.classList.remove("open");
  }

  async function importDataAndReload(file) {
    if (!file) {
      toast("未选择文件", "请选择导出的 JSON 文件。", "warn");
      return;
    }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || typeof data !== "object" || !data.keys) throw new Error("导入文件格式不正确（缺少 keys）");

      // overwrite only de_vocab_*
      const keys = data.keys;
      for (const [k, v] of Object.entries(keys)) {
        if (!k.startsWith("de_vocab_")) continue;
        if (typeof v !== "string") continue;
        localStorage.setItem(k, v);
      }

      toast("导入成功", "页面将刷新以应用数据。", "ok");
      setTimeout(() => location.reload(), 350);
    } catch (e) {
      toast("导入失败", String(e?.message || e), "bad");
    }
  }

  /** ---------- Events ---------- */
  function bindEvents() {
    // tabs
    $$(".tab").forEach(t => t.addEventListener("click", () => setView(t.dataset.view)));
    document.addEventListener("keydown", handleGlobalShortcuts);

    // dict selection
    elSelDict.addEventListener("change", () => {
      state.selectedDictId = elSelDict.value;
      // reset cache? keep cache
      // update selection restore -> none
      state.selectedUnitIds.clear();
      renderUnitsForSelectedDict();
      updateSidebarPills();
      // also clear loaded words
      state.mergedWords = [];
      state.chunks = [];
      state.chunkIndex = 0;
      elPillStatus.textContent = "未加载";
      elPillStatus.className = "pill";
      setView("study");
    });

    // unit checkbox selection (delegation)
    elUnits.addEventListener("change", (e) => {
      const cb = e.target.closest('input[type="checkbox"][data-unit-id]');
      if (!cb) return;
      const id = cb.dataset.unitId;
      if (cb.checked) state.selectedUnitIds.add(id);
      else state.selectedUnitIds.delete(id);
      updateSidebarPills();
    });

    elBtnSelectAll.addEventListener("click", () => {
      const dict = getSelectedDict();
      if (!dict) return;
      state.selectedUnitIds = new Set((dict.units || []).map(u => u.id));
      renderUnitsForSelectedDict();
      updateSidebarPills();
    });

    elBtnSelectNone.addEventListener("click", () => {
      state.selectedUnitIds.clear();
      renderUnitsForSelectedDict();
      updateSidebarPills();
    });

    elOrder.addEventListener("change", () => {
      state.selectedOrder = elOrder.value;
      updateSidebarPills();
    });

    elBtnLoad.addEventListener("click", async () => {
      if (!state.selectedDictId) {
        toast("请先选择词库", "", "warn");
        return;
      }
      if (state.selectedUnitIds.size === 0) {
        toast("请至少选择 1 个单元", "", "warn");
        return;
      }

      // persist selection to settings
      state.settings.lastSelection = {
        dictId: state.selectedDictId,
        unitIds: Array.from(state.selectedUnitIds),
        order: state.selectedOrder
      };
      saveSetting();

      elBtnLoad.disabled = true;
      elBtnLoad.textContent = "加载中…";
      try {
        await mergeWords();
        toast("加载完成", `共 ${state.mergedWords.length} 词，${state.chunks.length} 块`, "ok");
        setView("study");
      } finally {
        elBtnLoad.disabled = false;
        elBtnLoad.textContent = "加载所选单元";
      }
    });

    // export/import
    $("#btn-export").addEventListener("click", exportData);
    $("#btn-import").addEventListener("click", openImportModal);

    // modal events
    elImportClose.addEventListener("click", closeImportModal);
    elImportCancel.addEventListener("click", closeImportModal);
    elModalImport.addEventListener("click", (e) => {
      if (e.target === elModalImport) closeImportModal();
    });
    elImportConfirm.addEventListener("click", async () => {
      const file = elImportFile.files?.[0] || null;
      closeImportModal();
      await importDataAndReload(file);
    });
  }

  /** ---------- Init ---------- */
  async function init() {
    loadSetting();
    loadProgress();
    ensureDailyLog();
    updateSidebarPills();

    bindEvents();

    try {
      await loadDictionary();
      renderSidebarDictionaries();

      // Auto-load last selection if possible (nice UX)
      const last = state.settings.lastSelection;
      if (last?.dictId) {
        state.selectedDictId = last.dictId;
        if (elSelDict.querySelector(`option[value="${CSS.escape(last.dictId)}"]`)) {
          elSelDict.value = last.dictId;
          renderUnitsForSelectedDict();
          // apply last order
          state.selectedOrder = last.order || "as-is";
          elOrder.value = state.selectedOrder;

          // attempt auto-load immediately
          await mergeWords();
          toast("已恢复上次学习", `共 ${state.mergedWords.length} 词，${state.chunks.length} 块`, "ok");
        }
      }
    } catch {
      // loadDictionary already toasted; show study placeholder
    } finally {
      setView("study");
    }
  }

  init();
  // expose required functions to window for inspection/debugging
  window.loadDictionary = loadDictionary;
  window.loadUnitWords = loadUnitWords;
  window.mergeWords = mergeWords;
  window.createChunks = createChunks;
  window.renderChunk = renderChunk;
  window.renderWordCard = renderWordCard;
  window.markWordLearned = markWordLearned;
  window.startQuizModeA = startQuizModeA;
  window.startQuizModeB = startQuizModeB;
  window.generateChoices = generateChoices;
  window.renderQuizPage = renderQuizPage;
  window.renderQuizSummary = renderQuizSummary;
  window.saveSetting = saveSetting;
  window.loadSetting = loadSetting;
  window.saveProgress = saveProgress;
  window.loadProgress = loadProgress;
  window.renderWrongWords = renderWrongWords;
  window.startWrongWordsQuiz = startWrongWordsQuiz;

})();
