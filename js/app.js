(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const fmt = (n) => Math.round(n).toLocaleString("ko-KR");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const vibrate = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (_) {} };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const GEN_NAME = ["", "1대 · 나", "2대 · 내 아이", "3대 · 내 손주"];
  const SITE = "https://alekf9099.github.io/life/";

  /* ---------- 저장소 ---------- */
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem("once." + key); return v == null ? fallback : JSON.parse(v); } catch (_) { return fallback; }
    },
    set(key, val) { try { localStorage.setItem("once." + key, JSON.stringify(val)); } catch (_) {} },
  };
  const settings = Object.assign({ pace: "8", mode: "births", auto: false, mine: "", theme: "", play: "family" }, store.get("settings", {}));
  const saveSettings = () => store.set("settings", settings);
  let lives = store.get("lives", []);
  let families = store.get("families", []);
  let dailies = store.get("dailies", {}); // { "2026-10-11": rec }
  const MAX_LIVES = 60;

  /* ---------- 테마 ---------- */
  // 처음 열릴 때 바깥(예: 앱 뷰어)이 정한 테마가 있으면 따릅니다
  const hostTheme = document.documentElement.dataset.theme;
  function applyTheme() {
    const t = settings.theme || hostTheme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.dataset.theme = t;
    $('meta[name="theme-color"]').content = t === "light" ? "#F7F2E8" : "#070B1A";
  }
  $("#themeBtn").addEventListener("click", () => {
    settings.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    saveSettings(); applyTheme();
  });
  applyTheme();

  /* ---------- 화면 전환 ---------- */
  let current = "home";
  function go(name) {
    if (current === "life" && name !== "life") pause();
    current = name;
    $$("[data-screen]").forEach((s) => (s.hidden = s.dataset.screen !== name));
    window.scrollTo(0, 0);
    if (name === "sky") renderSky();
    if (name === "home") renderHome();
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]");
    if (!b) return;
    const leave = () => {
      if (current === "life" || current === "birth") abandon();
      go(b.dataset.go);
    };
    if (current === "life" && life && life.alive) {
      const wasPlaying = playing;
      pause();
      askConfirm("지금 삶을 멈추고 나갈까요?", "이 삶은 저장되지 않아요.", "나가기").then((ok) => (ok ? leave() : wasPlaying && play()));
      return;
    }
    leave();
  });

  // 브라우저 confirm() 대신 쓰는 화면 안 확인창 (일부 환경에서는 confirm이 막혀 있음)
  function askConfirm(title, body, okLabel) {
    return new Promise((resolve) => {
      const box = $("#confirm");
      $("#confirmTitle").textContent = title;
      $("#confirmBody").textContent = body;
      $("#confirmOk").textContent = okLabel;
      box.hidden = false;
      const done = (v) => { box.hidden = true; box.onclick = null; resolve(v); };
      box.onclick = (e) => {
        if (e.target.closest("#confirmOk")) done(true);
        else if (e.target.closest("#confirmCancel") || e.target === box) done(false);
      };
      $("#confirmCancel").focus({ preventScroll: true });
    });
  }

  function toast(msg, ms = 2600) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (t.hidden = true), ms);
  }

  /* ---------- 밤하늘 ---------- */
  (() => {
    const cv = $("#sky"), ctx = cv.getContext("2d");
    let w, h, stars = [], last = 0, acc = 0;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    function resize() {
      w = innerWidth; h = innerHeight;
      cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = Array.from({ length: Math.round((w * h) / 5500) }, () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.2 + 0.2, p: Math.random() * 6.28, born: 0 }));
    }
    function frame(t) {
      const dt = Math.min(100, t - last); last = t;
      ctx.clearRect(0, 0, w, h);
      // 1초에 약 4명 — 새 별이 반짝입니다
      acc += dt / 1000 * WORLD.birthsPerSec;
      while (acc >= 1) { acc--; stars.push({ x: Math.random() * w, y: Math.random() * h * 0.9, r: Math.random() * 1.4 + 0.6, p: 0, born: t }); if (stars.length > 400) stars.splice(0, 1); }
      for (const s of stars) {
        const age = s.born ? (t - s.born) / 1000 : 9;
        const flash = age < 1.2 ? 1 - age / 1.2 : 0;
        const a = 0.35 + 0.35 * Math.sin(t / 900 + s.p) + flash * 0.6;
        ctx.globalAlpha = Math.max(0, Math.min(1, a));
        ctx.fillStyle = flash ? "#FFE3A3" : "#DDE3FF";
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r + flash * 1.8, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (!reduceMotion && !document.hidden) requestAnimationFrame(frame);
    }
    resize();
    addEventListener("resize", resize);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && !reduceMotion) { last = performance.now(); requestAnimationFrame(frame); } });
    requestAnimationFrame(frame);
  })();

  /* ---------- 오늘의 아이 ---------- */
  const DAILY_EPOCH = Date.UTC(2026, 9, 11);
  function todayKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function dailyNo(key = todayKey()) {
    const [y, m, d] = key.split("-").map(Number);
    return Math.floor((Date.UTC(y, m - 1, d) - DAILY_EPOCH) / 864e5) + 1;
  }
  function streak() {
    let n = 0;
    const d = new Date();
    if (!dailies[todayKey(d)]) d.setDate(d.getDate() - 1); // 오늘 아직이면 어제부터 셈
    while (dailies[todayKey(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  /* ---------- 홈 ---------- */
  const PALETTE = ["#F6C35B", "#FF7A8A", "#5FE3C0", "#A594FF", "#6EC6FF", "#FF9F5A", "#C6E26B"];
  const shareOf = (c, mode = settings.mode) => (mode === "even" ? 1 / COUNTRIES.length : c.births / TOTAL_BIRTHS);

  function renderHome() {
    const ranked = [...COUNTRIES].sort((a, b) => shareOf(b) - shareOf(a) || b.births - a.births);
    const top = settings.mode === "even" ? [] : ranked.slice(0, 7);
    const groups = top.map((c, i) => ({ label: `${c.flag} ${c.name}`, share: shareOf(c), color: PALETTE[i] }));
    const restShare = 1 - groups.reduce((s, g) => s + g.share, 0);
    groups.push({ label: settings.mode === "even" ? `${COUNTRIES.length}개국 모두` : `그 밖의 ${COUNTRIES.length - top.length}개국`, share: restShare, color: "var(--mute)" });

    // 최대 나머지 방식으로 100개 점 배분
    const raw = groups.map((g) => g.share * 100);
    const n = raw.map(Math.floor);
    let left = 100 - n.reduce((a, b) => a + b, 0);
    raw.map((v, i) => [v - n[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left-- > 0) n[i]++; });

    const dots = $("#dots100");
    dots.innerHTML = groups.map((g, gi) => Array.from({ length: n[gi] }, () => `<span style="--c:${g.color}"></span>`).join("")).join("");
    $$("span", dots).forEach((d, i) => (d.style.animationDelay = `${i * 8}ms`));
    $("#legend").innerHTML = groups.map((g, i) => `<li><i style="--c:${g.color}"></i>${g.label}<b>${n[i]}</b></li>`).join("");
    $("#dotMode").textContent = settings.mode === "even" ? "모든 나라 같은 확률" : "실제 출생 비율";

    $("#lifeCount").hidden = !lives.length;
    $("#lifeCount").textContent = lives.length;

    // 오늘의 아이 카드
    const done = dailies[todayKey()];
    $("#dailyNo").textContent = `#${dailyNo()}`;
    $("#dailyDesc").textContent = done
      ? `오늘 완료 · ${done.flag} ${done.name}에서 ${done.age}년을 살았어요`
      : "오늘 하루, 모두가 같은 아이로 태어나요. 3분 · 하루 한 번";
    const s = streak();
    $("#streak").hidden = !s;
    $("#streak").textContent = `🔥${s}`;
    syncModes();
  }

  function syncModes() {
    $$(".mode-card").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === settings.play)));
    const label = { family: "3대 가계도 시작", daily: dailies[todayKey()] ? "오늘의 결과 보기" : "오늘의 아이로 태어나기", single: "태어나기" };
    $("#bornLabel").textContent = label[settings.play];
    $$(".settings .seg-group, .settings .toggle-row").forEach((el) => el.classList.toggle("dim", settings.play === "daily"));
  }

  $(".modes").addEventListener("click", (e) => {
    const b = e.target.closest(".mode-card"); if (!b) return;
    settings.play = b.dataset.mode; saveSettings(); syncModes();
  });

  function initSettings() {
    $$(".seg").forEach((seg) => {
      const key = seg.dataset.key;
      const sync = () => $$("button", seg).forEach((b) => b.setAttribute("aria-checked", String(b.dataset.val === settings[key])));
      seg.addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return;
        settings[key] = b.dataset.val; saveSettings(); sync();
        if (key === "mode") renderHome();
      });
      sync();
    });
    const auto = $("#autoPick");
    auto.checked = settings.auto;
    auto.addEventListener("change", () => { settings.auto = auto.checked; saveSettings(); });

    const sel = $("#myCountry");
    [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name, "ko")).forEach((c) => sel.add(new Option(`${c.flag} ${c.name}`, c.code)));
    sel.value = settings.mine;
    sel.addEventListener("change", () => { settings.mine = sel.value; saveSettings(); });
  }

  // 오늘 0시부터 지금까지 태어난 아기 수
  function tickCounter() {
    const now = new Date();
    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    $("#todayBirths").textContent = fmt(((now - midnight) / 1000) * WORLD.birthsPerSec);
  }
  setInterval(() => { if (current === "home" && !document.hidden) tickCounter(); }, 240);
  tickCounter();

  /* ---------- 한 판의 상태 ---------- */
  let life = null;
  let run = null; // { kind: "single"|"family"|"daily", familyId, gen, recs:[], dailyKey, pending }

  function abandon() {
    pause();
    if (run && run.kind === "daily") Sim.seed(null);
    life = null;
  }

  $("#bornBtn").addEventListener("click", () => {
    const kind = settings.play;
    if (kind === "daily") {
      const done = dailies[todayKey()];
      if (done) { showEnd(done); return; }
      const key = todayKey();
      run = { kind, dailyKey: key, no: dailyNo(key) };
      Sim.seed(`once-daily-${key}`);
      life = Sim.born({ mode: "births" });
    } else if (kind === "family") {
      run = { kind, familyId: Date.now().toString(36), recs: [] };
      life = Sim.born({ mode: settings.mode });
    } else {
      run = { kind: "single" };
      life = Sim.born({ mode: settings.mode });
    }
    go("birth");
    runRoulette(life);
  });

  function runRoulette(p) {
    const flag = $("#rFlag"), name = $("#rName"), box = $("#roulette");
    $("#birthCard").hidden = true; box.classList.remove("done");
    $("#birthHint").textContent = run.kind === "daily" ? `오늘의 아이 #${run.no}` : "어디에서 눈을 뜰까요";
    const steps = reduceMotion ? 1 : 22;
    let i = 0;
    const next = () => {
      if (current !== "birth") return;
      if (i < steps - 1) {
        const c = COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
        flag.textContent = c.flag; name.textContent = c.name;
        i++;
        setTimeout(next, 45 + i * i * 0.9);
        return;
      }
      flag.textContent = p.c.flag; name.textContent = p.c.name;
      box.classList.add("done");
      vibrate([30, 60, 30]);
      revealBirth(p);
    };
    next();
  }

  function revealBirth(p) {
    const c = p.c;
    $("#birthHint").textContent = run.kind === "family" ? `${GEN_NAME[p.gen]} · 여기에서 태어났어요` : "여기에서 태어났어요";
    const share = shareOf(c, run.kind === "daily" ? "births" : settings.mode) * 100;
    $("#birthOdds").textContent = run.kind === "family" && p.gen > 1
      ? `윗세대가 남긴 자리에서 시작해요`
      : settings.mode === "even" && run.kind !== "daily"
        ? `${COUNTRIES.length}개국 중 하나, 확률 ${share.toFixed(1)}%`
        : `오늘 태어나는 아기 100명 중 약 ${share < 1 ? share.toFixed(1) : Math.round(share)}명이 이곳에서 태어나요`;
    $("#birthText").textContent = p.log.filter((l) => l.age === 0).map((l) => l.text).join(" ");
    $("#birthFacts").innerHTML = [
      ["기대수명", `${c.le}<small>세</small>`],
      ["첫돌 전 사망", `${c.imr < 10 ? c.imr.toFixed(1) : Math.round(c.imr)}<small>/1000명</small>`],
      ["1인당 소득(PPP)", `$${fmt(c.gdp)}`],
      ["평균 교육", `${c.school}<small>년</small>`],
    ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
    $("#birthCard").hidden = false;
  }

  $("#startLifeBtn").addEventListener("click", startLife);

  /* ---------- 삶 ---------- */
  let timer = null, playing = false, speed = 1, rendered = 0, wakeLock = null, resumeOnShow = false;

  const paceMin = () => (run && run.kind === "daily" ? 3 : Number(settings.pace));
  const yearMs = () => (paceMin() * 60000) / Math.max(45, life.home.le) / speed;

  function startLife() {
    const p = life;
    rendered = 0;
    $("#feed").innerHTML = "";
    $("#cohort").innerHTML = Array.from({ length: 100 }, (_, i) => `<i${i === 0 ? ' class="me"' : ""}></i>`).join("");
    const badge = $("#genBadge");
    badge.hidden = run.kind === "single";
    badge.textContent = run.kind === "daily" ? `📅 오늘의 아이 #${run.no}` : `🌳 ${GEN_NAME[p.gen]}`;
    speed = 1; syncSpeed();
    go("life");
    renderLife();
    play();
  }

  function renderLife() {
    const p = life;
    const ageEl = $(".age");
    if ($("#lifeAge").textContent !== String(p.age)) {
      $("#lifeAge").textContent = p.age;
      ageEl.classList.remove("tick"); void ageEl.offsetWidth; ageEl.classList.add("tick");
    }
    $("#lifeFlag").textContent = p.c.flag;
    $("#lifeCountry").textContent = p.c.name;
    $("#lifeYear").textContent = `${p.birthYear + p.age}년 · ${p.abroad ? "이주해 와서" : p.urban ? "도시에서" : "시골에서"}`;

    for (const k of ["h", "j", "k", "r"]) {
      const el = $(`.stat[data-k="${k}"]`);
      $("i", el).style.width = p[k] + "%";
      $("b", el).textContent = Math.round(p[k]);
    }

    const inc = $("#lifeIncome");
    if (p.job && p.income) {
      const monthKrw = (p.income * WORLD.krwPerPPP) / 12 / 10000;
      inc.innerHTML = `$${fmt(p.income)}<small>한국 물가로 월 약 ${fmt(monthKrw)}만 원</small>`;
    } else {
      inc.innerHTML = `${p.age < 15 ? "가족과 함께" : "소득 없음"}<small>${Sim.familyWord(p)} 집</small>`;
    }

    const alive = Sim.aliveOf100(p.home, p.age);
    $$("#cohort i").forEach((d, i) => d.classList.toggle("gone", i === 0 ? !p.alive : i >= alive));

    const feed = $("#feed");
    for (; rendered < p.log.length; rendered++) {
      const e = p.log[rendered];
      const prev = p.log[rendered - 1];
      const li = document.createElement("li");
      li.className = e.tone;
      li.innerHTML = `<span class="yr">${prev && prev.age === e.age ? "" : e.age + "세"}</span><p></p>`;
      $("p", li).textContent = e.text;
      feed.prepend(li);
    }

    renderSpark($("#spark"), p.hist, Math.max(p.age, Math.round(p.home.le)));
  }

  function renderSpark(svg, hist, span) {
    if (hist.length < 2) { svg.innerHTML = ""; return; }
    const x = (a) => (a / span) * 300, y = (v) => 46 - (v / 100) * 44;
    const d = hist.map((h, i) => `${i ? "L" : "M"}${x(h.age).toFixed(1)},${y(h.j).toFixed(1)}`).join("");
    svg.innerHTML = `<path class="area" d="${d}L${x(hist[hist.length - 1].age).toFixed(1)},48L0,48Z"/><path class="line" d="${d}"/>`;
  }

  function tick() {
    const p = life;
    if (!p || !p.alive) return;
    Sim.step(p);
    renderLife();
    if (!p.alive) { pause(); vibrate(200); setTimeout(() => finish(p), 2200); return; }

    const d = Sim.pendingDecision(p);
    if (d) {
      if (settings.auto && run.kind !== "daily") {
        const idx = Sim.autoPick(d);
        Sim.decide(p, d, idx);
        toast(`${d.catIcon} 운에 맡겼어요 · ${d.options[idx].label}`);
      } else {
        pause(); askDecision(p, d); return;
      }
    }
    Sim.advance(p);
    renderLife();
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    if (playing) timer = setTimeout(tick, yearMs());
  }

  async function play() {
    playing = true; syncPlay(); schedule();
    try { if ("wakeLock" in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request("screen"); } catch (_) {}
  }
  function pause() {
    playing = false; clearTimeout(timer); syncPlay();
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }

  const ICON_PLAY = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6.5 4h4v16h-4zM13.5 4h4v16h-4z" fill="currentColor"/></svg>';
  function syncPlay() {
    const b = $("#playBtn");
    b.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
    b.setAttribute("aria-label", playing ? "일시정지" : "계속");
  }
  function syncSpeed() { $$(".speeds button").forEach((b) => b.setAttribute("aria-checked", String(Number(b.dataset.speed) === speed))); }

  $("#playBtn").addEventListener("click", () => { if (!life || !life.alive || !$("#sheet").hidden) return; playing ? pause() : play(); });
  $(".speeds").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    speed = Number(b.dataset.speed); syncSpeed();
    if (playing) schedule();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && playing && current === "life") { pause(); resumeOnShow = true; }
    else if (!document.hidden && resumeOnShow) { resumeOnShow = false; if (life && life.alive && $("#sheet").hidden) play(); }
  });

  function askDecision(p, d) {
    vibrate(15);
    $("#sheetAge").textContent = `${p.age}세 · 갈림길`;
    $("#sheetCat").textContent = `${d.catIcon} ${d.catName}`;
    $("#sheetFmt").textContent = d.fmtName;
    $("#sheetFmt").dataset.fmt = d.fmt;
    $("#sheetQ").textContent = d.q;
    const box = $("#sheetChoices");
    box.innerHTML = "";
    d.options.forEach((o, i) => {
      const b = document.createElement("button");
      b.className = "choice";
      b.innerHTML = `<strong></strong>${o.hint ? "<small></small>" : ""}`;
      $("strong", b).textContent = o.label;
      if (o.hint) $("small", b).textContent = o.hint;
      b.addEventListener("click", () => {
        $("#sheet").hidden = true;
        Sim.decide(p, d, i);
        Sim.advance(p);
        renderLife();
        play();
      });
      box.append(b);
    });
    const r = document.createElement("button");
    r.className = "choice luck";
    r.innerHTML = "<strong>🎲 운에 맡긴다</strong><small>무엇이 될지 모릅니다</small>";
    r.addEventListener("click", () => box.children[Sim.autoPick(d)].click());
    box.append(r);
    $("#sheet").hidden = false;
    $(".choice", box).focus({ preventScroll: true });
  }

  /* ---------- 끝 ---------- */
  function finish(p) {
    if (life !== p) return;
    const s = Sim.summary(p);
    const rec = {
      id: Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      ts: Date.now(),
      code: s.country.code, flag: s.country.flag, name: s.country.name,
      abroad: s.abroad ? { flag: s.abroad.flag, name: s.abroad.name } : null,
      birthYear: s.birthYear, sex: s.sex, age: s.age, cause: s.cause, family: s.family,
      school: s.schoolYears, uni: s.uni, job: s.job, married: s.married, kids: s.kids, grandkids: s.grandkids, moved: s.moved,
      peak: Math.round(s.peakIncome), worldPct: s.worldPct, outlived: s.outlived,
      localStart: s.localStart, localEnd: s.localEnd,
      best: s.best.age, worst: s.worst.age, avgJ: s.avgJ, epitaph: "",
      choices: s.choices.map((c) => ({ cat: c.cat, tone: c.tone })),
      no: (store.get("serial", 0) || 0) + 1,
    };
    store.set("serial", rec.no);

    if (run.kind === "daily") {
      Sim.seed(null);
      rec.daily = { key: run.dailyKey, no: run.no };
      dailies[run.dailyKey] = rec;
      store.set("dailies", dailies);
    }
    if (run.kind === "family") {
      rec.familyId = run.familyId; rec.gen = p.gen;
      run.recs.push(rec);
      run.next = p.gen < 3 ? Sim.inherit(p) : null;
    }
    lives.unshift(rec);
    lives = lives.slice(0, MAX_LIVES);
    store.set("lives", lives);
    life = null;

    if (run.kind === "family" && p.gen === 3) {
      const fam = { id: run.familyId, ts: Date.now(), recs: run.recs.map((r) => r.id), snap: run.recs };
      families.unshift(fam); families = families.slice(0, 20);
      store.set("families", families);
    }
    showEnd(rec);
  }

  let shown = null;
  function showEnd(rec) {
    shown = rec;
    const fam = run && run.kind === "family" && rec.familyId === run.familyId;
    $("#endTitle").textContent = (rec.gen ? `${GEN_NAME[rec.gen]} · ` : "") + (rec.age === 0 ? "첫돌을 맞지 못한 삶" : `${rec.age}년의 삶`);
    $("#receipt").innerHTML = receiptHTML(rec);
    $("#receipt").style.animation = "";
    renderCompare(rec);
    renderDailyCard(rec);
    const ep = $("#epitaph");
    ep.value = rec.epitaph || ""; $("#epiCount").textContent = ep.value.length;

    const nextBtn = $("#nextGenBtn"), again = $("#againBtn");
    if (fam && rec.gen < 3 && run.recs[run.recs.length - 1] === rec) {
      nextBtn.hidden = false; again.hidden = true;
      nextBtn.textContent = `${rec.gen + 1}대로 이어 가기`;
    } else if (fam && rec.gen === 3 && run.recs.length === 3) {
      nextBtn.hidden = false; again.hidden = true;
      nextBtn.textContent = "3대의 이야기 보기";
    } else {
      nextBtn.hidden = true; again.hidden = false;
      again.textContent = rec.daily ? "다른 모드로 태어나기" : "다시 태어나기";
    }
    go("end");
  }

  const pctText = (p) => (p >= 0.5 ? `상위 ${Math.max(1, Math.round((1 - p) * 100))}%` : `하위 ${Math.max(1, Math.round(p * 100))}%`);

  function receiptRows(rec) {
    const d = new Date(rec.ts);
    const tag = rec.daily ? `오늘의 아이 #${rec.daily.no}` : rec.gen ? `가계도 ${rec.gen}대` : `No.${String(rec.no).padStart(4, "0")}`;
    return {
      head: `${tag} · ${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`,
      groups: [
        [
          ["출생", `${rec.flag} ${rec.name} · ${rec.birthYear}`],
          ["성별", rec.sex === "F" ? "여성" : "남성"],
          ["집안", `${rec.family} 집`],
        ],
        [
          ["학교", rec.school ? `${rec.school}년${rec.uni ? " · 대학" : ""}` : "다니지 못함"],
          ["일", rec.job || "—"],
          ["가족", [rec.married ? "결혼" : "혼자", rec.kids ? `자녀 ${rec.kids}` : "", rec.grandkids ? `손주 ${rec.grandkids}` : ""].filter(Boolean).join(" · ")],
          ...(rec.moved ? [["이주", `${rec.moved}회${rec.abroad ? ` · ${rec.abroad.flag} ${rec.abroad.name}` : ""}`]] : []),
          ["최고 연소득", rec.peak ? `$${fmt(rec.peak)}` : "—"],
          ...(rec.worldPct != null ? [["세계 소득", pctText(rec.worldPct)]] : []),
          ...(rec.age >= 5 ? [["가장 빛난 해", `${rec.best}세`], ["가장 힘든 해", `${rec.worst}세`]] : []),
        ],
      ],
      total: [`${rec.age}년`, rec.cause],
      note: rec.age >= 1 ? `동갑내기 100명 중 ${rec.outlived}명보다 오래 살았어요` : "동갑내기 대부분은 이 해를 넘겼어요",
    };
  }

  function receiptHTML(rec) {
    const r = receiptRows(rec);
    const row = ([k, v]) => `<div class="row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`;
    return `
      <h4>ONCE</h4>
      <p class="sub">한 번의 생 · 영수증<br>${esc(r.head)}</p>
      <hr>${r.groups.map((g) => g.map(row).join("")).join("<hr>")}
      <hr>
      <div class="row total"><span>살아낸 시간</span><span>${r.total[0]}</span></div>
      <div class="row"><span>마지막</span><span>${esc(r.total[1])}</span></div>
      <hr>
      <p class="note">${esc(r.note)}</p>
      ${rec.epitaph ? `<p class="note">“${esc(rec.epitaph)}”</p>` : ""}
      <hr>
      <div class="row"><span>지불</span><span>운 100% · 환불 불가</span></div>
      <div class="barcode"></div>`;
  }

  function renderCompare(rec) {
    const box = $("#compare");
    const mine = COUNTRIES.find((c) => c.code === settings.mine);
    const there = COUNTRIES.find((c) => c.code === rec.code);
    if (!mine || !there || mine === there) { box.hidden = true; return; }
    const rows = [
      ["기대수명", `${there.le}세`, `${mine.le}세`],
      ["첫돌 전 사망", `${there.imr}/1000`, `${mine.imr}/1000`],
      ["1인당 소득(PPP)", `$${fmt(there.gdp)}`, `$${fmt(mine.gdp)}`],
      ["평균 교육", `${there.school}년`, `${mine.school}년`],
      ["삶의 만족도", `${there.sat}/10`, `${mine.sat}/10`],
    ];
    box.innerHTML = `<h2>내가 태어난 곳과 비교</h2>
      <table class="cmp"><thead><tr><th></th><th>${there.flag} 이번 삶</th><th>${mine.flag} 실제 나</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("")}</tbody></table>`;
    box.hidden = false;
  }

  /* ---------- 오늘의 결과 (워들식 공유) ---------- */
  const TONE_SQ = { good: "🟩", neutral: "🟨", bad: "🟥" };
  function dailyText(rec) {
    const grid = (rec.choices || []).map((c) => `${Sim.CATS[c.cat].icon}${TONE_SQ[c.tone]}`).join(" ") || "선택의 순간이 오기 전에 떠났어요";
    const s = streak();
    return [
      `ONCE 오늘의 아이 #${rec.daily.no}`,
      `${rec.flag} ${rec.sex === "F" ? "여성" : "남성"} · ${rec.age}세${rec.job ? " · " + rec.job : ""}`,
      grid,
      s > 1 ? `🔥 ${s}일 연속` : "",
      SITE,
    ].filter(Boolean).join("\n");
  }
  function renderDailyCard(rec) {
    const box = $("#dailyCard");
    if (!rec.daily) { box.hidden = true; return; }
    $("#dailyGrid").textContent = dailyText(rec).split("\n").slice(0, 3).join("\n");
    const s = streak();
    $("#dailyStreakChip").textContent = s ? `🔥 ${s}일 연속` : `#${rec.daily.no}`;
    box.hidden = false;
  }
  $("#dailyShareBtn").addEventListener("click", async () => {
    if (!shown || !shown.daily) return;
    const text = dailyText(shown);
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
    } catch (e) { if (e && e.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(text); toast("결과를 복사했어요. 친구에게 붙여 넣어 보세요"); }
    catch (_) { toast("복사하지 못했어요"); }
  });

  let epiT;
  $("#epitaph").addEventListener("input", (e) => {
    $("#epiCount").textContent = e.target.value.length;
    if (!shown) return;
    shown.epitaph = e.target.value.trim();
    clearTimeout(epiT);
    epiT = setTimeout(() => {
      store.set("lives", lives); store.set("dailies", dailies); store.set("families", families);
      $("#receipt").style.animation = "none"; $("#receipt").innerHTML = receiptHTML(shown);
    }, 500);
  });

  $("#againBtn").addEventListener("click", () => {
    if (shown && shown.daily) { settings.play = "family"; saveSettings(); go("home"); return; }
    $("#bornBtn").click();
  });
  $("#nextGenBtn").addEventListener("click", () => {
    if (!run || run.kind !== "family") return;
    if (run.next) showBridge(); else showFamily(run.recs);
  });

  /* ---------- 세대 사이 ---------- */
  function treeHTML(recs, nextGen) {
    const nodes = recs.map((r) => `
      <li class="node" data-id="${r.id}">
        <span class="node-gen">${r.gen}대</span>
        <button class="node-card">
          <span class="node-flag">${r.flag}</span>
          <span class="node-body">
            <strong>${esc(r.name)} · ${r.sex === "F" ? "여성" : "남성"} · ${r.age}세</strong>
            <small>${r.birthYear}–${r.birthYear + r.age} · ${esc(r.job || "일하지 못함")} · 학교 ${r.school}년</small>
          </span>
          <span class="node-pct" title="나라 안 경제적 위치">${pctText(r.localEnd)}</span>
        </button>
      </li>`).join("");
    const ghost = nextGen ? `<li class="node unborn"><span class="node-gen">${nextGen}대</span><div class="node-card"><span class="node-flag">👶</span><span class="node-body"><strong>곧 태어나요</strong><small>${esc(GEN_NAME[nextGen])}</small></span></div></li>` : "";
    return nodes + ghost;
  }
  function bindTree(el, recs) {
    $$(".node[data-id] .node-card", el).forEach((b) => b.addEventListener("click", () => {
      const r = recs.find((x) => x.id === b.closest(".node").dataset.id);
      if (r) showEnd(r);
    }));
  }

  function showBridge() {
    const last = run.recs[run.recs.length - 1];
    const ng = last.gen + 1;
    $("#bridgeEyebrow").textContent = `${GEN_NAME[last.gen]}의 삶이 끝났어요`;
    $("#bridgeTitle").textContent = run.next.viaSibling ? "형제자매의 아이가 가문을 이어요" : `이제 ${GEN_NAME[ng].split(" · ")[1]}가 태어나요`;
    $("#bridgeLede").textContent = run.next.viaSibling
      ? "직계 자녀가 없어서 형제자매의 아이가 태어나요. 같은 집안이라 형편은 이어지지만, 대물림은 조금 약해져요."
      : `${run.next.parentAgeAtBirth}살에 얻은 아이예요. 당신이 남긴 것들이 이 아이의 출발선이 됩니다.`;
    $("#bridgeTree").innerHTML = treeHTML(run.recs, ng);
    bindTree($("#bridgeTree"), run.recs);
    $("#gifts").innerHTML = run.next.gifts.map(([i, t]) => `<li><span>${i}</span>${esc(t)}</li>`).join("");
    $("#bornNextBtn").textContent = `${ng}대로 태어나기`;
    go("bridge");
  }

  $("#bornNextBtn").addEventListener("click", () => {
    if (!run || !run.next) return;
    life = Sim.born({ inherit: run.next });
    run.next = null;
    go("birth");
    runRoulette(life);
  });

  /* ---------- 3대 결과 ---------- */
  function showFamily(recs) {
    const a = recs[0], c = recs[recs.length - 1];
    const startPct = a.localStart, endPct = c.localEnd;
    const diff = Math.round((endPct - startPct) * 100);
    $("#familyTitle").textContent = `${pctText(startPct)}에서 ${pctText(endPct)}로`;
    $("#familyLede").textContent = diff > 8
      ? `3대에 걸쳐 가문의 형편이 ${diff}%p 올라갔어요. 운과 선택이 함께 만든 길이에요.`
      : diff < -8
        ? `3대에 걸쳐 가문의 형편이 ${-diff}%p 내려갔어요. 어떤 운은 선택으로도 막기 어려웠어요.`
        : "3대가 지나도 출발선은 크게 달라지지 않았어요. 많은 나라에서 실제로 그렇습니다.";
    $("#familyTree").innerHTML = treeHTML(recs);
    bindTree($("#familyTree"), recs);
    renderMobility(recs);
    const country = COUNTRIES.find((x) => x.code === recs[recs.length - 1].code);
    const rho = country ? Sim.rhoOf(country) : 0.45;
    $("#mobilityNote").textContent = `점선은 태어날 때, 실선은 생의 끝 위치예요 (0 = 가장 가난, 100 = 가장 부유). ${country ? country.name + "에서는" : ""} 부모의 경제적 위치가 자녀에게 약 ${Math.round(rho * 100)}% 이어지는 편이에요 (세대 간 상관 근사치).`;
    $("#nextGenBtn").hidden = true;
    go("family");
  }

  function renderMobility(recs) {
    const svg = $("#mobility");
    const W = 320, H = 170, L = 34, R = 14, T = 14, B = 30;
    const x = (i) => L + (i * (W - L - R)) / Math.max(1, recs.length - 1);
    const y = (v) => T + (1 - v) * (H - T - B);
    const grid = [0, 0.25, 0.5, 0.75, 1].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="g"/><text x="${L - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${Math.round(v * 100)}</text>`).join("");
    const path = (k) => recs.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join("");
    const dots = recs.map((r, i) => `<circle cx="${x(i)}" cy="${y(r.localEnd)}" r="5" class="pt"/><text x="${x(i)}" y="${H - 8}" class="ax" text-anchor="middle">${r.gen}대 ${r.flag}</text>`).join("");
    svg.innerHTML = `${grid}<path d="${path("localStart")}" class="ls"/><path d="${path("localEnd")}" class="le"/>${dots}`;
  }

  $("#newFamilyBtn").addEventListener("click", () => { settings.play = "family"; saveSettings(); $("#bornBtn").click(); });

  /* ---------- 이미지 공유 ---------- */
  $("#shareBtn").addEventListener("click", () => shown && shareImage(drawReceiptImage(shown), `once-${shown.no}.png`, `${shown.flag} ${shown.name}에서 ${shown.age}년을 살았어요.`));
  $("#familyShareBtn").addEventListener("click", () => run && run.recs && shareImage(drawFamilyImage(run.recs), "once-family.png", "우리 가문 3대의 이야기"));

  async function shareImage(canvasPromise, name, text) {
    const cv = await canvasPromise;
    const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
    const file = new File([blob], name, { type: "image/png" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "ONCE · 한 번의 생", text });
        return;
      }
    } catch (e) { if (e && e.name === "AbortError") return; }
    // 공유를 쓸 수 없으면 이미지를 띄워 길게 눌러(또는 우클릭으로) 저장하게 합니다
    const view = $("#imgView"), img = $("#imgViewImg");
    if (img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(blob);
    view.hidden = false;
  }
  $("#imgView").addEventListener("click", (e) => {
    if (e.target.closest("#imgViewClose") || e.target === e.currentTarget) e.currentTarget.hidden = true;
  });

  async function baseCanvas() {
    try { await document.fonts.ready; } catch (_) {}
    const W = 1080, H = 1350, cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    const bg = g.createRadialGradient(W / 2, -200, 100, W / 2, 300, 1400);
    bg.addColorStop(0, "#1A2150"); bg.addColorStop(1, "#070B1A");
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 180; i++) {
      g.globalAlpha = Math.random() * 0.7 + 0.1; g.fillStyle = "#DDE3FF";
      g.beginPath(); g.arc(Math.random() * W, Math.random() * H, Math.random() * 2 + 0.4, 0, 6.283); g.fill();
    }
    g.globalAlpha = 1;
    const font = getComputedStyle(document.body).fontFamily;
    const footer = () => {
      g.textAlign = "center"; g.fillStyle = "#B7BDD6"; g.font = `600 28px ${font}`;
      g.fillText("어디서 태어날지 고를 수 없는 삶, 그리고 대물림", W / 2, H - 90);
      g.fillStyle = "#F6C35B"; g.font = `800 26px ${font}`; g.fillText("ONCE", W / 2, H - 46);
    };
    return { cv, g, W, H, font, footer };
  }

  async function drawReceiptImage(rec) {
    const { cv, g, W, font, footer } = await baseCanvas();
    const glow = g.createRadialGradient(W / 2, 170, 0, W / 2, 170, 90);
    glow.addColorStop(0, "rgba(246,195,91,.9)"); glow.addColorStop(1, "rgba(246,195,91,0)");
    g.fillStyle = glow; g.fillRect(W / 2 - 90, 80, 180, 180);
    g.fillStyle = "#F6C35B"; g.beginPath(); g.arc(W / 2, 170, 14, 0, 6.283); g.fill();

    const r = receiptRows(rec);
    const lines = r.groups.flat();
    const RX = 150, RW = W - 300, RY = 300;
    const RH = 300 + lines.length * 46 + (rec.epitaph ? 60 : 0);
    g.fillStyle = "#FBF8F1";
    g.beginPath(); g.roundRect(RX, RY, RW, RH, 10); g.fill();
    g.fillStyle = "#1E1E24"; g.textAlign = "center";
    g.font = `800 40px ${font}`; g.fillText("O N C E", W / 2, RY + 70);
    g.font = `500 22px ${font}`; g.fillStyle = "#6B6B78"; g.fillText(`한 번의 생 · ${r.head}`, W / 2, RY + 108);
    const dash = (y) => { g.save(); g.setLineDash([10, 8]); g.strokeStyle = "#BDB9AE"; g.lineWidth = 2; g.beginPath(); g.moveTo(RX + 40, y); g.lineTo(RX + RW - 40, y); g.stroke(); g.restore(); };
    dash(RY + 138);
    let y = RY + 186;
    for (const [k, v] of lines) {
      g.textAlign = "left"; g.fillStyle = "#55555F"; g.font = `500 26px ${font}`; g.fillText(k, RX + 44, y);
      g.textAlign = "right"; g.fillStyle = "#1E1E24"; g.font = `700 26px ${font}`; g.fillText(v, RX + RW - 44, y);
      y += 46;
    }
    dash(y - 16); y += 30;
    g.textAlign = "left"; g.fillStyle = "#1E1E24"; g.font = `800 34px ${font}`; g.fillText("살아낸 시간", RX + 44, y);
    g.textAlign = "right"; g.fillText(r.total[0], RX + RW - 44, y);
    y += 50; g.textAlign = "center"; g.font = `500 24px ${font}`; g.fillStyle = "#55555F"; g.fillText(r.note, W / 2, y);
    if (rec.epitaph) { y += 50; g.font = `600 26px ${font}`; g.fillStyle = "#1E1E24"; g.fillText(`“${rec.epitaph}”`, W / 2, y); }
    footer();
    return cv;
  }

  async function drawFamilyImage(recs) {
    const { cv, g, W, font, footer } = await baseCanvas();
    g.textAlign = "center";
    g.fillStyle = "#B7BDD6"; g.font = `600 30px ${font}`; g.fillText("3대의 이야기", W / 2, 150);
    g.fillStyle = "#EEF0F8"; g.font = `800 64px ${font}`;
    g.fillText(`${pctText(recs[0].localStart)} → ${pctText(recs[recs.length - 1].localEnd)}`, W / 2, 240);
    const top = 340, gap = 260;
    g.strokeStyle = "rgba(246,195,91,.6)"; g.lineWidth = 4;
    g.beginPath(); g.moveTo(170, top + 60); g.lineTo(170, top + gap * (recs.length - 1) + 60); g.stroke();
    recs.forEach((r, i) => {
      const y = top + i * gap;
      g.fillStyle = "#F6C35B"; g.beginPath(); g.arc(170, y + 60, 16, 0, 6.283); g.fill();
      g.fillStyle = "rgba(255,255,255,.07)"; g.beginPath(); g.roundRect(220, y, 720, 200, 24); g.fill();
      g.textAlign = "left";
      g.fillStyle = "#F6C35B"; g.font = `800 28px ${font}`; g.fillText(GEN_NAME[r.gen], 260, y + 56);
      g.fillStyle = "#EEF0F8"; g.font = `700 38px ${font}`; g.fillText(`${r.flag} ${r.name} · ${r.age}세`, 260, y + 112);
      g.fillStyle = "#B7BDD6"; g.font = `500 26px ${font}`;
      g.fillText(`${r.birthYear}–${r.birthYear + r.age} · ${r.job || "일하지 못함"} · 학교 ${r.school}년`, 260, y + 160);
      g.textAlign = "right"; g.fillStyle = "#5FE3C0"; g.font = `800 30px ${font}`; g.fillText(pctText(r.localEnd), 910, y + 112);
    });
    footer();
    return cv;
  }

  /* ---------- 별자리 ---------- */
  function hash(s) { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0) / 4294967295; }
  function joyColor(v) {
    const t = Math.max(0, Math.min(1, (v - 25) / 55));
    const a = [140, 160, 255], b = [246, 195, 91];
    return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(",")})`;
  }

  function renderSky() {
    $("#skyTitle").textContent = lives.length ? `${lives.length}개의 별` : "아직 별이 없어요";
    $("#clearBtn").hidden = !lives.length;
    const cv = $("#constellation"), dpr = Math.min(devicePixelRatio || 1, 2);
    const w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const pts = lives.slice().reverse().map((l) => ({ l, x: 24 + hash(l.id) * (w - 48), y: 24 + hash(l.id + "y") * (h - 48), r: 2 + Math.sqrt(l.age) * 0.75 }));
    // 가문끼리 금빛 선으로
    const byFam = {};
    pts.forEach((p) => { if (p.l.familyId) (byFam[p.l.familyId] = byFam[p.l.familyId] || []).push(p); });
    g.strokeStyle = "rgba(246,195,91,.55)"; g.lineWidth = 1.4;
    Object.values(byFam).forEach((ps) => { ps.sort((a, b) => a.l.gen - b.l.gen); g.beginPath(); ps.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke(); });
    for (const p of pts) {
      const c = joyColor(p.l.avgJ);
      const gl = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
      gl.addColorStop(0, c.replace("rgb", "rgba").replace(")", ",.45)")); gl.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gl; g.beginPath(); g.arc(p.x, p.y, p.r * 4, 0, 6.283); g.fill();
      g.fillStyle = c; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.283); g.fill();
    }
    cv.onclick = (e) => {
      const rc = cv.getBoundingClientRect();
      const hit = pts.find((p) => Math.hypot(p.x - (e.clientX - rc.left), p.y - (e.clientY - rc.top)) < Math.max(18, p.r * 2));
      if (hit) openRecord(hit.l);
    };

    const list = $("#lifeList");
    list.innerHTML = "";
    for (const l of lives) {
      const li = document.createElement("li");
      const tag = l.daily ? `📅 #${l.daily.no}` : l.gen ? `🌳 ${l.gen}대` : "";
      li.innerHTML = `<button><span class="lf">${l.flag}</span><span><strong></strong><small></small></span><span class="la">${l.age}</span></button>`;
      $("strong", li).textContent = `${tag ? tag + " · " : ""}${l.name} · ${l.sex === "F" ? "여성" : "남성"}${l.job ? " · " + l.job : ""}`;
      $("small", li).textContent = l.epitaph ? `“${l.epitaph}”` : `${l.cause} · 평균 행복 ${l.avgJ}`;
      $("button", li).addEventListener("click", () => openRecord(l));
      list.append(li);
    }
  }

  // 별자리에서 열 때: 가문 기록이면 3대 결과를, 아니면 영수증을
  function openRecord(l) {
    const fam = l.familyId && families.find((f) => f.id === l.familyId);
    if (fam) { run = { kind: "family", familyId: fam.id, recs: fam.snap }; showFamily(fam.snap); return; }
    showEnd(l);
  }

  $("#clearBtn").addEventListener("click", async () => {
    if (!(await askConfirm("모든 별을 지울까요?", "오늘의 아이 연속 기록도 사라지고, 되돌릴 수 없어요.", "모두 지우기"))) return;
    lives = []; families = []; dailies = {};
    store.set("lives", lives); store.set("families", families); store.set("dailies", dailies);
    renderSky(); renderHome();
  });

  /* ---------- 시작 ---------- */
  initSettings();
  renderHome();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
