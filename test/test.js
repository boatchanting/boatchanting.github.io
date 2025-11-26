
const APP_KEY = "de_vocab_app_v1";

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};

const ui = {
  dictSelect: $("#dictionarySelect"),
  dictMeta: $("#dictMeta"),
  unitList: $("#unitList"),
  unitMeta: $("#unitMeta"),
  unitAll: $("#unitAll"),
  unitNone: $("#unitNone"),
  sortMode: $("#sortMode"),
  choiceCount: $("#choiceCount"),
  practiceScope: $("#practiceScope"),
  segBtns: [...document.querySelectorAll(".segBtn")],
  spellOptions: $("#spellOptions"),
  spellHint: $("#spellHint"),

  btnStart: $("#btnStart"),
  btnExport: $("#btnExport"),
  importFile: $("#importFile"),
  btnWipeAll: $("#btnWipeAll"),
  btnResetSession: $("#btnResetSession"),

  combo: $("#combo"),
  progressTitle: $("#progressTitle"),
  progressSub: $("#progressSub"),

  todayAttempts: $("#todayAttempts"),
  todayWrong: $("#todayWrong"),
  totalAttempts: $("#totalAttempts"),
  totalWrong: $("#totalWrong"),

  unitPill: $("#unitPill"),
  indexPill: $("#indexPill"),
  scopePill: $("#scopePill"),

  qTitle: $("#qTitle"),
  qHint: $("#qHint"),
  answerArea: $("#answerArea"),
  feedback: $("#feedback"),

  btnSkip: $("#btnSkip"),
  btnNext: $("#btnNext"),

  wordAttempts: $("#wordAttempts"),
  wordWrong: $("#wordWrong"),
  wordTodayAttempts: $("#wordTodayAttempts"),
  wordTodayWrong: $("#wordTodayWrong"),

  toast: $("#toast"),
};

const todayKey = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const normalize = (s) =>
  (s ?? "")
    .toString()
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

function showToast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => ui.toast.classList.remove("show"), 1200);
}

function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function loadStore() {
  const raw = localStorage.getItem(APP_KEY);
  const base = {
    version: 1,
    settings: {
      dictionaryId: "",
      selectedUnits: [],
      sortMode: "forward",
      choiceCount: 4,
      practiceScope: "all",
      mode: "mc_meaning2word",
      spellHint: "full",
      theme: "dark",
    },
    stats: {
      words: {}, // wordKey -> per-word stats + meta
    },
    session: null, // optional resume
  };
  if (!raw) return base;
  const parsed = safeJsonParse(raw, base);
  return { ...base, ...parsed, settings: { ...base.settings, ...(parsed.settings || {}) }, stats: { ...base.stats, ...(parsed.stats || {}) } };
}

function applyTheme(theme) {
  const t = (theme === "light") ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  store.settings.theme = t;
  saveStore();
  const btn = document.querySelector("#btnTheme");
  if (btn) btn.textContent = (t === "light") ? "深色主题" : "浅色主题";
}

function toggleTheme() {
  const cur = document.documentElement.dataset.theme || store.settings.theme || "dark";
  applyTheme(cur === "light" ? "dark" : "light");
}

function saveStore() {
  localStorage.setItem(APP_KEY, JSON.stringify(store));
}

let store = loadStore();
let dictIndex = null; // dictionary.json parsed
let loadedWords = new Map(); // wordKey -> {name, transArr, transStr, unitId, unitName, dictionaryId}
let currentDeck = []; // array of wordKey
let session = {
  active: false,
  index: 0,
  combo: 0,
  lockNext: false, // wrong -> lock until user clicks next
  mode: store.settings.mode,
  choiceCount: Number(store.settings.choiceCount) || 4,
  practiceScope: store.settings.practiceScope,
  sortMode: store.settings.sortMode,
  spellHint: store.settings.spellHint,
  dictionaryId: store.settings.dictionaryId,
  selectedUnits: [...store.settings.selectedUnits],
};

function setFeedback(type, html) {
  ui.feedback.classList.remove("good", "bad");
  if (type) ui.feedback.classList.add(type);
  ui.feedback.innerHTML = html || "";
}

function setMode(mode) {
  store.settings.mode = mode;
  session.mode = mode;
  ui.segBtns.forEach(b => b.classList.toggle("active", b.dataset.mode === mode));
  ui.spellOptions.style.display = (mode === "spell") ? "" : "none";
  saveStore();
}

function updateSettingsFromUI() {
  store.settings.dictionaryId = ui.dictSelect.value || "";
  store.settings.selectedUnits = getSelectedUnitIds();
  store.settings.sortMode = ui.sortMode.value;
  store.settings.choiceCount = Number(ui.choiceCount.value);
  store.settings.practiceScope = ui.practiceScope.value;
  store.settings.spellHint = ui.spellHint.value;

  session.dictionaryId = store.settings.dictionaryId;
  session.selectedUnits = [...store.settings.selectedUnits];
  session.sortMode = store.settings.sortMode;
  session.choiceCount = store.settings.choiceCount;
  session.practiceScope = store.settings.practiceScope;
  session.spellHint = store.settings.spellHint;

  saveStore();
}

function getSelectedUnitIds() {
  return [...ui.unitList.querySelectorAll("input[type=checkbox][data-unit-id]")]
    .filter(x => x.checked)
    .map(x => x.dataset.unitId);
}

function getDictionaryById(id) {
  return (dictIndex?.dictionaries || []).find(d => d.id === id) || null;
}

function wordStatEnsure(wordKey, meta) {
  const words = store.stats.words;
  if (!words[wordKey]) {
    words[wordKey] = {
      // meta:
      name: meta.name,
      transStr: meta.transStr,
      unitId: meta.unitId,
      unitName: meta.unitName,
      dictionaryId: meta.dictionaryId,
      // stats:
      totalAttempts: 0,
      totalWrong: 0,
      daily: {}, // date -> {attempts, wrong}
      lastSeenAt: null,
    };
  } else {
    // keep meta updated if changed
    words[wordKey].name = meta.name;
    words[wordKey].transStr = meta.transStr;
    words[wordKey].unitId = meta.unitId;
    words[wordKey].unitName = meta.unitName;
    words[wordKey].dictionaryId = meta.dictionaryId;
  }
  return words[wordKey];
}

function bumpStats(wordKey, isCorrect) {
  const meta = loadedWords.get(wordKey);
  if (!meta) return;
  const s = wordStatEnsure(wordKey, meta);

  const d = todayKey();
  s.daily[d] = s.daily[d] || { attempts: 0, wrong: 0 };
  s.totalAttempts += 1;
  s.daily[d].attempts += 1;
  if (!isCorrect) {
    s.totalWrong += 1;
    s.daily[d].wrong += 1;
  }
  s.lastSeenAt = new Date().toISOString();
  saveStore();
}

function sumAllStats() {
  let totalAttempts = 0, totalWrong = 0;
  let todayAttempts = 0, todayWrong = 0;
  const d = todayKey();
  for (const k of Object.keys(store.stats.words || {})) {
    const s = store.stats.words[k];
    totalAttempts += s.totalAttempts || 0;
    totalWrong += s.totalWrong || 0;
    if (s.daily?.[d]) {
      todayAttempts += s.daily[d].attempts || 0;
      todayWrong += s.daily[d].wrong || 0;
    }
  }
  ui.totalAttempts.textContent = totalAttempts;
  ui.totalWrong.textContent = totalWrong;
  ui.todayAttempts.textContent = todayAttempts;
  ui.todayWrong.textContent = todayWrong;
}

function updateWordStatsPanel(wordKey) {
  const meta = loadedWords.get(wordKey);
  if (!meta) {
    ui.wordAttempts.textContent = "0";
    ui.wordWrong.textContent = "0";
    ui.wordTodayAttempts.textContent = "0";
    ui.wordTodayWrong.textContent = "0";
    return;
  }
  const s = wordStatEnsure(wordKey, meta);
  const d = todayKey();
  const ds = s.daily?.[d] || { attempts: 0, wrong: 0 };
  ui.wordAttempts.textContent = String(s.totalAttempts || 0);
  ui.wordWrong.textContent = String(s.totalWrong || 0);
  ui.wordTodayAttempts.textContent = String(ds.attempts || 0);
  ui.wordTodayWrong.textContent = String(ds.wrong || 0);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function applySort(deck, sortMode) {
  const keys = [...deck];
  if (sortMode === "forward") return keys;
  if (sortMode === "reverse") return keys.reverse();
  if (sortMode === "shuffle") return shuffle(keys);
  if (sortMode === "alphaAsc") {
    return keys.sort((a, b) => loadedWords.get(a).name.localeCompare(loadedWords.get(b).name, "de"));
  }
  if (sortMode === "alphaDesc") {
    return keys.sort((a, b) => loadedWords.get(b).name.localeCompare(loadedWords.get(a).name, "de"));
  }
  return keys;
}

function buildDeck() {
  const allKeys = [...loadedWords.keys()];
  const scope = session.practiceScope;
  const d = todayKey();

  let filtered = allKeys;

  if (scope === "wrongAll") {
    filtered = allKeys.filter(k => (store.stats.words?.[k]?.totalWrong || 0) > 0);
  } else if (scope === "wrongToday") {
    filtered = allKeys.filter(k => (store.stats.words?.[k]?.daily?.[d]?.wrong || 0) > 0);
  } else if (scope === "newOnly") {
    filtered = allKeys.filter(k => (store.stats.words?.[k]?.totalAttempts || 0) === 0);
  }

  filtered = applySort(filtered, session.sortMode);
  return filtered;
}

function maskWord(word, hintMode) {
  // 对包含空格/连字符的词条：只遮字母，保留空格和符号
  const vowels = new Set(["a","e","i","o","u","ä","ö","ü","A","E","I","O","U","Ä","Ö","Ü"]);
  const alpha = /[a-zA-ZäöüÄÖÜß]/;

  const chars = [...word];
  if (hintMode === "full") return null; // no hint

  if (hintMode === "hideVowels") {
    return chars.map(ch => (alpha.test(ch) && vowels.has(ch) ? "•" : ch)).join("");
  }
  if (hintMode === "hideConsonants") {
    return chars.map(ch => (alpha.test(ch) && !vowels.has(ch) ? "•" : ch)).join("");
  }
  if (hintMode === "randomHide") {
    return chars.map(ch => {
      if (!alpha.test(ch)) return ch;
      return (Math.random() < 0.45) ? "•" : ch;
    }).join("");
  }
  return null;
}

function renderChoices({ promptTitle, promptHint, options, correctIndex }) {
  ui.qTitle.textContent = promptTitle;
  ui.qHint.textContent = promptHint;

  ui.answerArea.innerHTML = "";
  const grid = el("div", "choices");
  options.forEach((opt, idx) => {
    const b = el("button", "choiceBtn");
    b.type = "button";
    b.dataset.idx = String(idx);
    b.innerHTML = `<b style="opacity:.8">${idx + 1}.</b> ${escapeHtml(opt)}`;
    b.addEventListener("click", () => onPickChoice(idx, correctIndex, b, grid));
    grid.appendChild(b);
  });
  ui.answerArea.appendChild(grid);
}

function escapeHtml(s) {
  return (s ?? "").toString()
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function disableAllChoiceButtons(container) {
  [...container.querySelectorAll("button.choiceBtn")].forEach(b => b.disabled = true);
}

function onPickChoice(idx, correctIndex, clickedBtn, container) {
  if (!session.active) return;
  if (session.lockNext) return;

  const wordKey = currentDeck[session.index];
  const correct = (idx === correctIndex);

  bumpStats(wordKey, correct);
  sumAllStats();
  updateWordStatsPanel(wordKey);

  if (correct) {
    session.combo += 1;
    ui.combo.textContent = String(session.combo);
    setFeedback("good", `✅ 正确！<span class="muted">自动下一题…</span>`);
    disableAllChoiceButtons(container);
    clickedBtn.classList.add("correct");
    persistSession();
    setTimeout(() => nextQuestion(true), 260);
  } else {
    session.combo = 0;
    ui.combo.textContent = "0";
    session.lockNext = true;
    ui.btnNext.disabled = false;
    disableAllChoiceButtons(container);
    clickedBtn.classList.add("wrong");

    // mark correct
    const correctBtn = container.querySelector(`button.choiceBtn[data-idx="${correctIndex}"]`);
    if (correctBtn) correctBtn.classList.add("correct");

    const meta = loadedWords.get(wordKey);
    setFeedback("bad", `❌ 错了。正确答案：<b>${escapeHtml(meta.name)}</b> — <span class="muted">${escapeHtml(meta.transStr)}</span>`);
    persistSession();
  }
}

function renderSpelling({ promptTitle, promptHint, answer }) {
  ui.answerArea.innerHTML = "";

  ui.qTitle.textContent = promptTitle;
  ui.qHint.textContent = promptHint;

  const wrap = el("div", "spellWrap");

  const hint = maskWord(answer, session.spellHint);
  if (hint) {
    const hintBox = el("div", "hintBox");
    hintBox.innerHTML = `提示：<b>${escapeHtml(hint)}</b>`;
    wrap.appendChild(hintBox);
  }

  const row = el("div", "spellRow");
  const input = el("input");
  input.type = "text";
  input.placeholder = "输入完整单词（Enter 提交）";
  input.autocomplete = "off";
  input.spellcheck = false;

  const btn = el("button", "btn");
  btn.textContent = "提交";
  btn.type = "button";

  row.appendChild(input);
  row.appendChild(btn);
  wrap.appendChild(row);

  const submit = () => {
    if (!session.active) return;
    if (session.lockNext) return;

    const user = normalize(input.value);
    const target = normalize(answer);
    const correct = user === target;

    const wordKey = currentDeck[session.index];
    bumpStats(wordKey, correct);
    sumAllStats();
    updateWordStatsPanel(wordKey);

    if (correct) {
      session.combo += 1;
      ui.combo.textContent = String(session.combo);
      setFeedback("good", `✅ 正确！<span class="muted">自动下一题…</span>`);
      input.disabled = true; btn.disabled = true;
      persistSession();
      setTimeout(() => nextQuestion(true), 260);
    } else {
      session.combo = 0;
      ui.combo.textContent = "0";
      session.lockNext = true;
      ui.btnNext.disabled = false;
      input.disabled = true; btn.disabled = true;

      const meta = loadedWords.get(wordKey);
      setFeedback("bad", `❌ 错了。正确答案：<b>${escapeHtml(meta.name)}</b> — <span class="muted">${escapeHtml(meta.transStr)}</span>`);
      persistSession();
    }
  };

  btn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });

  ui.answerArea.appendChild(wrap);
  setTimeout(() => input.focus(), 50);
}

function getCurrentMeta() {
  const key = currentDeck[session.index];
  return loadedWords.get(key) || null;
}

function renderQuestion() {
  if (!session.active) {
    ui.progressTitle.textContent = "未开始";
    ui.progressSub.textContent = "请选择词库与单元，然后点击“开始学习”。";
    ui.unitPill.textContent = "—";
    ui.indexPill.textContent = "—";
    ui.scopePill.textContent = "—";
    ui.btnNext.disabled = true;
    setFeedback(null, "");
    return;
  }

  const meta = getCurrentMeta();
  if (!meta) return;

  ui.progressTitle.textContent = "学习中";
  ui.progressSub.textContent = `模式：${modeLabel(session.mode)} · 排序：${sortLabel(session.sortMode)} · 选项：${session.choiceCount} · 范围：${scopeLabel(session.practiceScope)}`;

  ui.unitPill.textContent = `${meta.unitId} · ${meta.unitName || ""}`.trim();
  ui.indexPill.textContent = `${session.index + 1} / ${currentDeck.length}`;
  ui.scopePill.textContent = scopeLabel(session.practiceScope);

  ui.btnNext.disabled = !session.lockNext;

  setFeedback(null, "请选择/输入答案。正确会自动下一题；错误会显示正确答案并等待你手动点“下一题”。");

  updateWordStatsPanel(currentDeck[session.index]);

  if (session.mode === "mc_meaning2word") {
    const correctKey = currentDeck[session.index];
    const correct = loadedWords.get(correctKey);

    const optionsKeys = makeOptionKeys(correctKey, session.choiceCount);
    const options = optionsKeys.map(k => loadedWords.get(k).name);
    const correctIndex = optionsKeys.indexOf(correctKey);

    renderChoices({
      promptTitle: correct.transStr,
      promptHint: "根据释义选择正确的德语词条",
      options,
      correctIndex
    });

  } else if (session.mode === "mc_word2meaning") {
    const correctKey = currentDeck[session.index];
    const correct = loadedWords.get(correctKey);

    const optionsKeys = makeOptionKeys(correctKey, session.choiceCount);
    const options = optionsKeys.map(k => loadedWords.get(k).transStr);
    const correctIndex = optionsKeys.indexOf(correctKey);

    renderChoices({
      promptTitle: correct.name,
      promptHint: "根据德语词条选择正确的释义",
      options,
      correctIndex
    });

  } else {
    // spell
    const correctKey = currentDeck[session.index];
    const correct = loadedWords.get(correctKey);

    renderSpelling({
      promptTitle: correct.transStr,
      promptHint: "默写：根据释义输入完整德语词条（含冠词/附注按你的词条为准）",
      answer: correct.name,
    });
  }

  persistSession();
}

function makeOptionKeys(correctKey, n) {
  const pool = [...loadedWords.keys()];
  const candidates = pool.filter(k => k !== correctKey);
  shuffle(candidates);
  const opts = [correctKey, ...candidates.slice(0, Math.max(0, n - 1))];
  return shuffle(opts);
}

function modeLabel(m) {
  if (m === "mc_meaning2word") return "意思选词";
  if (m === "mc_word2meaning") return "词选意思";
  return "默写/隐藏";
}
function sortLabel(s) {
  return ({
    forward: "正序",
    reverse: "倒序",
    shuffle: "乱序",
    alphaAsc: "字母顺序",
    alphaDesc: "字母倒序",
  })[s] || s;
}
function scopeLabel(s) {
  return ({
    all: "全部",
    wrongAll: "错题（历史）",
    wrongToday: "错题（今日）",
    newOnly: "未练过",
  })[s] || s;
}

function persistSession() {
  store.session = session.active ? {
    active: true,
    index: session.index,
    combo: session.combo,
    lockNext: session.lockNext,
    mode: session.mode,
    choiceCount: session.choiceCount,
    practiceScope: session.practiceScope,
    sortMode: session.sortMode,
    spellHint: session.spellHint,
    dictionaryId: session.dictionaryId,
    selectedUnits: [...session.selectedUnits],
    deck: [...currentDeck],
    savedAt: new Date().toISOString(),
  } : null;
  saveStore();
}

function clearSessionPersist() {
  store.session = null;
  saveStore();
}

function nextQuestion(fromAutoCorrect = false) {
  if (!session.active) return;

  session.lockNext = false;
  ui.btnNext.disabled = true;

  if (session.index + 1 >= currentDeck.length) {
    const attempts = currentDeck.length;
    setFeedback("good", `🎉 本轮完成！共 ${attempts} 题。你可以修改设置后再次点击“开始学习”。`);
    ui.qTitle.textContent = "本轮已完成";
    ui.qHint.textContent = "可以换排序/范围/模式再来一轮。";
    ui.answerArea.innerHTML = "";
    ui.unitPill.textContent = "—";
    ui.indexPill.textContent = "—";
    session.active = false;
    persistSession();
    return;
  }

  session.index += 1;
  renderQuestion();
}

async function loadDictionaryIndex() {
  try {
    const res = await fetch("dictionary.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`dictionary.json 加载失败：${res.status}`);
    dictIndex = await res.json();
  } catch (e) {
    setFeedback("bad", `无法读取 <b>dictionary.json</b>。请确认你是通过本地服务器打开（不是 file://）。<br/><span class="muted">${escapeHtml(e.message)}</span>`);
    throw e;
  }
}

function renderDictionarySelect() {
  ui.dictSelect.innerHTML = "";
  const list = dictIndex?.dictionaries || [];
  list.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.name ? `${d.id} · ${d.name}` : d.id;
    ui.dictSelect.appendChild(opt);
  });

  // restore
  const firstId = list[0]?.id || "";
  const savedId = store.settings.dictionaryId;
  ui.dictSelect.value = list.some(d => d.id === savedId) ? savedId : firstId;

  renderUnitsForSelectedDictionary();
}

function renderUnitsForSelectedDictionary() {
  const dictId = ui.dictSelect.value;
  const dict = getDictionaryById(dictId);
  ui.unitList.innerHTML = "";

  if (!dict) {
    ui.dictMeta.textContent = "未找到词库。";
    ui.unitMeta.textContent = "";
    return;
  }

  const dictName = dict.name ? ` · ${dict.name}` : "";
  const desc = dict.description ? `（${dict.description}）` : "";
  const totalWords = dict.totalWords ? `总词数 ${dict.totalWords}` : "";
  ui.dictMeta.textContent = `${dictId}${dictName} ${desc} ${totalWords}`.trim();

  const saved = new Set(store.settings.selectedUnits || []);
  dict.units.forEach(u => {
    const item = el("label", "unitItem");
    const cb = el("input");
    cb.type = "checkbox";
    cb.dataset.unitId = u.id;
    cb.checked = saved.size ? saved.has(u.id) : true;

    const info = el("div");
    const title = el("div", "unitName");
    title.textContent = `${u.id} · ${u.name || ""}`.trim();
    const meta = el("div", "unitMeta");
    meta.textContent = `${u.file || ""} · ${u.wordCount ?? ""}`.trim();

    info.appendChild(title);
    info.appendChild(meta);
    item.appendChild(cb);
    item.appendChild(info);

    cb.addEventListener("change", () => {
      updateSettingsFromUI();
      updateUnitMeta();
    });

    ui.unitList.appendChild(item);
  });

  updateSettingsFromUI();
  updateUnitMeta();
}

function updateUnitMeta() {
  const dict = getDictionaryById(ui.dictSelect.value);
  if (!dict) return;
  const selected = getSelectedUnitIds();
  const total = selected.reduce((sum, id) => {
    const u = dict.units.find(x => x.id === id);
    return sum + (u?.wordCount || 0);
  }, 0);
  ui.unitMeta.textContent = `已选择 ${selected.length}/${dict.units.length} 个单元 · 预计 ${total} 词`;
}

async function loadSelectedUnitsWords() {
  loadedWords.clear();
  const dictId = ui.dictSelect.value;
  const dict = getDictionaryById(dictId);
  if (!dict) throw new Error("词库不存在");

  const selectedUnitIds = getSelectedUnitIds();
  if (!selectedUnitIds.length) throw new Error("请至少选择一个单元");

  // keep unit order as in dict.units
  const selectedUnits = dict.units.filter(u => selectedUnitIds.includes(u.id));

  const datasets = await Promise.all(selectedUnits.map(async (u) => {
    const res = await fetch(u.file, { cache: "no-store" });
    if (!res.ok) throw new Error(`${u.file} 加载失败：${res.status}`);
    const arr = await res.json();
    return { unit: u, words: arr };
  }));

  for (const ds of datasets) {
    const unitId = ds.unit.id;
    const unitName = ds.unit.name || "";
    for (const w of ds.words) {
      const name = (w?.name ?? "").toString();
      const transArr = Array.isArray(w?.trans) ? w.trans : [];
      const transStr = transArr.join("；").trim() || "(无释义)";
      const key = `${dictId}|${unitId}|${name}`;

      const meta = { name, transArr, transStr, unitId, unitName, dictionaryId: dictId };
      loadedWords.set(key, meta);
      wordStatEnsure(key, meta); // ensure stats exists
    }
  }

  saveStore();
  sumAllStats();
}

function resetRoundState(keepCombo = false) {
  session.active = false;
  session.index = 0;
  session.lockNext = false;
  if (!keepCombo) session.combo = 0;
  ui.combo.textContent = String(session.combo);
  currentDeck = [];
  clearSessionPersist();
}

async function startLearning() {
  try {
    updateSettingsFromUI();
    setFeedback(null, "正在加载词库…");
    ui.btnStart.disabled = true;

    await loadSelectedUnitsWords();

    currentDeck = buildDeck();
    if (!currentDeck.length) {
      resetRoundState();
      setFeedback("bad", `当前范围（${scopeLabel(session.practiceScope)}）下没有可练习词条。换个范围试试。`);
      ui.btnStart.disabled = false;
      return;
    }

    session.active = true;
    session.index = 0;
    session.lockNext = false;
    session.combo = session.combo || 0;
    ui.combo.textContent = String(session.combo);

    showToast(`已加载 ${currentDeck.length} 词`);
    renderQuestion();
  } catch (e) {
    resetRoundState(true);
    setFeedback("bad", `启动失败：<span class="muted">${escapeHtml(e.message || String(e))}</span>`);
  } finally {
    ui.btnStart.disabled = false;
  }
}

function exportAllData() {
  const payload = {
    app: "DeVocabFluent",
    version: store.version || 1,
    exportedAt: new Date().toISOString(),
    data: store,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `devocab_export_${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  showToast("已导出");
}

async function importAllData(file) {
  const text = await file.text();
  const payload = safeJsonParse(text, null);
  if (!payload?.data) throw new Error("导入文件格式不正确（缺少 data）");

  // replace store
  store = payload.data;
  if (!store.settings) store.settings = {};
  if (!store.stats) store.stats = { words: {} };

  saveStore();
  resetRoundState();
  // re-render UI with imported settings
  await boot(true);
  showToast("已导入");
}

function wipeAllData() {
  if (!confirm("确定要清空全部数据吗？（不可恢复，建议先导出）")) return;
  localStorage.removeItem(APP_KEY);
  store = loadStore();
  resetRoundState();
  boot(true);
  showToast("已清空");
}

function resetSessionOnly() {
  resetRoundState();
  renderQuestion();
  showToast("本轮已清空");
}

function handleKeyboard(e) {
  if (!session.active) return;

  if (e.key === "Escape") {
    resetRoundState(true);
    renderQuestion();
    showToast("已结束本轮");
    return;
  }

  if (e.key === "Enter") {
    if (session.lockNext) {
      ui.btnNext.click();
    }
    return;
  }

  // number keys for multiple choice
  const k = e.key;
  if (/^[1-8]$/.test(k)) {
    const idx = Number(k) - 1;
    const btn = ui.answerArea.querySelector(`button.choiceBtn[data-idx="${idx}"]`);
    if (btn && !btn.disabled) btn.click();
  }
}

function wireEvents() {
  ui.dictSelect.addEventListener("change", () => {
    store.settings.dictionaryId = ui.dictSelect.value;
    store.settings.selectedUnits = []; // reset selection for new dict to default all
    saveStore();
    renderUnitsForSelectedDictionary();
  });

  ui.unitAll.addEventListener("click", () => {
    [...ui.unitList.querySelectorAll("input[type=checkbox]")].forEach(cb => cb.checked = true);
    updateSettingsFromUI();
    updateUnitMeta();
  });

  ui.unitNone.addEventListener("click", () => {
    [...ui.unitList.querySelectorAll("input[type=checkbox]")].forEach(cb => cb.checked = false);
    updateSettingsFromUI();
    updateUnitMeta();
  });

  ui.sortMode.value = store.settings.sortMode;
  ui.choiceCount.value = String(store.settings.choiceCount || 4);
  ui.practiceScope.value = store.settings.practiceScope;
  ui.spellHint.value = store.settings.spellHint;

  ui.sortMode.addEventListener("change", () => updateSettingsFromUI());
  ui.choiceCount.addEventListener("change", () => updateSettingsFromUI());
  ui.practiceScope.addEventListener("change", () => updateSettingsFromUI());
  ui.spellHint.addEventListener("change", () => updateSettingsFromUI());

  ui.segBtns.forEach(b => {
    b.addEventListener("click", () => setMode(b.dataset.mode));
  });

  ui.btnStart.addEventListener("click", startLearning);
  ui.btnExport.addEventListener("click", exportAllData);

  ui.importFile.addEventListener("change", async () => {
    const file = ui.importFile.files?.[0];
    ui.importFile.value = "";
    if (!file) return;
    try {
      await importAllData(file);
    } catch (e) {
      setFeedback("bad", `导入失败：<span class="muted">${escapeHtml(e.message || String(e))}</span>`);
    }
  });

  ui.btnWipeAll.addEventListener("click", wipeAllData);
  ui.btnResetSession.addEventListener("click", resetSessionOnly);

  ui.btnNext.addEventListener("click", () => nextQuestion(false));
  ui.btnSkip.addEventListener("click", () => {
    if (!session.active) return;
    // 跳过不计入统计，只移动（错误锁也解除）
    session.lockNext = false;
    ui.btnNext.disabled = true;
    session.combo = 0; // 跳过视为断连击，更符合“没做对”的体验
    ui.combo.textContent = "0";
    nextQuestion(false);
  });

  window.addEventListener("keydown", handleKeyboard);

    const btnTheme = document.querySelector("#btnTheme");
  if (btnTheme) btnTheme.addEventListener("click", toggleTheme);

}

async function boot(fromImport = false) {
  // set active mode UI
  applyTheme(store.settings.theme || "dark");
  setMode(store.settings.mode || "mc_meaning2word");
  ui.sortMode.value = store.settings.sortMode || "forward";
  ui.choiceCount.value = String(store.settings.choiceCount || 4);
  ui.practiceScope.value = store.settings.practiceScope || "all";
  ui.spellHint.value = store.settings.spellHint || "full";

  await loadDictionaryIndex();
  renderDictionarySelect();

  sumAllStats();
  renderQuestion();

  // resume session if exists (optional)
  const s = store.session;
  if (s?.active && !fromImport) {
    // attempt to restore if dictionary/units exist; user can just click start for a fresh deck
    if (s.dictionaryId && s.deck?.length) {
      session = { ...session, ...s };
      currentDeck = [...s.deck];
      ui.combo.textContent = String(session.combo || 0);
      ui.dictSelect.value = s.dictionaryId;
      renderUnitsForSelectedDictionary();
      // re-check selected units
      const selectedSet = new Set(s.selectedUnits || []);
      [...ui.unitList.querySelectorAll("input[type=checkbox][data-unit-id]")]
        .forEach(cb => cb.checked = selectedSet.has(cb.dataset.unitId));
      updateSettingsFromUI();

      // Load words and render
      try {
        await loadSelectedUnitsWords();
        // if loadedWords differs, still try
        session.active = true;
        renderQuestion();
        showToast("已恢复上次进度");
      } catch {
        resetRoundState();
      }
    }
  }
}

(async function main(){
  wireEvents();
  await boot(false);
})();
