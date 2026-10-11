/*
 * ONCE 시뮬레이션 엔진
 * - 사망: 영아사망률 + 곰페르츠(Gompertz) 사망 곡선을 국가 기대수명에 맞춰 보정
 * - 소득: 국가 1인당 GDP(PPP)와 지니계수로 만든 로그정규 분포
 * - 교육·결혼·출산: 국가 평균 교육연수, 대학 취학률, 합계출산율을 가족 형편으로 조정
 * - 대물림: 부모의 소득 순위가 지역별 세대 간 상관(ρ)만큼 자녀에게 이어짐
 * - 오늘의 아이: 날짜로 시드를 고정해 모두가 같은 운을 받음
 * 모든 결과는 확률일 뿐, 정해진 운명은 없습니다.
 */
const Sim = (() => {
  const GOMPERTZ_B = 0.085;
  const SEX_MULT = { F: 0.78, M: 1.28 }; // 여성 기대수명이 평균 4–6년 길도록

  /*
   * 세대 간 소득 순위 상관 근사치 (Corak 2013, 세계은행 GDIM 2018의 경향을 지역별로 단순화)
   * 북유럽은 낮고(계층 이동이 쉬움), 중남미·아프리카는 높음
   */
  const RHO = { EU: 0.35, NA: 0.45, OC: 0.3, EA: 0.4, SEA: 0.45, SA: 0.5, ME: 0.5, AF: 0.55, LA: 0.6 };
  const rhoOf = (c) => (c.code === "SE" ? 0.25 : RHO[c.region] || 0.45);

  /* ---------- 난수 (오늘의 아이를 위해 시드 고정 가능) ---------- */
  let rand = Math.random;
  function hashStr(s) {
    let h = 1779033703 ^ s.length;
    for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return h >>> 0;
  }
  function seed(s) {
    if (s == null) { rand = Math.random; return; }
    let a = hashStr(String(s));
    rand = () => { // mulberry32
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const chance = (p) => rand() < p;
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const between = (a, b) => a + rand() * (b - a);
  const has = (list, c) => list.includes(c.code);

  function normal() {
    let u = 0, v = 0;
    while (!u) u = rand();
    while (!v) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // 표준정규 누적분포 (Abramowitz–Stegun 7.1.26)
  function phi(z) {
    const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
    return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
  }

  // 표준정규 역함수 (Acklam 근사)
  function invPhi(p) {
    p = clamp(p, 1e-9, 1 - 1e-9);
    const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
    const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
    const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
    const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
    const pl = 0.02425;
    if (p < pl) {
      const q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - pl) {
      const q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  /* ---------- 사망 모델 ---------- */

  function qx(c, age, mult = 1) {
    if (age === 0) return c.imr / 1000;
    if (age < 5) return (c.imr / 1000) * 0.08;
    return Math.min(1, 0.0004 + c._a * mult * Math.exp(GOMPERTZ_B * age));
  }

  function survival(c, mult = 1) {
    const S = [1];
    let e = 0;
    for (let x = 0; x < 120; x++) {
      const q = qx(c, x, mult);
      e += S[x] * (1 - q / 2);
      S.push(S[x] * (1 - q));
    }
    return { S, e };
  }

  function calibrate(c) {
    if (c._a) return;
    let lo = Math.log(1e-8), hi = Math.log(1e-1);
    for (let i = 0; i < 60; i++) {
      c._a = Math.exp((lo + hi) / 2);
      if (survival(c).e > c.le) lo = Math.log(c._a); else hi = Math.log(c._a);
    }
    c._S = survival(c).S;
  }
  COUNTRIES.forEach(calibrate);

  /* ---------- 소득 모델 ---------- */

  const sigmaFromGini = (g) => Math.SQRT2 * invPhi((g + 1) / 2);

  function incomeAt(c, pct) {
    const s = sigmaFromGini(c.gini);
    return c.gdp * Math.exp(s * invPhi(pct) - (s * s) / 2);
  }

  // 그 나라 안에서의 소득 순위 (0–1)
  function pctOfIncome(c, income) {
    const s = sigmaFromGini(c.gini);
    return phi((Math.log(income / c.gdp) + (s * s) / 2) / s);
  }

  function worldPercentile(income) {
    const s = sigmaFromGini(WORLD.gini);
    const median = WORLD.gdp * Math.exp(-(s * s) / 2);
    return phi(Math.log(income / median) / s);
  }

  const tierOf = (c) => (c.gdp < 5000 ? 0 : c.gdp < 15000 ? 1 : c.gdp < 35000 ? 2 : 3);

  /* ---------- 출생 ---------- */

  function pickCountry(mode) {
    const weight = mode === "even" ? () => 1 : (c) => c.births;
    let r = rand() * COUNTRIES.reduce((s, c) => s + weight(c), 0);
    for (const c of COUNTRIES) { r -= weight(c); if (r <= 0) return c; }
    return COUNTRIES[0];
  }

  function poissonish(mean) {
    let n = 0, p = Math.exp(-mean), s = p;
    const u = rand();
    while (u > s && n < 12) { n++; p *= mean / n; s += p; }
    return n;
  }

  // 결정의 순간이 찾아오는 나이 (생애 단계마다 한 번씩)
  const SLOT_AGES = [9, 15, 20, 26, 33, 41, 50, 60, 72];

  /*
   * opts.mode     "births" | "even"
   * opts.country  나라 고정
   * opts.inherit  윗세대에게 물려받는 것 (가계도 모드)
   */
  function born(opts = {}) {
    const inh = opts.inherit;
    const c = inh ? inh.country : opts.country || pickCountry(opts.mode);
    const sex = chance(0.512) ? "M" : "F";
    const wealthPct = inh ? inh.wealthPct : rand();
    const tier = tierOf(c);
    const urbanP = clamp(0.25 + 0.14 * Math.log(c.gdp / 1500), 0.15, 0.92);
    const urban = inh ? (chance(0.85) ? inh.urban : !inh.urban) : chance(urbanP);
    const siblings = Math.min(9, poissonish(Math.max(0, c.tfr - 1) * between(0.7, 1.3)));

    // 목표 교육연수: 국가 평균을 가족 형편(과 부모의 교육)으로 조정
    const eduZ = 0.6 * invPhi(wealthPct) + 0.8 * normal() + (inh ? inh.eduBoost : 0);
    let schoolTarget = clamp(Math.round(c.school + eduZ * 3.2), 0, 18);
    const uniP = clamp(c.tertiary * (0.35 + 1.3 * wealthPct) + (inh ? inh.eduBoost * 0.08 : 0), 0, 0.97);
    if (schoolTarget >= 12 && chance(uniP)) schoolTarget = Math.max(schoolTarget, 16);
    else schoolTarget = Math.min(schoolTarget, 12);

    const base = c.sat * 10;
    const p = {
      c, home: c, sex, tier, wealthPct, startPct: wealthPct, urban, siblings,
      birthYear: inh ? inh.birthYear : new Date().getFullYear(),
      gen: inh ? inh.gen : 1,
      age: 0, alive: true,
      h: clamp(72 + 10 * normal() - (tier === 0 ? 8 : 0), 25, 100),
      j: clamp(base + 8 * normal() + (wealthPct - 0.5) * 12, 10, 95),
      k: 5, r: clamp(55 + 10 * normal(), 20, 95),
      schoolTarget, schoolYears: 0, inSchool: false, uni: false,
      job: null, income: 0, retired: false, venture: null, smoker: false,
      married: false, divorced: false, kids: 0, kidAges: [], kidCap: 99, wantKids: false,
      kidInvest: 0, legacy: null, grandkids: 0,
      parents: { m: true, f: true, mAge: Math.round(between(18, 34)), fAge: Math.round(between(20, 40)), forced: null },
      moved: 0, abroad: null, migrant2: !!(inh && inh.migrant2), ill: 0,
      hist: [], log: [], decided: {}, seen: {}, choices: [], catCount: {},
      slots: SLOT_AGES.map((a) => a + Math.round(between(-1, 1))), pending: null,
      peakIncome: 0, lifetimeIncome: 0, cause: "",
    };
    p.mult = SEX_MULT[sex];

    if (inh && inh.parentSex && !inh.viaSibling) {
      const who = inh.parentSex === "F" ? "m" : "f";
      p.parents[who + "Age"] = inh.parentAgeAtBirth;
      p.parents.forced = { who, at: inh.parentDeathAt };
    }
    if (inh && inh.parentAbroadHome) p.ancestry = inh.parentAbroadHome;

    p.log.push({ age: 0, tone: "big", text: birthText(p, inh) });
    if (p.migrant2) p.log.push({ age: 0, tone: "neutral", text: `부모님은 ${p.ancestry ? p.ancestry.name + "에서" : "다른 나라에서"} 이주해 왔어요. 집에서는 다른 언어로 말해요.` });
    return p;
  }

  function familyWord(p) {
    const w = p.startPct ?? p.wealthPct;
    if (w < 0.2) return "가장 가난한 편에 속하는";
    if (w < 0.45) return "넉넉하지 않은";
    if (w < 0.8) return "평범한";
    if (w < 0.95) return "형편이 좋은";
    return "아주 부유한";
  }

  function birthText(p, inh) {
    const place = p.urban ? "도시" : "시골 마을";
    const sib = p.siblings === 0 ? "외동으로" : `형제자매 ${p.siblings}명과 함께`;
    const who = p.sex === "F" ? "여자" : "남자";
    if (inh && inh.viaSibling) return `윗세대의 형제자매에게서 ${who}아이로 태어나 가문의 이야기를 이어받았어요. ${p.c.name}의 ${place}, ${familyWord(p)} 집이에요.`;
    if (inh) return `${inh.parentSex === "F" ? "엄마" : "아빠"}가 ${inh.parentAgeAtBirth}살일 때, ${p.c.name}의 ${place}에서 ${who}아이로 태어났어요. ${familyWord(p)} 집에서 ${sib} 자라요.`;
    return `${p.c.name}의 한 ${place}, ${familyWord(p)} 집에서 ${who}아이로 태어났어요. ${sib} 자라게 됩니다.`;
  }

  /* ---------- 직업 ---------- */

  function assignJob(p) {
    const c = p.c, y = p.schoolYears;
    const farmP = [0.6, 0.35, 0.15, 0.03][p.tier] * (p.urban ? 0.3 : 1.4);
    let job;
    if (p.trade && y < 16) job = pick(["전기 기술자", "자동차 정비사", "용접공", "제빵사", "목수"]);
    else if (y >= 16) job = pick(["교사", "엔지니어", "회계사", "간호사", "공무원", "연구원", "개발자", "의사", "기자", "디자이너"]);
    else if (y >= 12) job = pick(["사무원", "판매원", "기술자", "운전기사", "요리사", "경찰관", "미용사", "공장 관리자"]);
    else if (chance(farmP)) job = pick(["농부", "목축업자", "어부", "농장 일꾼"]);
    else job = pick(["공장 노동자", "건설 노동자", "노점 상인", "가사 도우미", "배달원", "청소 노동자"]);

    const zFam = invPhi(clamp(p.wealthPct, 0.01, 0.99));
    const zEdu = (y - c.school) / 4 + (p.trade ? 0.35 : 0);
    const z = clamp(0.5 * zFam + 0.5 * zEdu + 0.45 * normal(), -2.6, 2.6);
    p.job = job;
    p.income = incomeAt(c, phi(z)) * (p.abroad ? 0.6 : 1); // 이주민은 같은 학력에서도 소득이 낮은 경향
    return job;
  }

  const capIncome = (p) => { p.income = Math.min(p.income, p.c.gdp * 6); };
  const nudgeWealth = (p, d) => { p.wealthPct = clamp(p.wealthPct + d, 0.01, 0.99); };

  /* ---------- 연간 진행 ---------- */

  const tone = (text, t = "neutral") => ({ text, tone: t });

  function yearEvents(p) {
    const c = p.c, a = p.age, ev = [];

    // 유년기 이정표
    if (a === 1) ev.push(tone(pick(["첫걸음을 뗐어요.", "처음으로 엄마, 아빠를 불렀어요.", "뒤뚱뒤뚱 걷기 시작했어요."])));
    if (a === 3 && chance(0.5)) ev.push(tone(pick(["좋아하는 노래가 생겼어요.", "동네 아이들과 처음으로 친구가 됐어요.", "할머니 옆에서 잠드는 걸 좋아해요."])));

    // 학교
    if (a === 6 || a === 7) {
      if (!p.inSchool && p.schoolYears === 0) {
        if (p.schoolTarget >= 1) { p.inSchool = true; ev.push(tone(p.migrant2 ? "학교에 들어갔어요. 처음엔 말이 서툴러 친구 사귀기가 어려웠어요." : "학교에 들어갔어요. 가방이 몸보다 커 보여요.", "good")); }
        else if (a === 7) { ev.push(tone(p.sex === "F" ? "학교에 가지 못하고 동생들을 돌보며 집안일을 해요." : "학교에 가지 못하고 가족 일을 돕기 시작했어요.", "bad")); p.j -= 3; }
      }
    }
    if (p.inSchool) {
      p.schoolYears++;
      p.k = clamp(p.k + between(3.5, 6.5) * (p.uni ? 1.2 : 1), 0, 100);
      if (p.schoolYears === 6 && p.schoolTarget > 6) ev.push(tone("초등 과정을 마쳤어요."));
      if (p.schoolYears === 12 && p.schoolTarget >= 12) ev.push(tone("고등학교를 졸업했어요.", "good"));
      if (p.schoolYears === 12 && p.schoolTarget >= 16 && !p.uni) { p.uni = true; ev.push(tone("대학에 입학했어요. 새로운 세상이 열려요.", "big")); p.j += 4; }
      if (p.schoolYears >= p.schoolTarget) {
        p.inSchool = false;
        if (p.uni && p.schoolYears >= 16) ev.push(tone("대학을 졸업했어요.", "big"));
        else if (p.schoolYears < 6 && p.schoolYears > 0) ev.push(tone("집안 사정으로 학교를 그만두었어요.", "bad"));
      }
    }

    // 일 시작
    const minWork = [10, 13, 15, 16][p.tier];
    if (!p.job && !p.inSchool && a >= minWork && !p.retired) {
      const job = assignJob(p);
      ev.push(tone(a < 15 ? `아직 어린 나이지만 ${job} 일을 시작했어요.` : `${job}(으)로 일하기 시작했어요.`, a < 15 ? "bad" : "good"));
    }

    // 부모님
    for (const who of ["m", "f"]) {
      if (!p.parents[who]) continue;
      const pa = p.parents[who + "Age"] + a;
      const forced = p.parents.forced && p.parents.forced.who === who ? p.parents.forced.at : null;
      const dies = forced != null ? a === forced : chance(qx(c, pa, who === "m" ? SEX_MULT.F : SEX_MULT.M));
      if (dies) {
        p.parents[who] = false;
        const name = who === "m" ? "어머니" : "아버지";
        const prev = forced != null ? "(지난 생에서 당신이었던) " : "";
        ev.push(tone(a < 15 ? `${prev}${name}가 세상을 떠났어요. 아직 너무 어린 나이였어요.` : `${prev}${name}가 ${pa}세로 세상을 떠났어요.`, "bad"));
        p.j -= a < 15 ? 15 : 8; p.r -= 3;
        if (a < 15) nudgeWealth(p, -0.12);
      }
    }
    if (a === 4 && !p.parents.m && !p.parents.f) ev.push(tone("할머니 손에서 자라요. 저녁마다 옛날이야기를 들어요."));

    // 결혼 · 이별
    if (!p.married && a >= 15 && a <= 45) {
      let mp = a < 18 ? 0 : a < 25 ? 0.07 : a < 35 ? 0.11 : 0.04;
      if (a >= 15 && a < 18 && p.sex === "F") mp = [0.05, 0.03, 0.004, 0][p.tier];
      if (p.tier <= 1 && a >= 18) mp *= 1.5;
      mp *= 0.6 + p.r / 125;
      if (chance(mp)) {
        p.married = true;
        if (a < 18) { ev.push(tone(`${a}살, 집안이 정한 사람과 결혼했어요.`, "bad")); p.inSchool = false; p.j -= 6; }
        else { ev.push(tone(pick(["사랑하는 사람과 결혼했어요.", "오랜 친구였던 사람과 가정을 꾸렸어요.", "작은 결혼식을 올렸어요. 모두가 웃었어요."]), "big")); p.j += 10; p.r += 10; }
      }
    } else if (p.married && a < 60 && chance([0.004, 0.006, 0.01, 0.013][p.tier])) {
      p.married = false; p.divorced = true;
      ev.push(tone("긴 대화 끝에 배우자와 헤어지기로 했어요.", "bad")); p.j -= 10; p.r -= 6;
    }

    // 자녀
    if (p.married && a >= 16 && a <= 44 && p.kids < p.kidCap) {
      let kp = clamp((c.tfr * 1.05) / 17, 0.02, 0.45) * (p.kids >= Math.ceil(c.tfr + 1) ? 0.3 : 1);
      if (p.wantKids) kp = Math.max(kp * 2.2, 0.3);
      if (chance(kp)) {
        p.kids++; p.kidAges.push(a); p.wantKids = false;
        ev.push(tone(p.kids === 1 ? "첫아이가 태어났어요. 세상이 달라 보여요." : `${p.kids}번째 아이가 태어났어요.`, "big"));
        p.j += 6; p.r += 6;
        if (p.sex === "F" && chance(c.imr / 1000 * 0.12)) { p.h -= 25; ev.push(tone("출산 후 몸이 크게 상했어요. 회복이 더뎌요.", "bad")); }
        if (chance(c.imr / 1000)) { ev.push(tone("아이가 첫돌을 맞지 못했어요. 그해는 아무 말도 하지 못했어요.", "bad")); p.j -= 20; p.kids--; p.kidAges.pop(); }
      }
    }
    if (p.kids && a >= 48 && chance(0.1 * p.kids / 2)) {
      p.grandkids++; ev.push(tone(p.grandkids === 1 ? "손주가 태어났어요." : `손주가 ${p.grandkids}명이 됐어요.`, "good")); p.j += 4;
    }

    // 은퇴
    if (p.job && !p.retired) {
      const retireAge = p.tier >= 2 ? Math.round(between(60, 66)) : 999;
      if (a >= retireAge || (a >= 70 && p.h < 45) || a >= 76) {
        p.retired = true;
        ev.push(tone(p.tier >= 2 ? `${a}세, ${p.job} 일을 마치고 은퇴했어요.` : `${a}세, 몸이 예전 같지 않아 일을 놓았어요.`, "neutral"));
        p.income *= p.tier >= 2 ? 0.55 : 0.3;
      }
    }

    // 무작위 사건 (같은 사건은 반복될수록 덜 나옴)
    const pool = EVENTS.filter((e) => a >= e.min && a <= e.max && (!e.when || e.when(p, c)));
    const weight = (e) => (e.w ? e.w(p, c) : 1) / (1 + 2 * (p.seen[EVENTS.indexOf(e)] || 0));
    const n = chance(0.55) ? 1 : chance(0.25) ? 2 : 0;
    for (let i = 0; i < n && pool.length; i++) {
      const tot = pool.reduce((s, e) => s + weight(e), 0);
      let r = rand() * tot;
      const e = pool.find((x) => (r -= weight(x)) <= 0) || pool[0];
      pool.splice(pool.indexOf(e), 1);
      const idx = EVENTS.indexOf(e);
      p.seen[idx] = (p.seen[idx] || 0) + 1;
      ev.push(tone(typeof e.text === "function" ? e.text(p, c) : pick(e.text), e.tone));
      e.fx && e.fx(p, c);
    }
    return ev;
  }

  /* ---------- 환경 ---------- */
  const TYPHOON = ["PH", "VN", "CN", "JP", "KR", "BD", "MM"];
  const QUAKE = ["JP", "TR", "IR", "ID", "MX", "CN", "AF", "PK", "IT", "CO"];
  const HEAT = ["IN", "PK", "SA", "IQ", "EG", "SD", "NE", "IR", "BD"];
  const DROUGHT = ["ET", "SD", "NE", "KE", "MZ", "MG", "AF", "AO", "TZ", "ZA"];
  const FLOOD = ["BD", "PK", "IN", "NG", "CN", "ID", "BR", "MZ", "MM", "VN"];
  const COLD = ["RU", "CA", "SE", "PL"];
  const SMOG = ["IN", "CN", "PK", "BD", "EG", "IQ"];
  const MALARIA = ["NG", "CD", "UG", "TZ", "MZ", "NE", "AO", "GH", "KE", "MG", "SD", "ET"];

  const FESTIVAL = {
    KR: "설날", CN: "춘절", VN: "뗏(설)", IN: "디왈리", JP: "오봉",
    PK: "이드", BD: "이드", ID: "르바란", EG: "이드", SA: "이드", IR: "노루즈", IQ: "이드", AF: "이드", TR: "바이람",
    TH: "송끄란", MM: "띤잔", MX: "망자의 날", BR: "카니발", CO: "크리스마스", AR: "크리스마스",
    ET: "팀캇", NG: "크리스마스", GH: "크리스마스", PH: "크리스마스",
  };
  const festivalOf = (c) => FESTIVAL[c.code] || (["EU", "NA", "OC", "LA"].includes(c.region) ? "크리스마스" : "마을 축제");

  // 사건 사전 (나이, 조건, 가중치, 효과)
  const EVENTS = [
    // 유년기
    { min: 2, max: 12, tone: "bad", text: ["열이 펄펄 끓는 병을 앓았어요.", "심한 설사병으로 며칠을 앓았어요."], w: (p) => [3, 1.5, 0.6, 0.3][p.tier], fx: (p) => (p.h -= 8) },
    { min: 2, max: 40, tone: "bad", text: ["말라리아에 걸려 한동안 누워 지냈어요."], when: (p) => has(MALARIA, p.c), w: () => 1.5, fx: (p) => (p.h -= 10) },
    { min: 3, max: 12, tone: "good", text: ["동네에서 제일 빠른 아이로 소문났어요.", "그림을 잘 그린다는 칭찬을 받았어요.", "책 한 권을 너덜너덜해질 때까지 읽었어요."], fx: (p) => { p.j += 4; p.k += 3; } },
    { min: 4, max: 14, tone: "bad", text: ["먹을 것이 부족한 해였어요. 배고픈 밤이 많았어요."], when: (p) => p.tier <= 1 && p.wealthPct < 0.35, w: () => 2, fx: (p) => { p.h -= 7; p.j -= 5; } },
    { min: 5, max: 14, tone: "bad", text: ["매일 새벽 물을 길으러 한 시간을 걸어요."], when: (p) => p.tier === 0 && !p.urban, w: () => 1.6, fx: (p) => { p.h -= 2; p.k -= 2; } },
    { min: 6, max: 17, tone: "good", text: ["평생 기억할 선생님을 만났어요.", "가장 친한 친구가 생겼어요."], when: (p) => p.inSchool, fx: (p) => { p.k += 4; p.r += 5; p.j += 3; } },
    { min: 8, max: 16, tone: "bad", text: ["학교에서 따돌림을 당했어요.", "시험 성적 때문에 크게 혼났어요."], when: (p) => p.inSchool, w: (p) => (p.tier >= 2 ? 1.2 : 0.6) + (p.migrant2 ? 1 : 0), fx: (p) => { p.j -= 6; p.r -= 3; } },
    { min: 8, max: 15, tone: "bad", text: ["학교 대신 시장에서 물건을 날라요.", "밭일을 돕느라 학교에 자주 빠졌어요."], when: (p) => p.tier === 0 && p.wealthPct < 0.4, w: () => 1.5, fx: (p) => { p.k -= 2; p.j -= 3; } },
    { min: 6, max: 16, tone: "neutral", text: ["학원과 숙제로 하루가 빽빽해요.", "밤 10시까지 공부하는 날이 많아요."], when: (p) => ["KR", "CN", "JP"].includes(p.c.code) && p.inSchool, w: () => 1.6, fx: (p) => { p.k += 3; p.j -= 3; } },
    { min: 6, max: 18, tone: "good", text: ["두 언어를 오가며 통역해 주는 아이가 됐어요."], when: (p) => p.migrant2, w: () => 2, fx: (p) => { p.k += 4; p.r += 2; } },
    { min: 10, max: 18, tone: "neutral", text: ["처음으로 스마트폰을 갖게 됐어요.", "인터넷으로 세상 소식을 처음 봤어요."], fx: (p) => { p.k += 2; p.j += 2; } },
    // 청소년·청년
    { min: 13, max: 19, tone: "good", text: ["첫사랑에 빠졌어요.", "처음으로 혼자 먼 곳까지 여행했어요.", "밤새 친구들과 미래를 이야기했어요."], fx: (p) => { p.j += 5; p.r += 3; } },
    { min: 14, max: 25, tone: "neutral", text: ["좋아하는 음악이 생겼어요. 매일 들어요.", "운동을 시작했어요."], fx: (p) => { p.j += 2; p.h += 3; } },
    // 일과 돈
    { min: 18, max: 45, tone: "bad", text: (p) => `${p.job || "일"} 자리를 잃었어요. 한동안 막막했어요.`, when: (p) => p.job && !p.retired, w: (p) => [0.6, 0.9, 1, 0.8][p.tier], fx: (p) => { p.income *= 0.85; p.j -= 8; } },
    { min: 20, max: 58, tone: "good", text: ["일터에서 인정받아 책임이 커졌어요.", "월급이 올랐어요. 작은 사치를 부렸어요."], when: (p) => p.job && !p.retired, w: (p) => 0.6 + p.k / 80, fx: (p) => { p.income *= 1.12; capIncome(p); p.j += 4; } },
    { min: 22, max: 60, tone: "bad", text: ["나라 경제가 흔들려 물가가 크게 올랐어요. 모아 둔 돈의 가치가 줄었어요."], w: (p) => [0.5, 0.7, 0.5, 0.3][p.tier], fx: (p) => { p.income *= 0.9; p.j -= 5; nudgeWealth(p, -0.04); } },
    { min: 24, max: 58, tone: "neutral", text: ["일터에 자동화 기계와 AI가 들어왔어요. 일하는 방식이 바뀌었어요."], when: (p) => p.job && !p.retired && p.tier >= 1, w: () => 0.7, fx: (p) => { if (p.k > 55) { p.income *= 1.08; } else { p.income *= 0.93; p.j -= 3; } } },
    { min: 25, max: 65, tone: "good", text: ["작은 집을 마련했어요. 내 이름으로 된 첫 집이에요."], when: (p) => p.job && !p.decided.home && (p.income > p.c.gdp * 0.9 || p.wealthPct > 0.7), fx: (p) => { p.decided.home = true; p.j += 8; nudgeWealth(p, 0.05); } },
    { min: 25, max: 60, tone: "bad", text: ["집값이 너무 올라 이사를 다녀야 했어요.", "출퇴근에만 하루 세 시간이 걸려요."], when: (p) => p.urban && p.tier >= 2, w: () => 0.9, fx: (p) => { p.j -= 4; p.h -= 2; } },
    { min: 20, max: 70, tone: "good", text: ["가족과 처음으로 바다를 보러 갔어요.", "오래 꿈꾸던 여행을 다녀왔어요."], when: (p) => p.income > 8000 || p.wealthPct > 0.6, fx: (p) => { p.j += 6; p.r += 2; } },
    // 시골과 도시
    { min: 10, max: 80, tone: "good", text: ["수확이 좋은 해였어요. 온 마을이 함께 잔치를 벌였어요.", "밤하늘의 별이 쏟아질 듯 많아요."], when: (p) => !p.urban, fx: (p) => { p.j += 5; p.r += 3; } },
    { min: 20, max: 85, tone: "bad", text: ["가까운 병원까지 버스로 반나절이 걸려요."], when: (p) => !p.urban && p.tier <= 2, w: () => 0.9, fx: (p) => { p.h -= 3; } },
    { min: 10, max: 80, tone: "neutral", text: ["밤에도 꺼지지 않는 도시의 불빛이 익숙해졌어요.", "이웃 얼굴도 모른 채 몇 년이 흘렀어요."], when: (p) => p.urban, fx: (p) => { p.r -= 2; p.k += 1; } },
    // 기후와 재난
    { min: 3, max: 90, tone: "bad", text: ["거센 태풍이 지나가며 지붕이 날아갔어요."], when: (p) => has(TYPHOON, p.c), w: (p) => (p.tier >= 3 ? 0.4 : 1), fx: (p) => { p.j -= 6; p.income *= 0.95; } },
    { min: 3, max: 90, tone: "bad", text: ["큰 지진이 났어요. 한동안 밖에서 잠을 잤어요."], when: (p) => has(QUAKE, p.c), w: () => 0.6, fx: (p) => { p.h -= 6; p.j -= 8; } },
    { min: 3, max: 90, tone: "bad", text: ["기록적인 폭염이 이어졌어요. 숨이 턱턱 막혀요."], when: (p) => has(HEAT, p.c), w: (p) => 1 + p.age / 80, fx: (p) => { p.h -= p.age > 60 ? 8 : 4; } },
    { min: 3, max: 90, tone: "bad", text: ["가뭄이 길게 이어져 수확이 거의 없었어요.", "우물이 말라 물을 사 먹어야 했어요."], when: (p) => has(DROUGHT, p.c), w: () => 1.2, fx: (p) => { p.income *= 0.85; p.j -= 6; nudgeWealth(p, -0.05); } },
    { min: 3, max: 90, tone: "bad", text: ["큰 홍수가 마을을 덮쳤어요. 집 일부가 무너졌어요."], when: (p) => has(FLOOD, p.c), w: (p) => (p.tier >= 2 ? 0.5 : 1.2), fx: (p) => { p.income *= 0.9; p.j -= 6; nudgeWealth(p, -0.04); } },
    { min: 3, max: 90, tone: "neutral", text: ["영하 30도의 긴 겨울을 났어요.", "눈이 너무 많이 와 며칠 동안 집에만 있었어요."], when: (p) => has(COLD, p.c), fx: (p) => { p.r += 2; p.h -= 1; } },
    { min: 3, max: 90, tone: "bad", text: ["뿌연 미세먼지 때문에 기침이 멈추지 않아요."], when: (p) => has(SMOG, p.c) && p.urban, w: () => 1.2, fx: (p) => { p.h -= 4; } },
    { min: 5, max: 80, tone: "bad", text: ["동네에서 총성이 들려 가족과 피란길에 올랐어요.", "분쟁이 격해져 한동안 집을 떠나 살았어요."], when: (p) => p.c.conflict, w: () => 1.6, fx: (p) => { p.h -= 8; p.j -= 12; p.income *= 0.7; } },
    // 시대
    { min: 0, max: 95, tone: "bad", text: ["새로운 전염병이 세계를 덮쳤어요. 몇 달 동안 사람들을 만나지 못했어요."], when: (p) => !p.decided.pandemic, w: () => 0.25, fx: (p) => { p.decided.pandemic = true; p.j -= 6; p.r -= 4; if (p.job && p.tier <= 1) p.income *= 0.85; } },
    // 문화
    { min: 4, max: 90, tone: "good", text: (p) => `${festivalOf(p.c)}에 온 가족이 모였어요. 하루 종일 웃음이 끊이지 않았어요.`, fx: (p) => { p.j += 4; p.r += 4; } },
    // 관계
    { min: 25, max: 70, tone: "bad", text: ["오래된 친구와 크게 다퉜어요."], fx: (p) => { p.r -= 6; p.j -= 3; } },
    { min: 30, max: 75, tone: "neutral", text: ["새로운 취미가 생겼어요. 주말이 기다려져요.", "동네 사람들과 모임을 시작했어요."], fx: (p) => { p.j += 3; p.r += 4; } },
    { min: 30, max: 90, tone: "good", text: ["아이가 학교에서 상을 받아 왔어요.", "아이와 밤새 이야기를 나눴어요."], when: (p) => p.kids > 0 && p.age < 60, fx: (p) => { p.j += 5; p.r += 3; } },
    // 건강
    { min: 18, max: 60, tone: "bad", text: ["교통사고를 당했지만 목숨은 건졌어요."], w: (p) => [1, 1.2, 0.8, 0.4][p.tier], fx: (p) => { p.h -= 15; p.j -= 4; } },
    { min: 35, max: 80, tone: "bad", text: ["당뇨 진단을 받았어요.", "혈압이 높다는 말을 들었어요."], w: (p) => (p.age > 50 ? 1.5 : 0.7), fx: (p) => { p.h -= 8; p.ill++; } },
    { min: 40, max: 85, tone: "bad", text: (p) => (p.tier >= 2 || p.wealthPct > 0.75 ? "암 진단을 받았어요. 길고 힘든 치료를 시작했어요." : "몸에 혹이 생겼지만 병원비가 없어 치료를 미뤘어요."), w: (p) => p.age / 60 * (p.smoker ? 1.6 : 1), fx: (p) => { p.h -= p.tier >= 2 || p.wealthPct > 0.75 ? 14 : 22; p.j -= 10; p.ill++; } },
    { min: 20, max: 80, tone: "good", text: ["아팠던 몸이 많이 회복됐어요."], when: (p) => p.h < 55, w: () => 1.2, fx: (p) => { p.h += 12; p.j += 4; } },
    { min: 30, max: 80, tone: "bad", text: ["마음이 무겁게 가라앉는 시간이 길었어요. 우울증이었어요."], w: (p) => (p.j < 45 ? 1.5 : 0.4), fx: (p) => { p.j -= 8; p.h -= 3; } },
    // 노년
    { min: 60, max: 100, tone: "neutral", text: ["오래된 사진첩을 꺼내 한참을 들여다봤어요.", "매일 아침 같은 길을 산책해요."], fx: (p) => { p.j += 2; } },
    { min: 60, max: 100, tone: "bad", text: ["가까운 친구가 먼저 세상을 떠났어요.", "형제가 세상을 떠났어요."], w: (p) => p.age / 50, fx: (p) => { p.j -= 7; p.r -= 5; } },
    { min: 65, max: 100, tone: "bad", text: ["넘어져 엉덩이뼈를 다쳤어요."], w: (p) => p.age / 70, fx: (p) => { p.h -= 12; } },
    { min: 60, max: 100, tone: "good", text: (p) => (p.grandkids ? "손주가 찾아와 하루 종일 집이 시끌벅적했어요." : "이웃이 매일 안부를 물어 줘요."), fx: (p) => { p.j += 5; p.r += 3; } },
    { min: 65, max: 100, tone: "bad", text: ["기억이 자꾸 흐려져요. 가족 이름이 늦게 떠올라요."], w: (p) => (p.age > 78 ? 1.5 : 0.4), fx: (p) => { p.k -= 8; p.j -= 4; } },
  ];

  /* ---------- 선택의 순간 ----------
   * 7개 분야를 고르게: 지금까지 가장 적게 나온 분야부터 고릅니다.
   * 형식: pick(선택) · risk(모험, 확률 표시) · split(배분) · dilemma(딜레마)
   */
  const CATS = {
    edu: { icon: "🎓", name: "배움" },
    work: { icon: "💼", name: "일·돈" },
    love: { icon: "❤️", name: "사랑·가족" },
    health: { icon: "🏥", name: "건강" },
    move: { icon: "🧭", name: "이주·환경" },
    people: { icon: "🤝", name: "관계" },
    value: { icon: "⚖️", name: "가치" },
  };
  const FORMATS = { pick: "선택", risk: "모험", split: "배분", dilemma: "딜레마" };
  const odds = (x) => `성공 확률 약 ${Math.round(clamp(x, 0.02, 0.98) * 100)}%`;

  const DECISIONS = [
    /* 🎓 배움 */
    {
      id: "e_recess", cat: "edu", fmt: "pick", min: 7, max: 12,
      when: (p) => p.inSchool,
      q: () => "쉬는 시간이에요. 무엇을 할까요?",
      options: [
        { label: "도서관에서 책을 읽는다", hint: "배움 ↑", run: (p) => { p.k += 6; return "책 속에서 처음 보는 나라들을 만났어요."; } },
        { label: "운동장에서 친구들과 뛴다", hint: "건강 ↑ · 관계 ↑", run: (p) => { p.h += 4; p.r += 5; return "흙투성이가 되어 돌아왔어요. 친구가 많아졌어요."; } },
      ],
    },
    {
      id: "e_continue", cat: "edu", fmt: "dilemma", min: 13, max: 16,
      when: (p) => p.inSchool && p.schoolTarget < 13,
      q: (p) => (p.wealthPct < 0.5 ? "집안 형편이 빠듯해요. 공부를 계속할까요?" : "공부가 점점 어려워져요. 계속할까요?"),
      options: [
        { label: "끝까지 공부한다", hint: "배움 ↑ · 당장은 힘듦", run: (p) => { p.schoolTarget = Math.max(p.schoolTarget, chance(p.c.tertiary * 0.8) ? 16 : 12); p.k += 5; p.j -= 3; return "어려워도 책을 놓지 않기로 했어요."; } },
        { label: "일을 시작해 가족을 돕는다", hint: "관계 ↑ · 배움 멈춤", run: (p) => { p.schoolTarget = p.schoolYears; p.inSchool = false; p.r += 6; nudgeWealth(p, 0.04); return "책가방 대신 일을 택했어요. 가족이 조금은 덜 배고파졌어요."; } },
      ],
    },
    {
      id: "e_path", cat: "edu", fmt: "risk", min: 16, max: 19,
      when: (p) => p.schoolYears >= 10 && !p.uni && !p.job,
      q: () => "졸업을 앞두고 갈 길을 정해야 해요.",
      options: [
        { label: "빚을 내서라도 대학에 간다", hint: (p) => odds(p.c.tertiary * 0.6 + p.k / 250), run: (p) => { if (chance(p.c.tertiary * 0.6 + p.k / 250)) { p.inSchool = true; p.uni = true; p.schoolTarget = p.schoolYears + 4; p.j += 4; nudgeWealth(p, -0.05); return "합격 통지서를 받았어요! 학자금 빚도 함께요."; } p.j -= 6; return "떨어졌어요. 한 해를 허비한 것 같아 속상해요."; } },
        { label: "기술을 배운다", hint: "안정적인 기술직", run: (p) => { p.trade = true; p.inSchool = false; p.schoolTarget = p.schoolYears; p.k += 4; return "직업학교에서 손에 익는 기술을 배웠어요."; } },
        { label: "바로 일을 시작한다", hint: "소득 먼저", run: (p) => { p.inSchool = false; p.schoolTarget = p.schoolYears; nudgeWealth(p, 0.03); return "하루라도 빨리 돈을 벌기로 했어요."; } },
      ],
    },
    {
      id: "e_relearn", cat: "edu", fmt: "dilemma", min: 25, max: 48,
      when: (p) => p.job && !p.retired,
      q: () => "퇴근 후 야간 강의를 들을 수 있어요.",
      options: [
        { label: "피곤해도 다시 공부한다", hint: "배움 ↑ · 소득 ↑ · 건강 ↓", run: (p) => { p.k += 9; p.h -= 4; p.income *= 1.1; capIncome(p); return "2년 만에 수료증을 받았어요. 몸은 고됐지만 뿌듯해요."; } },
        { label: "저녁은 가족과 보낸다", hint: "관계 ↑", run: (p) => { p.r += 6; p.j += 2; return "저녁 식탁에서 하루 이야기를 나눠요."; } },
      ],
    },
    {
      id: "e_late", cat: "edu", fmt: "pick", min: 62, max: 85,
      when: () => true,
      q: () => "남은 시간을 어떻게 보낼까요?",
      options: [
        { label: "내 이야기를 들려준다", hint: "관계 ↑", run: (p) => { p.r += 8; p.j += 4; return p.kids ? "아이들에게 젊은 날의 이야기를 들려줬어요." : "이웃 아이들이 내 이야기를 좋아해요."; } },
        { label: "배우고 싶던 걸 배운다", hint: "배움 ↑ · 행복 ↑", run: (p) => { p.k += 8; p.j += 5; return "이 나이에 처음 배우는 것도 즐거워요."; } },
      ],
    },

    /* 💼 일·돈 */
    {
      id: "w_offer", cat: "work", fmt: "risk", min: 18, max: 28,
      when: (p) => p.job && !p.retired,
      q: () => "두 곳에서 일자리 제안이 왔어요.",
      options: [
        { label: "오래 다닐 수 있는 곳", hint: "안정", run: (p) => { p.income *= 1.05; p.j += 2; return "월급은 적지만 마음은 편해요."; } },
        { label: "빠르게 크는 작은 회사", hint: (p) => odds(0.4 + p.k / 300), run: (p) => { if (chance(0.4 + p.k / 300)) { p.income *= 1.45; capIncome(p); p.j += 6; return "회사가 쑥쑥 컸어요. 내 몫도 커졌어요."; } p.income *= 0.8; p.j -= 6; return "1년 만에 회사가 문을 닫았어요."; } },
      ],
    },
    {
      id: "w_venture", cat: "work", fmt: "risk", min: 30, max: 46,
      when: (p) => p.job && !p.retired,
      q: () => "모아 둔 돈으로 작은 가게를 열 기회가 생겼어요.",
      options: [
        { label: "도전한다", hint: (p) => odds(0.3 + p.k / 300 + (p.wealthPct > 0.6 ? 0.1 : 0)), run: (p) => { if (chance(0.3 + p.k / 300 + (p.wealthPct > 0.6 ? 0.1 : 0))) { p.income *= 1.9; capIncome(p); p.venture = "성공"; p.j += 10; nudgeWealth(p, 0.08); return "가게가 자리를 잡았어요. 단골이 생겼어요!"; } p.income *= 0.6; p.venture = "실패"; p.j -= 12; p.h -= 5; nudgeWealth(p, -0.08); return "2년 만에 가게를 닫았어요. 빚이 남았어요."; } },
        { label: "지금 일을 지킨다", hint: "안정", run: (p) => { p.income *= 1.04; p.j += 1; return "지금 자리를 지키기로 했어요."; } },
      ],
    },
    {
      id: "w_bonus", cat: "work", fmt: "split", min: 26, max: 55,
      when: (p) => p.job && !p.retired,
      q: () => "생각지 못한 목돈이 생겼어요. 어디에 쓸까요?",
      options: [
        { label: "저축한다", hint: "형편 ↑", run: (p) => { nudgeWealth(p, 0.06); return "통장에 숫자가 조금 늘었어요. 든든해요."; } },
        { label: "가족 여행을 간다", hint: "행복 ↑ · 관계 ↑", run: (p) => { p.j += 8; p.r += 4; return "처음 가 본 곳에서 가족사진을 찍었어요."; } },
        { label: "부모님께 드린다", hint: "관계 ↑", run: (p) => { p.r += 8; p.j += 3; return "부모님이 한참을 말없이 웃으셨어요."; } },
      ],
    },
    {
      id: "w_retire", cat: "work", fmt: "dilemma", min: 55, max: 68,
      when: (p) => p.job && !p.retired,
      q: () => "언제 일을 내려놓을까요?",
      options: [
        { label: "조금 일찍 쉰다", hint: "건강 ↑ · 소득 ↓", run: (p) => { p.retired = true; p.income *= p.tier >= 2 ? 0.5 : 0.3; p.h += 6; p.j += 5; return `${p.age}세, 일을 내려놓았어요. 아침이 느긋해졌어요.`; } },
        { label: "몸이 허락할 때까지 일한다", hint: "소득 유지 · 건강 ↓", run: (p) => { p.h -= 5; nudgeWealth(p, 0.04); return "아직은 일하는 게 좋아요."; } },
      ],
    },

    /* ❤️ 사랑·가족 */
    {
      id: "l_confess", cat: "love", fmt: "risk", min: 19, max: 34,
      when: (p) => !p.married,
      q: () => "마음에 둔 사람이 있어요.",
      options: [
        { label: "마음을 전한다", hint: () => odds(0.55), run: (p) => { if (chance(0.55)) { p.married = true; p.j += 10; p.r += 8; return "그 사람도 같은 마음이었어요. 함께 살기로 했어요."; } p.j -= 6; return "거절당했어요. 그래도 말하길 잘했다고 생각해요."; } },
        { label: "나에게 집중한다", hint: "배움 ↑", run: (p) => { p.k += 5; p.j -= 1; if (p.job) p.income *= 1.08; return "지금은 나를 키우는 시간이라고 마음먹었어요."; } },
      ],
    },
    {
      id: "l_kids", cat: "love", fmt: "dilemma", min: 22, max: 40,
      when: (p) => p.married,
      q: (p) => (p.kids ? "아이를 하나 더 가질까요?" : "아이를 가질까요?"),
      options: [
        { label: p => (p.kids ? "한 명 더" : "갖고 싶다"), hint: "가족 ↑ · 형편 ↓", run: (p) => { p.wantKids = true; nudgeWealth(p, -0.03); return "집이 조금 더 시끄러워질 준비를 해요."; } },
        { label: (p) => (p.kids ? "지금 가족으로 충분하다" : "지금은 아니다"), hint: "여유 ↑", run: (p) => { p.kidCap = p.kids; p.j += 2; return "지금 우리 가족의 모습을 지키기로 했어요."; } },
      ],
    },
    {
      id: "l_invest", cat: "love", fmt: "split", min: 32, max: 56,
      when: (p) => p.kids > 0,
      q: () => "아이 교육에 돈이 많이 들어요.",
      options: [
        { label: "내 노후를 줄여서라도 투자한다", hint: "아이 배움 ↑ (다음 세대)", run: (p) => { p.kidInvest += 1; nudgeWealth(p, -0.06); p.j -= 1; return "아이 방 책상 위에 새 문제집이 쌓였어요."; } },
        { label: "형편껏, 아이 스스로", hint: "내 형편 유지", run: (p) => { p.r += 2; return "공부는 스스로 하는 거라고 말해 줬어요."; } },
      ],
    },
    {
      id: "l_parent", cat: "love", fmt: "dilemma", min: 38, max: 62,
      when: (p) => p.parents.m || p.parents.f,
      q: () => "부모님이 많이 편찮으세요.",
      options: [
        { label: "집으로 모셔 와 돌본다", hint: "관계 ↑ · 소득 ↓", run: (p) => { p.r += 9; p.j -= 3; p.income *= 0.94; return "밤마다 부모님 숨소리를 확인하며 잠들어요."; } },
        { label: "요양 시설·형제에게 부탁한다", hint: "일 유지 · 마음의 짐", run: (p) => { p.r -= 3; p.j -= 2; return "주말마다 찾아가요. 돌아오는 길이 늘 무거워요."; } },
      ],
    },
    {
      id: "l_crisis", cat: "love", fmt: "risk", min: 30, max: 58,
      when: (p) => p.married,
      q: () => "배우자와 다툼이 잦아졌어요.",
      options: [
        { label: "상담을 받으며 다시 대화한다", hint: () => odds(0.7), run: (p) => { if (chance(0.7)) { p.r += 8; p.j += 5; return "서로의 이야기를 처음으로 끝까지 들었어요."; } p.married = false; p.divorced = true; p.j -= 8; return "노력했지만 결국 헤어졌어요."; } },
        { label: "각자의 길을 간다", hint: "관계 ↓ · 자유", run: (p) => { p.married = false; p.divorced = true; p.r -= 6; p.j += 1; return "조용히 각자의 길을 가기로 했어요."; } },
      ],
    },

    /* 🏥 건강 */
    {
      id: "h_smoke", cat: "health", fmt: "pick", min: 14, max: 26,
      when: () => true,
      q: () => "친구들이 담배를 권해요.",
      options: [
        { label: "거절한다", hint: "건강 ↑", run: (p) => { p.h += 3; p.r -= 1; return "괜찮다고 했어요. 아무도 신경 쓰지 않았어요."; } },
        { label: "한 대쯤이야", hint: "관계 ↑ · 오래 건강 ↓", run: (p) => { p.smoker = true; p.r += 3; return "그 한 대가 오랜 습관이 됐어요."; } },
      ],
    },
    {
      id: "h_mind", cat: "health", fmt: "pick", min: 22, max: 55,
      when: () => true,
      q: () => "요즘 마음이 많이 지쳤어요.",
      options: [
        { label: "도움을 청한다", hint: "행복 ↑", run: (p) => { const ok = p.tier >= 2 || p.wealthPct > 0.6; p.j += ok ? 10 : 6; p.r += 3; return ok ? "상담을 받으며 조금씩 숨이 쉬어졌어요." : "가까운 사람에게 털어놓았어요. 생각보다 큰 위로가 됐어요."; } },
        { label: "혼자 견딘다", hint: "", run: (p) => { p.j -= 4; p.h -= 2; return "괜찮은 척하는 날이 길어졌어요."; } },
      ],
    },
    {
      id: "h_check", cat: "health", fmt: "pick", min: 40, max: 58,
      when: () => true,
      q: () => "요즘 부쩍 몸이 무거워요.",
      options: [
        { label: "검진받고 몸을 챙긴다", hint: "건강 ↑", run: (p) => { const access = p.tier >= 2 || p.wealthPct > 0.7; p.h += access ? 12 : 5; if (p.smoker && chance(0.5)) { p.smoker = false; return "담배도 끊었어요. 숨쉬기가 한결 편해요."; } return access ? "일찍 문제를 찾아 치료했어요. 걷기도 시작했어요." : "멀리 있는 병원까지 다녀왔어요. 약값이 부담됐지만 조금 나아졌어요."; } },
        { label: "일이 먼저다", hint: "소득 ↑ · 건강 ↓", run: (p) => { if (p.job && !p.retired) p.income *= 1.1; p.h -= 10; return "괜찮겠지 하고 넘겼어요."; } },
      ],
    },
    {
      id: "h_surgery", cat: "health", fmt: "risk", min: 62, max: 88,
      when: () => true,
      q: () => "무릎이 아파 걷기가 힘들어요. 수술을 할까요?",
      options: [
        { label: "수술을 받는다", hint: (p) => odds(p.tier >= 2 ? 0.85 : 0.6), run: (p) => { if (chance(p.tier >= 2 ? 0.85 : 0.6)) { p.h += 10; p.j += 6; return "다시 동네 한 바퀴를 걸을 수 있게 됐어요."; } p.h -= 10; return "수술 후 회복이 더뎠어요."; } },
        { label: "지팡이와 함께 산다", hint: "", run: (p) => { p.h -= 3; return "천천히 걷는 데 익숙해졌어요."; } },
      ],
    },

    /* 🧭 이주·환경 */
    {
      id: "m_city", cat: "move", fmt: "risk", min: 17, max: 25,
      when: () => true,
      q: (p) => (p.urban ? "더 큰 기회를 찾아 떠날 수 있어요." : "고향을 떠나 도시로 갈 수 있어요."),
      options: [
        { label: "고향에 남는다", hint: "관계 ↑", run: (p) => { p.r += 8; p.j += 2; return "익숙한 사람들 곁에 남기로 했어요."; } },
        { label: (p) => (p.urban ? "더 큰 도시로" : "도시로 떠난다"), hint: "소득 ↑ · 외로움", run: (p) => { p.urban = true; p.moved++; p.r -= 6; p.j += chance(0.55) ? 4 : -5; if (p.job) p.income *= 1.25; else nudgeWealth(p, 0.06); return "가방 하나 들고 낯선 도시에 도착했어요."; } },
        {
          label: "다른 나라로 떠나 본다", hint: (p) => odds(0.15 + p.k / 250 + p.wealthPct * 0.2),
          when: (p) => tierOf(p.c) < 3 && !p.abroad,
          run: (p) => emigrate(p, 0.15 + p.k / 250 + p.wealthPct * 0.2),
        },
      ],
    },
    {
      id: "m_climate", cat: "move", fmt: "dilemma", min: 22, max: 70,
      when: (p) => has(FLOOD, p.c) || has(DROUGHT, p.c) || has(HEAT, p.c) || has(TYPHOON, p.c),
      q: (p) => (has(DROUGHT, p.c) ? "가뭄이 해마다 심해져요. 떠날까요?" : has(FLOOD, p.c) ? "해마다 물난리가 나요. 떠날까요?" : "여름이 점점 견디기 힘들어져요. 떠날까요?"),
      options: [
        { label: "안전한 곳으로 이사한다", hint: "건강 ↑ · 형편 ↓", run: (p) => { p.moved++; p.h += 5; p.r -= 5; nudgeWealth(p, -0.05); return "모든 걸 정리하고 새 동네로 옮겼어요."; } },
        { label: "이웃과 함께 버틴다", hint: "관계 ↑ · 위험", run: (p) => { p.r += 7; if (chance(0.4)) { p.h -= 8; return "그해 재난은 유난히 컸어요. 그래도 이웃이 곁에 있었어요."; } return "마을 사람들과 둑을 쌓고 나무를 심었어요."; } },
      ],
    },
    {
      id: "m_abroad_job", cat: "move", fmt: "dilemma", min: 25, max: 45,
      when: (p) => p.job && !p.retired && tierOf(p.c) < 3 && !p.abroad,
      q: () => "먼 나라에서 일하면 몇 배를 벌 수 있다는 제안이 왔어요.",
      options: [
        { label: "가족을 두고 혼자 간다", hint: "소득 ↑↑ · 관계 ↓↓", run: (p) => { p.moved++; p.income *= 2.2; capIncome(p); p.r -= 12; p.j -= 4; nudgeWealth(p, 0.1); return "매달 집으로 돈을 부쳐요. 아이 목소리는 전화로만 들어요."; } },
        { label: "가족 곁에 남는다", hint: "관계 ↑", run: (p) => { p.r += 6; return "적게 벌어도 함께 저녁을 먹는 쪽을 택했어요."; } },
      ],
    },
    {
      id: "m_return", cat: "move", fmt: "pick", min: 45, max: 75,
      when: (p) => p.abroad,
      q: (p) => `${p.home.name}로 돌아갈까요?`,
      options: [
        { label: "고향으로 돌아간다", hint: "관계 ↑ · 소득 ↓", run: (p) => { p.c = p.home; p.tier = tierOf(p.home); p.abroad = null; p.income *= 0.5; p.r += 10; p.j += 4; return "공항에 내리자 익숙한 냄새가 났어요."; } },
        { label: "여기가 이제 내 집이다", hint: "", run: (p) => { p.j += 2; return "이제는 이 나라 말로 꿈을 꿔요."; } },
      ],
    },

    /* 🤝 관계 */
    {
      id: "p_bully", cat: "people", fmt: "dilemma", min: 9, max: 15,
      when: (p) => p.inSchool,
      q: () => "친구가 괴롭힘당하는 걸 봤어요.",
      options: [
        { label: "그 친구 편에 선다", hint: "관계 ↑ · 위험", run: (p) => { p.r += 7; if (chance(0.4)) { p.j -= 5; return "나도 한동안 놀림을 받았어요. 그래도 그 친구와 평생 친구가 됐어요."; } p.j += 3; return "다른 친구들도 하나둘 함께 섰어요."; } },
        { label: "모른 척한다", hint: "", run: (p) => { p.j -= 3; return "그날 일이 오래 마음에 걸렸어요."; } },
      ],
    },
    {
      id: "p_lend", cat: "people", fmt: "risk", min: 24, max: 58,
      when: () => true,
      q: () => "오랜 친구가 돈을 빌려 달라고 해요.",
      options: [
        { label: "빌려준다", hint: () => odds(0.55), run: (p) => { if (chance(0.55)) { p.r += 8; return "친구는 약속대로 갚았고, 우정은 더 깊어졌어요."; } nudgeWealth(p, -0.04); p.r -= 4; p.j -= 4; return "돈도, 친구도 잃었어요."; } },
        { label: "정중히 거절한다", hint: "관계 ↓", run: (p) => { p.r -= 4; return "한동안 연락이 뜸해졌어요."; } },
      ],
    },
    {
      id: "p_lead", cat: "people", fmt: "pick", min: 30, max: 65,
      when: () => true,
      q: (p) => (p.urban ? "아파트(동네) 모임 대표를 맡아 달래요." : "마을 일을 맡아 달라는 부탁을 받았어요."),
      options: [
        { label: "맡는다", hint: "관계 ↑ · 피곤", run: (p) => { p.r += 10; p.h -= 2; return "사람들 이름을 다 외우게 됐어요."; } },
        { label: "사양한다", hint: "", run: (p) => { p.j += 1; return "내 일에 집중하기로 했어요."; } },
      ],
    },
    {
      id: "p_reach", cat: "people", fmt: "pick", min: 50, max: 70,
      when: () => true,
      q: () => "오래 연락이 끊긴 친구가 떠올라요.",
      options: [
        { label: "먼저 연락한다", hint: "관계 ↑", run: (p) => { p.r += 10; p.j += 5; return "목소리를 듣자마자 둘 다 웃음이 터졌어요."; } },
        { label: "마음에 묻어 둔다", hint: "", run: (p) => { p.j -= 1; return "가끔 그 친구 생각이 나요."; } },
      ],
    },
    {
      id: "p_alone", cat: "people", fmt: "pick", min: 68, max: 95,
      when: () => true,
      q: () => "혼자 있는 시간이 길어졌어요.",
      options: [
        { label: "동네 모임에 나간다", hint: "관계 ↑", run: (p) => { p.r += 8; p.j += 4; return "매주 화요일이 기다려져요."; } },
        { label: "혼자가 편하다", hint: "", run: (p) => { p.j += 1; p.r -= 3; return "조용한 오후에 라디오를 들어요."; } },
      ],
    },

    /* ⚖️ 가치 */
    {
      id: "v_order", cat: "value", fmt: "dilemma", min: 24, max: 55,
      when: (p) => p.job && !p.retired,
      q: () => "윗사람이 옳지 않은 일을 시켜요.",
      options: [
        { label: "따른다", hint: "일 유지 · 마음 ↓", run: (p) => { p.j -= 6; return "월급은 지켰지만 잠이 잘 오지 않아요."; } },
        { label: "거절한다", hint: () => `해고 위험 약 40%`, run: (p) => { if (chance(0.4)) { p.income *= 0.75; p.j -= 4; p.r += 4; return "결국 일자리를 잃었어요. 그래도 후회는 없어요."; } p.j += 6; p.r += 4; return "동료들이 조용히 엄지를 들어 줬어요."; } },
      ],
    },
    {
      id: "v_meaning", cat: "value", fmt: "pick", min: 18, max: 60,
      when: () => true,
      q: () => "삶의 의미를 찾고 싶어졌어요.",
      options: [
        { label: "봉사 활동을 시작한다", hint: "관계 ↑ · 행복 ↑", run: (p) => { p.r += 6; p.j += 5; return "주말마다 누군가의 하루를 돕고 있어요."; } },
        { label: "신앙·명상에 기댄다", hint: "행복 ↑", run: (p) => { p.j += 7; return "매일 아침 고요한 시간이 생겼어요."; } },
        { label: "일에서 답을 찾는다", hint: "소득 ↑", run: (p) => { if (p.job && !p.retired) { p.income *= 1.08; capIncome(p); } p.k += 3; return "더 잘하고 싶은 일이 생겼어요."; } },
      ],
    },
    {
      id: "v_legacy", cat: "value", fmt: "split", min: 60, max: 90,
      when: (p) => p.kids > 0 || p.wealthPct > 0.3,
      q: () => "남은 재산을 어떻게 남길까요?",
      options: [
        { label: "아이들에게 물려준다", hint: "다음 세대 형편 ↑", run: (p) => { p.legacy = "kids"; p.r += 3; return "작은 집 한 채와 통장을 아이들 이름으로 정리했어요."; } },
        { label: "이웃과 사회에 나눈다", hint: "관계 ↑ · 행복 ↑", run: (p) => { p.legacy = "society"; p.r += 6; p.j += 6; return "동네 도서관에 내 이름이 적힌 책장이 생겼어요."; } },
        { label: "남은 시간 나를 위해 쓴다", hint: "행복 ↑", run: (p) => { p.legacy = "self"; p.j += 8; return "평생 미뤄 둔 여행을 떠났어요."; } },
      ],
    },
  ];

  function emigrate(p, okP) {
    p.moved++;
    if (chance(okP)) {
      const dest = pick(COUNTRIES.filter((x) => tierOf(x) === 3));
      const ratio = dest.gdp / p.c.gdp;
      p.abroad = dest; p.c = dest; p.tier = 3;
      p.income = (p.income || incomeAt(p.home, 0.5)) * Math.min(ratio, 6) * 0.45;
      p.r -= 10; p.j += 3;
      return `${dest.flag} ${dest.name}에 정착했어요. 말도 음식도 낯설지만 버텨 보기로 해요.`;
    }
    p.j -= 8; nudgeWealth(p, -0.08);
    return "브로커에게 돈만 잃고 돌아왔어요. 다시 처음부터예요.";
  }

  const resolve = (v, p) => (typeof v === "function" ? v(p) : v);

  function pendingDecision(p) {
    if (p.pending && p.pending.age === p.age) return p.pending;
    if (!p.slots.includes(p.age)) return null;
    const eligible = DECISIONS.filter((d) => p.age >= d.min && p.age <= d.max && !p.decided[d.id] && d.when(p));
    if (!eligible.length) return null;
    // 가장 적게 나온 분야부터
    const least = Math.min(...eligible.map((d) => p.catCount[d.cat] || 0));
    const d = pick(eligible.filter((x) => (p.catCount[x.cat] || 0) === least));
    p.pending = {
      age: p.age, id: d.id, cat: d.cat, fmt: d.fmt,
      catIcon: CATS[d.cat].icon, catName: CATS[d.cat].name, fmtName: FORMATS[d.fmt],
      q: d.q(p),
      options: d.options.filter((o) => !o.when || o.when(p)).map((o) => ({ ...o, label: resolve(o.label, p), hint: resolve(o.hint, p) || "" })),
    };
    return p.pending;
  }

  const score = (p) => (p.h + p.j + p.k + p.r) / 4 + 10 * p.wealthPct + (p.income ? 12 * Math.log(p.income) : 0);

  function decide(p, d, idx) {
    p.decided[d.id] = true;
    p.pending = null;
    p.catCount[d.cat] = (p.catCount[d.cat] || 0) + 1;
    const before = score(p);
    const text = d.options[idx].run(p);
    normalize(p);
    const delta = score(p) - before;
    const t = delta > 1.5 ? "good" : delta < -1.5 ? "bad" : "neutral";
    p.choices.push({ age: p.age, cat: d.cat, label: d.options[idx].label, tone: t });
    p.log.push({ age: p.age, tone: "choice", text: `「${d.options[idx].label}」 — ${text}` });
    return text;
  }

  function autoPick(d) {
    return Math.floor(rand() * d.options.length);
  }

  /* ---------- 사망 ---------- */

  function causeOfDeath(p) {
    const a = p.age, t = p.tier;
    if (a === 0) return t <= 1 ? pick(["폐렴", "조산 합병증", "설사병", "출생 시 합병증"]) : pick(["선천성 질환", "조산 합병증"]);
    if (a < 15) return t <= 1 ? pick([has(MALARIA, p.c) ? "말라리아" : "뎅기열", "폐렴", "영양실조", "홍역", "물놀이 사고"]) : pick(["교통사고", "소아암", "익사 사고"]);
    if (a < 40) {
      if (p.c.conflict && chance(0.35)) return "분쟁 중 폭력";
      if (p.sex === "F" && p.married && t <= 1 && chance(0.3)) return "출산 합병증";
      return pick(t <= 1 ? ["결핵", "교통사고", "에이즈 관련 질환", "감염병"] : ["교통사고", "자살", "사고", "희귀 질환"]);
    }
    if (a < 70) return pick(["심장병", "뇌졸중", p.smoker ? "폐암" : "암", t <= 1 ? "결핵" : "간 질환", "당뇨 합병증"]);
    return pick(["노환", "심장병", "뇌졸중", "폐렴", "치매 합병증", p.smoker ? "폐암" : "암"]);
  }

  const expectedHealth = (age) => 75 - Math.max(0, age - 35) * 0.75;
  // 사건을 겪은 평균적인 사람의 건강은 기대치보다 약 11 낮음 → 그 수준을 위험 1배로 둠
  const AVG_HEALTH_GAP = 11;

  function mortality(p) {
    const healthMult = Math.exp(((expectedHealth(p.age) - AVG_HEALTH_GAP - p.h) / 50) * 0.6);
    let q = qx(p.c, p.age, p.mult) * (p.age < 5 ? 1 : healthMult);
    // 국가 사망률에 이미 평균 흡연(약 20%)이 들어 있으므로 흡연자 1.4배, 비흡연자 0.92배
    if (p.age > 35) q *= p.smoker ? 1.4 : 0.92;
    if (p.c.conflict && p.age >= 15 && p.age <= 60) q += 0.0006;
    return clamp(q, 0, 1);
  }

  function normalize(p) {
    for (const k of ["h", "j", "k", "r"]) p[k] = clamp(p[k], 0, 100);
  }

  function step(p) {
    const ev = yearEvents(p);
    const c = p.c;

    // 건강은 나이에 맞는 기대치로 천천히 돌아옵니다 (노화 자체는 사망 곡선에 반영)
    p.h += (expectedHealth(p.age) - p.h) * 0.1;
    if (p.wealthPct < 0.25 && p.tier <= 1) p.h -= 0.3;
    p.j += (c.sat * 10 - p.j) * 0.06 + (p.r - 50) * 0.02;
    p.r += (55 - p.r) * 0.03 + (p.married ? 0.4 : -0.2);
    if (p.age > 75) p.k -= 0.5;
    normalize(p);

    if (p.job) { p.lifetimeIncome += p.income; p.peakIncome = Math.max(p.peakIncome, p.income); }

    ev.forEach((e) => p.log.push({ age: p.age, ...e }));
    p.hist.push({ age: p.age, h: p.h, j: p.j, k: p.k, r: p.r });

    if (chance(mortality(p)) || p.age >= 115) {
      p.alive = false;
      p.cause = causeOfDeath(p);
      p.log.push({ age: p.age, tone: "end", text: deathText(p) });
    }
    return ev;
  }

  function deathText(p) {
    const a = p.age;
    if (a === 0) return `첫돌을 맞지 못하고 ${p.cause}(으)로 세상을 떠났어요.`;
    if (a < 15) return `${a}살, ${p.cause}(으)로 세상을 떠났어요. 너무 짧은 생이었어요.`;
    if (a < 60) return `${a}세, ${p.cause}(으)로 갑작스럽게 세상을 떠났어요.`;
    return `${a}세, ${p.cause}(으)로 ${p.kids ? "가족 곁에서" : "조용히"} 눈을 감았어요.`;
  }

  function advance(p) { p.age++; }

  /* ---------- 대물림 ---------- */

  // 그 나라 안에서 이 사람의 최종 경제적 위치
  function finalPct(p) {
    if (p.peakIncome) return clamp(0.5 * pctOfIncome(p.c, p.peakIncome * 0.85) + 0.5 * p.wealthPct, 0.01, 0.99);
    return p.wealthPct;
  }

  function inherit(p) {
    const viaSibling = p.kidAges.length === 0;
    const parentAgeAtBirth = viaSibling ? Math.round(between(24, 36)) : p.kidAges[0];
    const rho = rhoOf(p.c) * (viaSibling ? 0.6 : 1);
    let z = rho * invPhi(finalPct(p)) + Math.sqrt(1 - rho * rho) * normal();
    if (p.legacy === "kids") z += 0.3;
    if (!viaSibling && p.age - parentAgeAtBirth < 15) z -= 0.25; // 어린 나이에 부모를 잃음
    const eduBoost = clamp((p.schoolYears - p.c.school) / 6, -1, 1.2) * (viaSibling ? 0.3 : 0.6) + p.kidInvest * 0.45;
    return {
      country: p.c, urban: p.urban, gen: p.gen + 1,
      wealthPct: clamp(phi(z), 0.01, 0.99),
      birthYear: p.birthYear + parentAgeAtBirth,
      parentAgeAtBirth, parentDeathAt: p.age - parentAgeAtBirth, parentSex: p.sex,
      viaSibling, eduBoost,
      migrant2: !!p.abroad, parentAbroadHome: p.abroad ? p.home : null,
      gifts: giftsOf(p, viaSibling, parentAgeAtBirth),
    };
  }

  // 다음 세대에게 남긴 것 (화면 표시용)
  function giftsOf(p, viaSibling, at) {
    const g = [];
    g.push([p.abroad ? "🧭" : "📍", p.abroad ? `새 나라 ${p.abroad.flag} ${p.abroad.name}에서 시작해요` : `${p.c.flag} ${p.c.name}의 ${p.urban ? "도시" : "시골"}에서 시작해요`]);
    if (viaSibling) g.push(["🎓", "배움은 새 부모의 형편에 따라 시작해요"]);
    else g.push(["🎓", p.schoolYears >= 12 ? `부모의 배움(${p.schoolYears}년)이 길을 터 줘요` : p.schoolYears ? `부모는 ${p.schoolYears}년 배웠어요` : "부모는 학교를 다니지 못했어요"]);
    if (p.kidInvest) g.push(["📚", "부모가 노후를 줄여 교육에 투자했어요"]);
    if (p.legacy === "kids") g.push(["🏠", "물려받은 재산이 있어요"]);
    if (p.legacy === "society") g.push(["🌱", "부모는 재산을 사회에 나눴어요"]);
    if (!viaSibling && p.age - at < 15) g.push(["🕯️", `${p.age - at}살에 부모를 잃게 돼요`]);
    if (viaSibling) g.push(["🌳", "직계 자녀가 없어 형제자매의 아이가 이어요"]);
    return g;
  }

  /* ---------- 요약 ---------- */

  function summary(p) {
    const S = p.home._S;
    const outlived = Math.round((1 - S[Math.min(p.age + 1, S.length - 1)]) * 100);
    const span = p.hist.length > 5 ? p.hist.slice(5) : p.hist; // 기억에 남는 해는 다섯 살부터
    const best = span.reduce((b, x) => (x.j > b.j ? x : b), span[0] || { age: 0, j: 0 });
    const worst = span.reduce((b, x) => (x.j < b.j ? x : b), span[0] || { age: 0, j: 0 });
    const avgJ = p.hist.reduce((s, x) => s + x.j, 0) / Math.max(1, p.hist.length);
    const income = p.peakIncome || 0;
    return {
      country: p.home, now: p.c, age: p.age, sex: p.sex, cause: p.cause, gen: p.gen, birthYear: p.birthYear,
      schoolYears: p.schoolYears, uni: p.uni, job: p.job, kids: p.kids, grandkids: p.grandkids,
      married: p.married || p.divorced, moved: p.moved, abroad: p.abroad,
      peakIncome: income, lifetimeIncome: p.lifetimeIncome,
      worldPct: income ? worldPercentile(income) : null,
      localStart: p.startPct, localEnd: finalPct(p),
      outlived, best, worst, avgJ: Math.round(avgJ), family: familyWord(p),
      choices: p.choices.slice(),
    };
  }

  // 동갑내기 100명 중 살아있는 수 (국가 생명표 기준)
  const aliveOf100 = (c, age) => Math.round(c._S[Math.min(age, c._S.length - 1)] * 100);

  return {
    seed, born, step, rhoOf, advance, pendingDecision, decide, autoPick, summary, aliveOf100, inherit,
    worldPercentile, familyWord, tierOf, CATS, FORMATS, DECISIONS,
  };
})();
