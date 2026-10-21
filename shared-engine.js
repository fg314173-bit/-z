// shared-engine.js
// Единое ядро игры: регионы, вопросы, состояние, синхронизация между вкладками
// (student.html и teacher.html) через BroadcastChannel + localStorage.
// Требует запуска через локальный HTTP-сервер (ES-модули не работают из file://).

export const STORAGE_KEY = "cq_state_v1";
export const CHANNEL_NAME = "cq_sync_v1";
export const SEAT_LIMIT = 4;

export const REGIONS = [
  { id: "saryarka", name: "Сарыарқа", color: "#D9A441", glow: "#F6D27A" },
  { id: "jetisu", name: "Жетісу", color: "#2FA5A9", glow: "#7FE3E6" },
  { id: "mangystau", name: "Маңғыстау", color: "#C1543A", glow: "#F08A6E" },
  { id: "turkistan", name: "Түркістан", color: "#6B5B95", glow: "#B3A4E0" }
];

export const QUESTION_BANK = [
  { id: "q1", text: "Латинское слово «cultura» первоначально означало…", options: ["Возделывание, обработку земли", "Военный поход", "Торговый обмен", "Письменность"], correct: 0, points: 25 },
  { id: "q2", text: "Что лучше всего выражает кочевой образ жизни как систему культуры?", options: ["Каменная крепость", "Юрта — разборное жилище", "Морской порт", "Библиотека-хранилище"], correct: 1, points: 25 },
  { id: "q3", text: "Мавзолей Ходжи Ахмеда Ясави находится в городе…", options: ["Туркестан", "Актау", "Семей", "Костанай"], correct: 0, points: 25 },
  { id: "q4", text: "Великий Шёлковый путь соединял в первую очередь…", options: ["Индию и Африку", "Восток и Запад через Евразию", "Европу и Америку", "Север и Юг Африки"], correct: 1, points: 25 },
  { id: "q5", text: "«Золотой человек» из кургана Иссык относится к культуре…", options: ["Саков", "Гуннов", "Монголов", "Арабов"], correct: 0, points: 25 },
  { id: "q6", text: "Петроглифы Тамгалы находятся в регионе…", options: ["Маңғыстау", "Жетісу", "Алтай", "Акмолинская область"], correct: 1, points: 25 },
  { id: "q7", text: "Прозвание «Второй учитель» (после Аристотеля) закрепилось за…", options: ["Аль-Фараби", "Ибн Синой", "Яссауи", "Абаем"], correct: 0, points: 25 },
  { id: "q8", text: "Кюй — это…", options: ["Инструментальная пьеса для домбры", "Жанр письменной поэзии", "Тип жилища", "Свадебный обряд"], correct: 0, points: 25 },
  { id: "q9", text: "Наурыз традиционно празднуется в день…", options: ["Весеннего равноденствия", "Летнего солнцестояния", "Зимнего солнцестояния", "Осеннего равноденствия"], correct: 0, points: 25 },
  { id: "q10", text: "«Жеті жарғы» — это свод…", options: ["Обычного права казахов", "Торговых пошлин", "Военных званий", "Религиозных праздников"], correct: 0, points: 25 }
];

export const ECONOMY_PENALTY = 20;
export const CRISIS_THRESHOLD = 30;

function freshState() {
  return {
    phase: "lobby", // lobby | playing | ended
    regions: REGIONS.map(r => ({
      id: r.id, points: 0, economy: 100, members: [] // [{pid,name}]
    })),
    round: null, // {questionId, deadline, duration, votes:{regionId:{optIdx:count}}, submitted:{regionId:optIdx}, resolved:false, results:{}}
    customQuestions: [],
    log: []
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.regions)) return freshState();
    return s;
  } catch (e) {
    return freshState();
  }
}

export class GameEngine {
  constructor() {
    this.state = load();
    this.listeners = new Set();
    this.channel = ("BroadcastChannel" in window) ? new BroadcastChannel(CHANNEL_NAME) : null;
    if (this.channel) {
      this.channel.onmessage = (ev) => {
        if (ev.data && ev.data.type === "state") {
          this.state = ev.data.state;
          this._emit();
        }
      };
    }
    window.addEventListener("storage", (ev) => {
      if (ev.key === STORAGE_KEY && ev.newValue) {
        try {
          this.state = JSON.parse(ev.newValue);
          this._emit();
        } catch (e) {}
      }
    });
  }

  onChange(fn) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  _emit() {
    for (const fn of this.listeners) fn(this.state);
  }

  _commit() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    if (this.channel) this.channel.postMessage({ type: "state", state: this.state });
    this._emit();
  }

  _region(id) {
    return this.state.regions.find(r => r.id === id);
  }

  allQuestions() {
    return [...QUESTION_BANK, ...this.state.customQuestions];
  }

  log(msg) {
    this.state.log.unshift({ t: Date.now(), msg });
    this.state.log = this.state.log.slice(0, 30);
  }

  // ---- участники ----
  seatsTaken(regionId) {
    return this._region(regionId).members.length;
  }

  joinTeam(regionId, name) {
    const region = this._region(regionId);
    if (!region) return { ok: false, error: "Регион не найден" };
    if (region.members.length >= SEAT_LIMIT) return { ok: false, error: "Команда уже заполнена (4/4)" };
    const pid = "p_" + Math.random().toString(36).slice(2, 10);
    region.members.push({ pid, name });
    this.log(`${name} присоединился к команде «${REGIONS.find(r => r.id === regionId).name}»`);
    this._commit();
    return { ok: true, pid };
  }

  leaveTeam(regionId, pid) {
    const region = this._region(regionId);
    if (!region) return;
    region.members = region.members.filter(m => m.pid !== pid);
    this._commit();
  }

  // ---- раунд ----
  startRound(questionId, durationSec) {
    const q = this.allQuestions().find(q => q.id === questionId);
    if (!q) return { ok: false, error: "Вопрос не найден" };
    this.state.phase = "playing";
    this.state.round = {
      questionId,
      startedAt: Date.now(),
      duration: durationSec,
      votes: Object.fromEntries(this.state.regions.map(r => [r.id, {}])),
      submitted: {},
      resolved: false,
      results: {}
    };
    this.log(`Преподаватель запустил вопрос: «${q.text.slice(0, 40)}…»`);
    this._commit();
    return { ok: true };
  }

  castVote(regionId, pid, optionIdx) {
    const round = this.state.round;
    if (!round || round.resolved) return;
    if (round.submitted[regionId] !== undefined) return;
    round.votes[regionId][optionIdx] = (round.votes[regionId][optionIdx] || 0) + 1;
    this._commit();
  }

  teamSubmit(regionId) {
    const round = this.state.round;
    if (!round || round.resolved || round.submitted[regionId] !== undefined) return;
    const tally = round.votes[regionId] || {};
    let best = null, bestCount = -1;
    for (const [opt, count] of Object.entries(tally)) {
      if (count > bestCount) { best = Number(opt); bestCount = count; }
    }
    if (best === null) return;
    round.submitted[regionId] = best;
    this._commit();
  }

  pauseRound() {
    if (!this.state.round) return;
    this.state.round.paused = !this.state.round.paused;
    this._commit();
  }

  resolveRound() {
    const round = this.state.round;
    if (!round || round.resolved) return;
    const q = this.allQuestions().find(q => q.id === round.questionId);
    for (const region of this.state.regions) {
      const chosen = round.submitted[region.id];
      const correct = chosen === q.correct;
      round.results[region.id] = { chosen, correct };
      if (correct) {
        region.points += q.points;
      } else {
        region.economy = Math.max(0, region.economy - ECONOMY_PENALTY);
        this.log(`Команда «${REGIONS.find(r => r.id === region.id).name}» ответила неверно: −${ECONOMY_PENALTY}% экономики`);
      }
    }
    round.resolved = true;
    this._commit();
  }

  endRound() {
    this.state.round = null;
    this._commit();
  }

  // ---- ручная корректировка (преподаватель) ----
  adjustPoints(regionId, delta) {
    const r = this._region(regionId);
    if (!r) return;
    r.points = Math.max(0, r.points + delta);
    this.log(`Преподаватель изменил баллы «${REGIONS.find(x => x.id === regionId).name}»: ${delta > 0 ? "+" : ""}${delta}`);
    this._commit();
  }

  adjustEconomy(regionId, delta) {
    const r = this._region(regionId);
    if (!r) return;
    r.economy = Math.min(100, Math.max(0, r.economy + delta));
    this.log(`Преподаватель изменил экономику «${REGIONS.find(x => x.id === regionId).name}»: ${delta > 0 ? "+" : ""}${delta}%`);
    this._commit();
  }

  addCustomQuestion(text, options, correctIdx, points) {
    const id = "c_" + Math.random().toString(36).slice(2, 10);
    this.state.customQuestions.push({ id, text, options, correct: correctIdx, points: points || 25 });
    this._commit();
    return id;
  }

  freeSlot(regionId, pid) {
    this.leaveTeam(regionId, pid);
  }

  resetGame() {
    this.state = freshState();
    this._commit();
  }

  exportSummary() {
    return this.state.regions.map(r => {
      const meta = REGIONS.find(x => x.id === r.id);
      return {
        region: meta.name,
        members: r.members.map(m => m.name).join("; "),
        points: r.points,
        economy: r.economy,
        status: r.economy < CRISIS_THRESHOLD ? "кризис" : "норма"
      };
    }).sort((a, b) => b.points - a.points);
  }
}
