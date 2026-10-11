(() => {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const fmt = (n) => Math.round(n).toLocaleString("ko-KR");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const vibrate = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (_) {} };

  /* ---------- 저장소 ---------- */
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem("once." + key); return v == null ? fallback : JSON.parse(v); } catch (_) { return fallback; }
    },
    set(key, val) { try { localStorage.setItem("once." + key, JSON.stringify(val)); } catch (_) {} },
  };
  const settings = Object.assign({ pace: "8", mode: "births", auto: false, mine: "", theme: "" }, store.get("settings", {}));
  const saveSettings = () => store.set("settings", settings);
  let lives = store.get("lives", []);
  const MAX_LIVES = 40;

  /* ---------- 테마 ---------- */
  function applyTheme() {
    const t = settings.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
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
    if (current === "life" && life && life.alive && !confirm("지금 삶을 멈추고 나갈까요? 이 삶은 저장되지 않아요.")) return;
    if (current === "life") life = null;
    go(b.dataset.go);
  });

  function toast(msg, ms = 2600) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (t.hidden = true), ms);
  }

  /* ---------- 밤하늘 ---------- */
  const sky = (() => {
    const cv = $("#sky"), ctx = cv.getContext("2d");
    let w, h, stars = [], dpr = Math.min(devicePixelRatio || 1, 2), last = 0, acc = 0;
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

  /* ---------- 홈 ---------- */
  const PALETTE = ["#F6C35B", "#FF7A8A", "#5FE3C0", "#A594FF", "#6EC6FF", "#FF9F5A", "#C6E26B"];

  function shareOf(c) {
    return settings.mode === "even" ? 1 / COUNTRIES.length : c.births / TOTAL_BIRTHS;
  }

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
  }

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

  /* ---------- 출생 ---------- */
  let life = null;

  $("#bornBtn").addEventListener("click", () => {
    life = Sim.born({ mode: settings.mode });
    go("birth");
    runRoulette(life);
  });

  function runRoulette(p) {
    const flag = $("#rFlag"), name = $("#rName"), box = $("#roulette");
    $("#birthCard").hidden = true; box.classList.remove("done");
    $("#birthHint").textContent = "어디에서 눈을 뜰까요";
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
    $("#birthHint").textContent = "여기에서 태어났어요";
    const share = shareOf(c) * 100;
    $("#birthOdds").textContent = settings.mode === "even"
      ? `${COUNTRIES.length}개국 중 하나, 확률 ${share.toFixed(1)}%`
      : `오늘 태어나는 아기 100명 중 약 ${share < 1 ? share.toFixed(1) : Math.round(share)}명이 이곳에서 태어나요`;
    $("#birthText").textContent = p.log[0].text;
    const income = c.gdp;
    $("#birthFacts").innerHTML = [
      ["기대수명", `${c.le}<small>세</small>`],
      ["첫돌 전 사망", `${c.imr < 10 ? c.imr.toFixed(1) : Math.round(c.imr)}<small>/1000명</small>`],
      ["1인당 소득(PPP)", `$${fmt(income)}`],
      ["평균 교육", `${c.school}<small>년</small>`],
    ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
    $("#birthCard").hidden = false;
  }

  $("#startLifeBtn").addEventListener("click", startLife);

  /* ---------- 삶 ---------- */
  let timer = null, playing = false, speed = 1, rendered = 0, wakeLock = null;

  function yearMs() {
    return (Number(settings.pace) * 60000) / Math.max(45, life.home.le) / speed;
  }

  function startLife() {
    const p = life;
    rendered = 0;
    $("#feed").innerHTML = "";
    $("#lifeFlag").textContent = p.c.flag;
    $("#lifeCountry").textContent = p.c.name;
    $("#cohort").innerHTML = Array.from({ length: 100 }, (_, i) => `<i${i === 0 ? ' class="me"' : ""}></i>`).join("");
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
    $("#lifeYear").textContent = `${p.birthYear + p.age}년 · ${p.abroad ? `${p.abroad.flag} ${p.abroad.name}에서` : p.urban ? "도시에서" : "시골에서"}`;
    $("#lifeFlag").textContent = p.c.flag;

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

    const alive = Sim.aliveOf100(life.home, p.age);
    $$("#cohort i").forEach((d, i) => d.classList.toggle("gone", i === 0 ? !p.alive : i >= alive));

    // 새 기록
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
      if (settings.auto) {
        const idx = Sim.autoPick(d);
        Sim.decide(p, d, idx);
        toast(`운에 맡겼어요 · ${d.options[idx].label}`);
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
    r.className = "choice";
    r.innerHTML = "<strong>운에 맡긴다</strong><small>무엇이 될지 모릅니다</small>";
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
      id: Date.now().toString(36),
      ts: Date.now(),
      code: s.country.code, flag: s.country.flag, name: s.country.name,
      abroad: s.abroad ? { flag: s.abroad.flag, name: s.abroad.name } : null,
      birthYear: p.birthYear, sex: s.sex, age: s.age, cause: s.cause, family: s.family,
      school: s.schoolYears, uni: s.uni, job: s.job, married: s.married, kids: s.kids, grandkids: s.grandkids, moved: s.moved,
      peak: Math.round(s.peakIncome), worldPct: s.worldPct, outlived: s.outlived,
      best: s.best.age, worst: s.worst.age, avgJ: s.avgJ, epitaph: "",
      no: (store.get("serial", 0) || 0) + 1,
    };
    store.set("serial", rec.no);
    lives.unshift(rec);
    lives = lives.slice(0, MAX_LIVES);
    store.set("lives", lives);
    life = null;
    showEnd(rec);
  }

  let shown = null;
  function showEnd(rec) {
    shown = rec;
    $("#endTitle").textContent = rec.age === 0 ? "첫돌을 맞지 못한 삶" : `${rec.age}년의 삶`;
    $("#receipt").innerHTML = receiptHTML(rec);
    renderCompare(rec);
    const ep = $("#epitaph");
    ep.value = rec.epitaph || ""; $("#epiCount").textContent = ep.value.length;
    go("end");
  }

  const pctText = (p) => (p >= 0.5 ? `상위 ${Math.max(1, Math.round((1 - p) * 100))}%` : `하위 ${Math.max(1, Math.round(p * 100))}%`);

  function receiptRows(rec) {
    const d = new Date(rec.ts);
    return {
      head: `No.${String(rec.no).padStart(4, "0")} · ${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`,
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

  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  function receiptHTML(rec) {
    const r = receiptRows(rec);
    const row = ([k, v]) => `<div class="row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`;
    return `
      <h4>ONCE</h4>
      <p class="sub">한 번의 생 · 영수증<br>${r.head}</p>
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

  let epiT;
  $("#epitaph").addEventListener("input", (e) => {
    $("#epiCount").textContent = e.target.value.length;
    if (!shown) return;
    shown.epitaph = e.target.value.trim();
    clearTimeout(epiT);
    epiT = setTimeout(() => { store.set("lives", lives); $("#receipt").innerHTML = receiptHTML(shown); $("#receipt").style.animation = "none"; }, 500);
  });

  $("#againBtn").addEventListener("click", () => $("#bornBtn").click());

  /* ---------- 이미지 공유 ---------- */
  $("#shareBtn").addEventListener("click", async () => {
    if (!shown) return;
    const blob = await drawShareImage(shown);
    const file = new File([blob], `once-${shown.no}.png`, { type: "image/png" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "ONCE · 한 번의 생", text: `${shown.flag} ${shown.name}에서 ${shown.age}년을 살았어요.` });
        return;
      }
    } catch (e) { if (e && e.name === "AbortError") return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("이미지를 저장했어요");
  });

  async function drawShareImage(rec) {
    try { await document.fonts.ready; } catch (_) {}
    const W = 1080, H = 1350, cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    const font = getComputedStyle(document.body).fontFamily;
    const bg = g.createRadialGradient(W / 2, -200, 100, W / 2, 300, 1400);
    bg.addColorStop(0, "#1A2150"); bg.addColorStop(1, "#070B1A");
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 180; i++) {
      g.globalAlpha = Math.random() * 0.7 + 0.1; g.fillStyle = "#DDE3FF";
      g.beginPath(); g.arc(Math.random() * W, Math.random() * H, Math.random() * 2 + 0.4, 0, 6.283); g.fill();
    }
    g.globalAlpha = 1;
    // 별
    const glow = g.createRadialGradient(W / 2, 170, 0, W / 2, 170, 90);
    glow.addColorStop(0, "rgba(246,195,91,.9)"); glow.addColorStop(1, "rgba(246,195,91,0)");
    g.fillStyle = glow; g.fillRect(W / 2 - 90, 80, 180, 180);
    g.fillStyle = "#F6C35B"; g.beginPath(); g.arc(W / 2, 170, 14, 0, 6.283); g.fill();

    // 영수증
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
    g.font = `500 26px ${font}`;
    for (const [k, v] of lines) {
      g.textAlign = "left"; g.fillStyle = "#55555F"; g.fillText(k, RX + 44, y);
      g.textAlign = "right"; g.fillStyle = "#1E1E24"; g.font = `700 26px ${font}`; g.fillText(v, RX + RW - 44, y); g.font = `500 26px ${font}`;
      y += 46;
    }
    dash(y - 16); y += 30;
    g.textAlign = "left"; g.fillStyle = "#1E1E24"; g.font = `800 34px ${font}`; g.fillText("살아낸 시간", RX + 44, y);
    g.textAlign = "right"; g.fillText(r.total[0], RX + RW - 44, y);
    y += 50; g.textAlign = "center"; g.font = `500 24px ${font}`; g.fillStyle = "#55555F"; g.fillText(r.note, W / 2, y);
    if (rec.epitaph) { y += 50; g.font = `600 26px ${font}`; g.fillStyle = "#1E1E24"; g.fillText(`“${rec.epitaph}”`, W / 2, y); }

    g.textAlign = "center"; g.fillStyle = "#B7BDD6"; g.font = `600 28px ${font}`;
    g.fillText("어디서 태어날지 고를 수 없는 단 한 번의 삶", W / 2, H - 90);
    g.fillStyle = "#F6C35B"; g.font = `800 26px ${font}`; g.fillText("ONCE", W / 2, H - 46);
    return new Promise((res) => cv.toBlob(res, "image/png"));
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
    g.strokeStyle = "rgba(180,190,230,.25)"; g.lineWidth = 1;
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke();
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
      if (hit) showEnd(hit.l);
    };

    const list = $("#lifeList");
    list.innerHTML = "";
    for (const l of lives) {
      const li = document.createElement("li");
      li.innerHTML = `<button><span class="lf">${l.flag}</span><span><strong></strong><small></small></span><span class="la">${l.age}</span></button>`;
      $("strong", li).textContent = `${l.name} · ${l.sex === "F" ? "여성" : "남성"}${l.job ? " · " + l.job : ""}`;
      $("small", li).textContent = l.epitaph ? `“${l.epitaph}”` : `${l.cause} · 평균 행복 ${l.avgJ}`;
      $("button", li).addEventListener("click", () => showEnd(l));
      list.append(li);
    }
  }

  $("#clearBtn").addEventListener("click", () => {
    if (!confirm("모든 별을 지울까요? 되돌릴 수 없어요.")) return;
    lives = []; store.set("lives", lives); renderSky(); renderHome();
  });

  /* ---------- 시작 ---------- */
  initSettings();
  renderHome();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
