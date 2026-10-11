/*
 * ONCE 시뮬레이션 엔진
 * - 사망: 영아사망률 + 곰페르츠(Gompertz) 사망 곡선을 국가 기대수명에 맞춰 보정
 * - 소득: 국가 1인당 GDP(PPP)와 지니계수로 만든 로그정규 분포
 * - 교육·결혼·출산: 국가 평균 교육연수, 대학 취학률, 합계출산율을 가족 형편으로 조정
 * 모든 결과는 확률일 뿐, 정해진 운명은 없습니다.
 */
const Sim = (() => {
  const GOMPERTZ_B = 0.085;
  const SEX_MULT = { F: 0.78, M: 1.28 }; // 여성 기대수명이 평균 4–6년 길도록

  const rand = Math.random;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const chance = (p) => rand() < p;
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const between = (a, b) => a + rand() * (b - a);

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

  function born(opts = {}) {
    const c = opts.country || pickCountry(opts.mode);
    const sex = chance(0.512) ? "M" : "F";
    const wealthPct = rand();
    const tier = tierOf(c);
    const urbanP = clamp(0.25 + 0.14 * Math.log(c.gdp / 1500), 0.15, 0.92);
    const urban = chance(urbanP);
    const siblings = Math.min(9, poissonish(Math.max(0, c.tfr - 1) * between(0.7, 1.3)));

    // 목표 교육연수: 국가 평균을 가족 형편으로 조정
    const eduZ = 0.6 * invPhi(wealthPct) + 0.8 * normal();
    let schoolTarget = clamp(Math.round(c.school + eduZ * 3.2), 0, 18);
    const uniP = clamp(c.tertiary * (0.35 + 1.3 * wealthPct), 0, 0.97);
    if (schoolTarget >= 12 && chance(uniP)) schoolTarget = Math.max(schoolTarget, 16);
    else schoolTarget = Math.min(schoolTarget, 12);

    const base = c.sat * 10;
    const p = {
      c, home: c, sex, tier, wealthPct, urban, siblings,
      birthYear: new Date().getFullYear(),
      age: 0, alive: true,
      h: clamp(72 + 10 * normal() - (tier === 0 ? 8 : 0), 25, 100),
      j: clamp(base + 8 * normal() + (wealthPct - 0.5) * 12, 10, 95),
      k: 5, r: clamp(55 + 10 * normal(), 20, 95),
      schoolTarget, schoolYears: 0, inSchool: false, uni: false,
      job: null, income: 0, retired: false, venture: null,
      married: false, partnerAge: 0, divorced: false, kids: 0, grandkids: 0,
      parents: { m: true, f: true, mAge: Math.round(between(18, 34)), fAge: Math.round(between(20, 40)) },
      moved: 0, abroad: null, ill: 0,
      hist: [], log: [], decided: {}, seen: {}, peakIncome: 0, lifetimeIncome: 0,
      cause: "",
    };
    p.mult = SEX_MULT[sex];
    p.log.push({ age: 0, tone: "big", text: birthText(p) });
    return p;
  }

  function familyWord(p) {
    if (p.wealthPct < 0.2) return "가장 가난한 편에 속하는";
    if (p.wealthPct < 0.45) return "넉넉하지 않은";
    if (p.wealthPct < 0.8) return "평범한";
    if (p.wealthPct < 0.95) return "형편이 좋은";
    return "아주 부유한";
  }

  function birthText(p) {
    const place = p.urban ? "도시" : "시골 마을";
    const sib = p.siblings === 0 ? "외동으로" : `형제자매 ${p.siblings}명과 함께`;
    return `${p.c.name}의 한 ${place}, ${familyWord(p)} 집에서 ${p.sex === "F" ? "여자" : "남자"}아이로 태어났어요. ${sib} 자라게 됩니다.`;
  }

  /* ---------- 직업 ---------- */

  function assignJob(p) {
    const c = p.c, y = p.schoolYears;
    const farmP = [0.6, 0.35, 0.15, 0.03][p.tier] * (p.urban ? 0.3 : 1.4);
    let job;
    if (y >= 16) job = pick(["교사", "엔지니어", "회계사", "간호사", "공무원", "연구원", "개발자", "의사", "기자", "디자이너"]);
    else if (y >= 12) job = pick(["사무원", "판매원", "기술자", "운전기사", "요리사", "경찰관", "미용사", "공장 관리자"]);
    else if (chance(farmP)) job = pick(["농부", "목축업자", "어부", "농장 일꾼"]);
    else job = pick(["공장 노동자", "건설 노동자", "노점 상인", "가사 도우미", "배달원", "청소 노동자"]);

    const zFam = invPhi(clamp(p.wealthPct, 0.01, 0.99));
    const zEdu = (y - c.school) / 4;
    const z = clamp(0.5 * zFam + 0.5 * zEdu + 0.45 * normal(), -2.6, 2.6);
    p.job = job;
    p.income = incomeAt(c, phi(z)) * (p.abroad ? 0.6 : 1); // 이주민은 같은 학력에서도 소득이 낮은 경향
    return job;
  }

  /* ---------- 연간 진행 ---------- */

  const tone = (text, t = "neutral") => ({ text, tone: t });

  function yearEvents(p) {
    const c = p.c, a = p.age, ev = [];
    const poor = p.wealthPct < 0.3, rich = p.wealthPct > 0.8;

    // 유년기 이정표
    if (a === 1) ev.push(tone(pick(["첫걸음을 뗐어요.", "처음으로 엄마, 아빠를 불렀어요.", "뒤뚱뒤뚱 걷기 시작했어요."])));
    if (a === 3 && chance(0.5)) ev.push(tone(pick(["좋아하는 노래가 생겼어요.", "동네 아이들과 처음으로 친구가 됐어요.", "할머니 옆에서 잠드는 걸 좋아해요."])));

    // 학교
    if (a === 6 || a === 7) {
      if (!p.inSchool && p.schoolYears === 0) {
        if (p.schoolTarget >= 1) { p.inSchool = true; ev.push(tone("학교에 들어갔어요. 가방이 몸보다 커 보여요.", "good")); }
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
      const q = qx(c, pa, who === "m" ? SEX_MULT.F : SEX_MULT.M);
      if (chance(q)) {
        p.parents[who] = false;
        const name = who === "m" ? "어머니" : "아버지";
        ev.push(tone(a < 15 ? `${name}가 세상을 떠났어요. 아직 너무 어린 나이였어요.` : `${name}가 ${pa}세로 세상을 떠났어요.`, "bad"));
        p.j -= a < 15 ? 15 : 8; p.r -= 3;
        if (a < 15) p.wealthPct = clamp(p.wealthPct - 0.12, 0.01, 0.99);
      }
    }

    // 결혼 · 이별
    if (!p.married && a >= 15 && a <= 45) {
      let mp = a < 18 ? 0 : a < 25 ? 0.07 : a < 35 ? 0.11 : 0.04;
      if (a >= 15 && a < 18 && p.sex === "F") mp = [0.05, 0.03, 0.004, 0][p.tier];
      if (p.tier <= 1 && a >= 18) mp *= 1.5;
      mp *= 0.6 + p.r / 125;
      if (chance(mp)) {
        p.married = true; p.partnerAge = a + Math.round(between(-3, 6));
        if (a < 18) { ev.push(tone(`${a}살, 집안이 정한 사람과 결혼했어요.`, "bad")); p.inSchool = false; p.j -= 6; }
        else { ev.push(tone(pick(["사랑하는 사람과 결혼했어요.", "오랜 친구였던 사람과 가정을 꾸렸어요.", "작은 결혼식을 올렸어요. 모두가 웃었어요."]), "big")); p.j += 10; p.r += 10; }
      }
    } else if (p.married && a < 60 && chance([0.004, 0.006, 0.01, 0.013][p.tier])) {
      p.married = false; p.divorced = true;
      ev.push(tone("긴 대화 끝에 배우자와 헤어지기로 했어요.", "bad")); p.j -= 10; p.r -= 6;
    }

    // 자녀
    if (p.married && a >= 16 && a <= 44) {
      const kp = clamp((c.tfr * 1.05) / 17, 0.02, 0.45) * (p.kids >= Math.ceil(c.tfr + 1) ? 0.3 : 1);
      if (chance(kp)) {
        p.kids++;
        ev.push(tone(p.kids === 1 ? "첫아이가 태어났어요. 세상이 달라 보여요." : `${p.kids}번째 아이가 태어났어요.`, "big"));
        p.j += 6; p.r += 6;
        if (p.sex === "F" && chance(c.imr / 1000 * 0.12)) { p.h -= 25; ev.push(tone("출산 후 몸이 크게 상했어요. 회복이 더뎌요.", "bad")); }
        if (chance(c.imr / 1000)) { ev.push(tone("아이가 첫돌을 맞지 못했어요. 그해는 아무 말도 하지 못했어요.", "bad")); p.j -= 20; p.kids--; }
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

    // 무작위 사건
    const pool = EVENTS.filter((e) => a >= e.min && a <= e.max && (!e.when || e.when(p, c)));
    const weight = (e) => (e.w ? e.w(p, c) : 1) / (1 + 2 * (p.seen[EVENTS.indexOf(e)] || 0));
    const n = chance(0.55) ? 1 : chance(0.2) ? 2 : 0;
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

  // 사건 사전 (나이, 조건, 가중치, 효과)
  const EVENTS = [
    { min: 2, max: 12, tone: "bad", text: ["열이 펄펄 끓는 병을 앓았어요.", "심한 설사병으로 며칠을 앓았어요."], w: (p) => [3, 1.5, 0.6, 0.3][p.tier], fx: (p) => (p.h -= 8) },
    { min: 2, max: 30, tone: "bad", text: ["말라리아에 걸려 한동안 누워 지냈어요."], when: (p) => p.c.region === "AF" || p.c.code === "MZ", w: () => 1.5, fx: (p) => (p.h -= 10) },
    { min: 3, max: 12, tone: "good", text: ["동네에서 제일 빠른 아이로 소문났어요.", "그림을 잘 그린다는 칭찬을 받았어요.", "책 한 권을 너덜너덜해질 때까지 읽었어요."], fx: (p) => { p.j += 4; p.k += 3; } },
    { min: 4, max: 14, tone: "bad", text: ["먹을 것이 부족한 해였어요. 배고픈 밤이 많았어요."], when: (p) => p.tier <= 1 && p.wealthPct < 0.35, w: () => 2, fx: (p) => { p.h -= 7; p.j -= 5; } },
    { min: 6, max: 17, tone: "good", text: ["평생 기억할 선생님을 만났어요.", "가장 친한 친구가 생겼어요."], when: (p) => p.inSchool, fx: (p) => { p.k += 4; p.r += 5; p.j += 3; } },
    { min: 8, max: 16, tone: "bad", text: ["학교에서 따돌림을 당했어요.", "시험 성적 때문에 크게 혼났어요."], when: (p) => p.inSchool, w: (p) => (p.tier >= 2 ? 1.2 : 0.6), fx: (p) => { p.j -= 6; p.r -= 3; } },
    { min: 8, max: 15, tone: "bad", text: ["학교 대신 시장에서 물건을 날라요.", "밭일을 돕느라 학교에 자주 빠졌어요."], when: (p) => p.tier === 0 && p.wealthPct < 0.4, w: () => 1.5, fx: (p) => { p.k -= 2; p.j -= 3; } },
    { min: 13, max: 19, tone: "good", text: ["첫사랑에 빠졌어요.", "처음으로 혼자 먼 곳까지 여행했어요.", "밤새 친구들과 미래를 이야기했어요."], fx: (p) => { p.j += 5; p.r += 3; } },
    { min: 14, max: 25, tone: "neutral", text: ["좋아하는 음악이 생겼어요. 매일 들어요.", "운동을 시작했어요."], fx: (p) => { p.j += 2; p.h += 3; } },
    { min: 18, max: 45, tone: "bad", text: (p) => `${p.job || "일"} 자리를 잃었어요. 한동안 막막했어요.`, when: (p) => p.job && !p.retired, w: (p) => [0.6, 0.9, 1, 0.8][p.tier], fx: (p) => { p.income *= 0.85; p.j -= 8; } },
    { min: 20, max: 58, tone: "good", text: ["일터에서 인정받아 책임이 커졌어요.", "월급이 올랐어요. 작은 사치를 부렸어요."], when: (p) => p.job && !p.retired, w: (p) => 0.6 + p.k / 80, fx: (p) => { p.income = Math.min(p.income * 1.12, p.c.gdp * 6); p.j += 4; } },
    { min: 18, max: 60, tone: "bad", text: ["교통사고를 당했지만 목숨은 건졌어요."], w: (p) => [1, 1.2, 0.8, 0.4][p.tier], fx: (p) => { p.h -= 15; p.j -= 4; } },
    { min: 5, max: 80, tone: "bad", text: ["큰 홍수가 마을을 덮쳤어요. 집 일부가 무너졌어요.", "가뭄이 길게 이어져 수확이 거의 없었어요."], when: (p) => p.tier <= 1, w: () => 0.8, fx: (p) => { p.income *= 0.85; p.j -= 6; p.wealthPct = clamp(p.wealthPct - 0.05, 0.01, 0.99); } },
    { min: 5, max: 80, tone: "bad", text: ["동네에서 총성이 들려 가족과 피란길에 올랐어요.", "분쟁이 격해져 한동안 집을 떠나 살았어요."], when: (p) => p.c.conflict, w: () => 1.6, fx: (p) => { p.h -= 8; p.j -= 12; p.income *= 0.7; } },
    { min: 20, max: 70, tone: "good", text: ["가족과 처음으로 바다를 보러 갔어요.", "오래 꿈꾸던 여행을 다녀왔어요."], when: (p) => p.income > 8000 || p.wealthPct > 0.6, fx: (p) => { p.j += 6; p.r += 2; } },
    { min: 25, max: 65, tone: "good", text: ["작은 집을 마련했어요. 내 이름으로 된 첫 집이에요."], when: (p) => p.job && !p.decided.home && (p.income > p.c.gdp * 0.9 || p.wealthPct > 0.7), fx: (p) => { p.decided.home = true; p.j += 8; } },
    { min: 25, max: 70, tone: "bad", text: ["오래된 친구와 크게 다퉜어요."], fx: (p) => { p.r -= 6; p.j -= 3; } },
    { min: 30, max: 75, tone: "neutral", text: ["새로운 취미가 생겼어요. 주말이 기다려져요.", "동네 사람들과 모임을 시작했어요."], fx: (p) => { p.j += 3; p.r += 4; } },
    { min: 35, max: 80, tone: "bad", text: ["당뇨 진단을 받았어요.", "혈압이 높다는 말을 들었어요."], w: (p) => (p.age > 50 ? 1.5 : 0.7), fx: (p) => { p.h -= 8; p.ill++; } },
    { min: 40, max: 85, tone: "bad", text: (p) => (p.tier >= 2 || p.wealthPct > 0.75 ? "암 진단을 받았어요. 길고 힘든 치료를 시작했어요." : "몸에 혹이 생겼지만 병원비가 없어 치료를 미뤘어요."), w: (p) => p.age / 60, fx: (p) => { p.h -= p.tier >= 2 || p.wealthPct > 0.75 ? 14 : 22; p.j -= 10; p.ill++; } },
    { min: 20, max: 80, tone: "good", text: ["아팠던 몸이 많이 회복됐어요."], when: (p) => p.h < 55, w: () => 1.2, fx: (p) => { p.h += 12; p.j += 4; } },
    { min: 30, max: 80, tone: "bad", text: ["마음이 무겁게 가라앉는 시간이 길었어요. 우울증이었어요."], w: (p) => (p.j < 45 ? 1.5 : 0.4), fx: (p) => { p.j -= 8; p.h -= 3; } },
    { min: 30, max: 90, tone: "good", text: ["아이가 학교에서 상을 받아 왔어요.", "아이와 밤새 이야기를 나눴어요."], when: (p) => p.kids > 0 && p.age < 60, fx: (p) => { p.j += 5; p.r += 3; } },
    { min: 60, max: 100, tone: "neutral", text: ["오래된 사진첩을 꺼내 한참을 들여다봤어요.", "매일 아침 같은 길을 산책해요."], fx: (p) => { p.j += 2; } },
    { min: 60, max: 100, tone: "bad", text: ["가까운 친구가 먼저 세상을 떠났어요.", "형제가 세상을 떠났어요."], w: (p) => p.age / 50, fx: (p) => { p.j -= 7; p.r -= 5; } },
    { min: 65, max: 100, tone: "bad", text: ["넘어져 엉덩이뼈를 다쳤어요."], w: (p) => p.age / 70, fx: (p) => { p.h -= 12; } },
    { min: 60, max: 100, tone: "good", text: (p) => (p.grandkids ? "손주가 찾아와 하루 종일 집이 시끌벅적했어요." : "이웃이 매일 안부를 물어 줘요."), fx: (p) => { p.j += 5; p.r += 3; } },
    { min: 65, max: 100, tone: "bad", text: ["기억이 자꾸 흐려져요. 가족 이름이 늦게 떠올라요."], w: (p) => (p.age > 78 ? 1.5 : 0.4), fx: (p) => { p.k -= 8; p.j -= 4; } },
  ];

  /* ---------- 선택의 순간 ---------- */

  const DECISIONS = [
    {
      id: "study", age: 15,
      when: (p) => p.inSchool && p.schoolTarget < 13,
      q: (p) => (p.wealthPct < 0.5 ? "집안 형편이 빠듯해요. 공부를 계속할까요?" : "공부가 점점 어려워져요. 계속할까요?"),
      options: [
        { label: "끝까지 공부한다", hint: "배움 ↑ · 당장은 힘듦", run: (p) => { p.schoolTarget = Math.max(p.schoolTarget, chance(p.c.tertiary * 0.8) ? 16 : 12); p.k += 5; p.j -= 3; return "어려워도 책을 놓지 않기로 했어요."; } },
        { label: "일을 시작해 가족을 돕는다", hint: "관계 ↑ · 배움 멈춤", run: (p) => { p.schoolTarget = p.schoolYears; p.inSchool = false; p.r += 6; p.wealthPct = clamp(p.wealthPct + 0.04, 0.01, 0.99); return "책가방 대신 일을 택했어요. 가족이 조금은 덜 배고파졌어요."; } },
      ],
    },
    {
      id: "move", age: 20,
      when: () => true,
      q: (p) => (p.urban ? "더 큰 기회를 찾아 떠날 수 있어요." : "고향을 떠나 도시로 갈 수 있어요."),
      options: [
        { label: "고향에 남는다", hint: "관계 ↑", run: (p) => { p.r += 8; p.j += 2; return "익숙한 사람들 곁에 남기로 했어요."; } },
        { label: (p) => (p.urban ? "더 큰 도시로" : "도시로 떠난다"), hint: "소득 ↑ · 외로움", run: (p) => { p.urban = true; p.moved++; p.r -= 6; p.j += chance(0.55) ? 4 : -5; if (p.job) p.income *= 1.25; else p.wealthPct = clamp(p.wealthPct + 0.06, 0.01, 0.99); return "가방 하나 들고 낯선 도시에 도착했어요."; } },
        {
          label: "다른 나라로 떠나 본다", hint: "큰 도박",
          when: (p) => tierOf(p.c) < 3,
          run: (p) => {
            const odds = 0.15 + p.k / 250 + p.wealthPct * 0.2;
            p.moved++;
            if (chance(odds)) {
              const dest = pick(COUNTRIES.filter((x) => tierOf(x) === 3));
              const ratio = dest.gdp / p.c.gdp;
              p.abroad = dest; p.c = dest; p.tier = 3;
              p.income = (p.income || incomeAt(p.home, 0.5)) * Math.min(ratio, 6) * 0.45;
              p.r -= 10; p.j += 3;
              return `${dest.flag} ${dest.name}에 정착했어요. 말도 음식도 낯설지만 버텨 보기로 해요.`;
            }
            p.j -= 8; p.wealthPct = clamp(p.wealthPct - 0.08, 0.01, 0.99);
            return "브로커에게 돈만 잃고 돌아왔어요. 다시 처음부터예요.";
          },
        },
      ],
    },
    {
      id: "love", age: 27,
      when: (p) => !p.married,
      q: () => "마음에 둔 사람이 있어요.",
      options: [
        { label: "마음을 전한다", hint: "행복 ↑ 또는 상처", run: (p) => { if (chance(0.55)) { p.married = true; p.partnerAge = p.age + 1; p.j += 10; p.r += 8; return "그 사람도 같은 마음이었어요. 함께 살기로 했어요."; } p.j -= 6; return "거절당했어요. 그래도 말하길 잘했다고 생각해요."; } },
        { label: "나에게 집중한다", hint: "배움 ↑", run: (p) => { p.k += 5; p.j -= 1; if (p.job) p.income *= 1.08; return "지금은 나를 키우는 시간이라고 마음먹었어요."; } },
      ],
    },
    {
      id: "venture", age: 36,
      when: (p) => p.job && !p.retired,
      q: () => "모아둔 돈으로 작은 가게를 열 기회가 생겼어요.",
      options: [
        {
          label: "도전한다", hint: "성공하면 소득 ↑↑",
          run: (p) => {
            if (chance(0.3 + p.k / 300 + (p.wealthPct > 0.6 ? 0.1 : 0))) { p.income *= 1.9; p.venture = "성공"; p.j += 10; return "가게가 자리를 잡았어요. 단골이 생겼어요!"; }
            p.income *= 0.6; p.venture = "실패"; p.j -= 12; p.h -= 5; return "2년 만에 가게를 닫았어요. 빚이 남았어요.";
          },
        },
        { label: "지금 일을 지킨다", hint: "안정", run: (p) => { p.income *= 1.04; p.j += 1; return "지금 자리를 지키기로 했어요."; } },
      ],
    },
    {
      id: "health", age: 47,
      when: () => true,
      q: () => "요즘 부쩍 몸이 무거워요.",
      options: [
        { label: "검진받고 몸을 챙긴다", hint: "건강 ↑", run: (p) => { const access = p.tier >= 2 || p.wealthPct > 0.7; p.h += access ? 12 : 5; p.decided.care = true; return access ? "일찍 문제를 찾아 치료했어요. 걷기도 시작했어요." : "멀리 있는 병원까지 다녀왔어요. 약값이 부담됐지만 조금 나아졌어요."; } },
        { label: "일이 먼저다", hint: "소득 ↑ · 건강 ↓", run: (p) => { if (p.job && !p.retired) p.income *= 1.1; p.h -= 10; return "괜찮겠지 하고 넘겼어요."; } },
      ],
    },
    {
      id: "friend", age: 58,
      when: () => true,
      q: () => "오래 연락이 끊긴 친구가 떠올라요.",
      options: [
        { label: "먼저 연락한다", hint: "관계 ↑", run: (p) => { p.r += 10; p.j += 5; return "목소리를 듣자마자 둘 다 웃음이 터졌어요."; } },
        { label: "마음에 묻어 둔다", hint: "", run: (p) => { p.j -= 1; return "가끔 그 친구 생각이 나요."; } },
      ],
    },
    {
      id: "legacy", age: 70,
      when: () => true,
      q: () => "남은 시간을 어떻게 보낼까요?",
      options: [
        { label: "내 이야기를 들려준다", hint: "관계 ↑", run: (p) => { p.r += 8; p.j += 4; return p.kids ? "아이들에게 젊은 날의 이야기를 들려줬어요." : "이웃 아이들이 내 이야기를 좋아해요."; } },
        { label: "배우고 싶던 걸 배운다", hint: "배움 ↑ · 행복 ↑", run: (p) => { p.k += 8; p.j += 5; return "일흔에 처음 배우는 것도 즐거워요."; } },
      ],
    },
  ];

  function pendingDecision(p) {
    const d = DECISIONS.find((x) => x.age === p.age && !p.decided[x.id] && x.when(p));
    if (!d) return null;
    return {
      id: d.id,
      q: d.q(p),
      options: d.options.filter((o) => !o.when || o.when(p)).map((o) => ({ ...o, label: typeof o.label === "function" ? o.label(p) : o.label })),
    };
  }

  function decide(p, d, idx) {
    p.decided[d.id] = true;
    const text = d.options[idx].run(p);
    p.log.push({ age: p.age, tone: "choice", text: `「${d.options[idx].label}」 — ${text}` });
    normalize(p);
    return text;
  }

  function autoPick(d) {
    return Math.floor(rand() * d.options.length);
  }

  /* ---------- 사망 ---------- */

  function causeOfDeath(p) {
    const a = p.age, t = p.tier;
    if (a === 0) return t <= 1 ? pick(["폐렴", "조산 합병증", "설사병", "출생 시 합병증"]) : pick(["선천성 질환", "조산 합병증"]);
    if (a < 15) return t <= 1 ? pick(["말라리아", "폐렴", "영양실조", "홍역", "물놀이 사고"]).replace("말라리아", p.c.region === "AF" ? "말라리아" : "뎅기열") : pick(["교통사고", "소아암", "익사 사고"]);
    if (a < 40) {
      if (p.c.conflict && chance(0.35)) return "분쟁 중 폭력";
      if (p.sex === "F" && p.married && t <= 1 && chance(0.3)) return "출산 합병증";
      return pick(t <= 1 ? ["결핵", "교통사고", "에이즈 관련 질환", "감염병"] : ["교통사고", "자살", "사고", "희귀 질환"]);
    }
    if (a < 70) return pick(["심장병", "뇌졸중", "암", t <= 1 ? "결핵" : "간 질환", "당뇨 합병증"]);
    return pick(["노환", "심장병", "뇌졸중", "폐렴", "치매 합병증", "암"]);
  }

  function mortality(p) {
    const healthMult = Math.exp(((expectedHealth(p.age) - p.h) / 50) * 0.6);
    let q = qx(p.c, p.age, p.mult) * (p.age < 5 ? 1 : healthMult);
    if (p.c.conflict && p.age >= 15 && p.age <= 60) q += 0.0006;
    return clamp(q, 0, 1);
  }

  const expectedHealth = (age) => 75 - Math.max(0, age - 35) * 0.75;

  function normalize(p) {
    for (const k of ["h", "j", "k", "r"]) p[k] = clamp(p[k], 0, 100);
  }

  function step(p) {
    const ev = yearEvents(p);
    const c = p.c;

    // 자연스러운 변화
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

  /* ---------- 요약 ---------- */

  function summary(p) {
    const S = p.home._S;
    const outlived = Math.round((1 - S[Math.min(p.age + 1, S.length - 1)]) * 100);
    const best = p.hist.reduce((b, x) => (x.j > b.j ? x : b), p.hist[0] || { age: 0, j: 0 });
    const worst = p.hist.reduce((b, x) => (x.j < b.j ? x : b), p.hist[0] || { age: 0, j: 0 });
    const avgJ = p.hist.reduce((s, x) => s + x.j, 0) / Math.max(1, p.hist.length);
    const income = p.peakIncome || 0;
    return {
      country: p.home, now: p.c, age: p.age, sex: p.sex, cause: p.cause,
      schoolYears: p.schoolYears, uni: p.uni, job: p.job, kids: p.kids, grandkids: p.grandkids,
      married: p.married || p.divorced, moved: p.moved, abroad: p.abroad,
      peakIncome: income, lifetimeIncome: p.lifetimeIncome,
      worldPct: income ? worldPercentile(income) : null,
      outlived, best, worst, avgJ: Math.round(avgJ), family: familyWord(p),
    };
  }

  // 동갑내기 100명 중 살아있는 수 (국가 생명표 기준)
  const aliveOf100 = (c, age) => Math.round(c._S[Math.min(age, c._S.length - 1)] * 100);

  return {
    born, step, advance, pendingDecision, decide, autoPick, summary, aliveOf100,
    worldPercentile, familyWord, tierOf,
  };
})();
