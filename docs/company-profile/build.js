const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const Fi = require("react-icons/fi");

// ---------- palette ----------
const NAVY = "0B1F3A";
const NAVY2 = "132C52";
const GOLD = "B8975A";
const GOLD_SOFT = "D9C7A3";
const WHITE = "FFFFFF";
const OFF = "F4F5F7";
const TINT = "EEF1F5";
const INK = "1F2937";
const MUTE = "6B7280";
const LINE = "D9DEE6";

const FONT = "맑은 고딕";
const FONT_EN = "Arial";

const W = 13.333, H = 7.5;
const ML = 0.75; // left margin
const CW = W - ML * 2; // content width

async function icon(Comp, color, px = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(
    React.createElement(Comp, { color: "#" + color, size: px, strokeWidth: 1.6 })
  );
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

function footer(slide, n, dark = false) {
  slide.addText("선영회계법인", {
    x: ML, y: H - 0.5, w: 3, h: 0.3, fontFace: FONT, fontSize: 9,
    color: dark ? GOLD_SOFT : MUTE, isTextBox: true, margin: 0,
  });
  slide.addText(String(n).padStart(2, "0"), {
    x: W - ML - 1, y: H - 0.5, w: 1, h: 0.3, fontFace: FONT_EN, fontSize: 9,
    color: dark ? GOLD_SOFT : MUTE, align: "right", isTextBox: true, margin: 0,
  });
}

function header(slide, en, ko) {
  slide.addText(en.toUpperCase(), {
    x: ML, y: 0.55, w: CW, h: 0.3, fontFace: FONT_EN, fontSize: 11, bold: true,
    color: GOLD, charSpacing: 3, isTextBox: true, margin: 0,
  });
  slide.addText(ko, {
    x: ML, y: 0.85, w: CW, h: 0.7, fontFace: FONT, fontSize: 30, bold: true,
    color: NAVY, isTextBox: true, margin: 0,
  });
}

// icon inside a filled circle
function iconCircle(slide, data, x, y, d, fill) {
  slide.addShape("ellipse", { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill, width: 0 } });
  const pad = d * 0.27;
  slide.addImage({ data, x: x + pad, y: y + pad, w: d - pad * 2, h: d - pad * 2 });
}

(async () => {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  pres.title = "선영회계법인 회사소개서";
  pres.lang = "ko-KR";

  const ic = {
    shield: await icon(Fi.FiShield, WHITE),
    book: await icon(Fi.FiBookOpen, WHITE),
    file: await icon(Fi.FiFileText, WHITE),
    trend: await icon(Fi.FiTrendingUp, WHITE),
    shieldG: await icon(Fi.FiShield, GOLD),
    bookG: await icon(Fi.FiBookOpen, GOLD),
    fileG: await icon(Fi.FiFileText, GOLD),
    trendG: await icon(Fi.FiTrendingUp, GOLD),
    search: await icon(Fi.FiSearch, WHITE),
    layers: await icon(Fi.FiLayers, WHITE),
    growth: await icon(Fi.FiBarChart2, WHITE),
    cpu: await icon(Fi.FiCpu, WHITE),
    users: await icon(Fi.FiUsers, WHITE),
    check: await icon(Fi.FiCheckCircle, WHITE),
    pin: await icon(Fi.FiMapPin, GOLD),
    phone: await icon(Fi.FiPhone, GOLD),
    globe: await icon(Fi.FiGlobe, GOLD),
    calendar: await icon(Fi.FiCalendar, GOLD),
    award: await icon(Fi.FiAward, GOLD),
    grid: await icon(Fi.FiGrid, GOLD),
    userG: await icon(Fi.FiUser, GOLD),
    checkG: await icon(Fi.FiCheckCircle, GOLD),
  };

  // ============ 1. Cover ============
  {
    const s = pres.addSlide();
    s.background = { color: NAVY };
    s.addShape("ellipse", { x: 8.6, y: -2.2, w: 7.5, h: 7.5, fill: { color: NAVY2 }, line: { color: NAVY2, width: 0 } });
    s.addShape("ellipse", { x: 10.9, y: 4.6, w: 4.4, h: 4.4, fill: { color: NAVY2 }, line: { color: NAVY2, width: 0 } });
    s.addText("COMPANY PROFILE", {
      x: ML, y: 2.05, w: 8, h: 0.35, fontFace: FONT_EN, fontSize: 12, bold: true,
      color: GOLD, charSpacing: 4, isTextBox: true, margin: 0,
    });
    s.addText("선영회계법인", {
      x: ML, y: 2.45, w: 9, h: 1.3, fontFace: FONT, fontSize: 60, bold: true,
      color: WHITE, isTextBox: true, margin: 0,
    });
    s.addText("SEONYEONG Accounting Corporation", {
      x: ML, y: 3.75, w: 9, h: 0.45, fontFace: FONT_EN, fontSize: 18,
      color: GOLD_SOFT, isTextBox: true, margin: 0,
    });
    s.addText("신뢰할 수 있는 전략적 파트너", {
      x: ML, y: 4.55, w: 9, h: 0.5, fontFace: FONT, fontSize: 22,
      color: WHITE, isTextBox: true, margin: 0,
    });
    s.addText("www.syacc.co.kr", {
      x: ML, y: H - 0.85, w: 4, h: 0.3, fontFace: FONT_EN, fontSize: 11,
      color: GOLD_SOFT, isTextBox: true, margin: 0,
    });
    s.addText("2026", {
      x: W - ML - 2, y: H - 0.85, w: 2, h: 0.3, fontFace: FONT_EN, fontSize: 11,
      color: GOLD_SOFT, align: "right", isTextBox: true, margin: 0,
    });
    s.addNotes("선영회계법인 회사소개서 표지");
  }

  // ============ 2. Statement ============
  {
    const s = pres.addSlide();
    s.background = { color: WHITE };
    s.addShape("rect", { x: 0, y: 0, w: 5.2, h: H, fill: { color: TINT }, line: { color: TINT, width: 0 } });
    s.addText([
      { text: "EXCELLENCE.", options: { breakLine: true } },
      { text: "VALUE.", options: { color: GOLD } },
    ], {
      x: ML, y: 2.2, w: 4.3, h: 2.4, fontFace: FONT_EN, fontSize: 38, bold: true,
      color: NAVY, lineSpacingMultiple: 1.05, isTextBox: true, margin: 0, valign: "middle",
    });
    s.addText("전문성으로 가치를 키우는 곳,\n선영회계법인.", {
      x: 6.0, y: 2.1, w: 6.6, h: 1.5, fontFace: FONT, fontSize: 30, bold: true,
      color: NAVY, isTextBox: true, margin: 0, valign: "top",
    });
    s.addText("회계·세무·재무자문 분야의 깊은 경험으로\n고객의 비즈니스에 전략적 가치를 더합니다.", {
      x: 6.0, y: 3.75, w: 6.6, h: 1.2, fontFace: FONT, fontSize: 16,
      color: INK, lineSpacingMultiple: 1.35, isTextBox: true, margin: 0,
    });
    footer(s, 2);
  }

  // ============ 3. About ============
  {
    const s = pres.addSlide();
    s.background = { color: WHITE };
    header(s, "About Us", "회사 개요");

    s.addText(
      "고객의 복잡한 재무 상황을 정확히 진단하고, 구조화된 해결책을 제시함으로써 기업의 지속 가능한 성장과 투명한 경영 환경 조성에 기여합니다.\n\n회계사의 윤리성과 전문성을 바탕으로, 단순한 대행이 아닌 고객의 전략적 파트너로서 함께합니다.",
      {
        x: ML, y: 1.9, w: 5.4, h: 3.6, fontFace: FONT, fontSize: 15, color: INK,
        lineSpacingMultiple: 1.45, isTextBox: true, margin: 0, valign: "top",
      }
    );

    const facts = [
      { ic: ic.calendar, k: "설립", v: "2024년 12월" },
      { ic: ic.pin, k: "소재지", v: "서울특별시 강남구 테헤란로70길 12" },
      { ic: ic.award, k: "대표 회계사", v: "최학수" },
      { ic: ic.grid, k: "사업영역", v: "Audit · Accounting Advisory · Tax · Financial Advisory" },
    ];
    const gx = 6.9, gy = 1.9, gw = 5.7, gh = 0.95, gap = 0.2;
    facts.forEach((f, i) => {
      const y = gy + i * (gh + gap);
      s.addShape("roundRect", { x: gx, y, w: gw, h: gh, fill: { color: OFF }, line: { color: OFF, width: 0 }, rectRadius: 0.08 });
      s.addShape("ellipse", { x: gx + 0.2, y: y + 0.2, w: 0.55, h: 0.55, fill: { color: WHITE }, line: { color: GOLD, width: 1 } });
      s.addImage({ data: f.ic, x: gx + 0.335, y: y + 0.335, w: 0.28, h: 0.28 });
      s.addText(f.k, { x: gx + 1.0, y: y + 0.14, w: gw - 1.2, h: 0.3, fontFace: FONT, fontSize: 10.5, color: MUTE, isTextBox: true, margin: 0 });
      s.addText(f.v, { x: gx + 1.0, y: y + 0.44, w: gw - 1.2, h: 0.4, fontFace: FONT, fontSize: 14, bold: true, color: NAVY, isTextBox: true, margin: 0 });
    });
    footer(s, 3);
  }

  // ============ 4. Philosophy ============
  {
    const s = pres.addSlide();
    s.background = { color: WHITE };
    header(s, "Our Approach", "일하는 원칙");
    const cols = [
      { ic: ic.search, en: "DIAGNOSE", ko: "정확한 진단", d: "고객의 복잡한 재무 상황을 정확히 진단합니다. 문제의 실체를 먼저 파악합니다." },
      { ic: ic.layers, en: "STRUCTURE", ko: "구조화된 해결책", d: "회계·세무·재무를 아우르는 구조화된 해결책을 제시합니다." },
      { ic: ic.growth, en: "CONTRIBUTE", ko: "지속 가능한 성장", d: "기업의 지속 가능한 성장과 투명한 경영 환경 조성에 기여합니다." },
    ];
    const cw = 3.75, gap = 0.3, cy = 1.95, ch = 3.6;
    cols.forEach((c, i) => {
      const x = ML + i * (cw + gap);
      s.addShape("roundRect", { x, y: cy, w: cw, h: ch, fill: { color: OFF }, line: { color: OFF, width: 0 }, rectRadius: 0.1 });
      iconCircle(s, c.ic, x + 0.35, cy + 0.4, 0.8, NAVY);
      s.addText(c.en, { x: x + 0.35, y: cy + 1.4, w: cw - 0.7, h: 0.3, fontFace: FONT_EN, fontSize: 10.5, bold: true, color: GOLD, charSpacing: 2, isTextBox: true, margin: 0 });
      s.addText(c.ko, { x: x + 0.35, y: cy + 1.7, w: cw - 0.7, h: 0.5, fontFace: FONT, fontSize: 20, bold: true, color: NAVY, isTextBox: true, margin: 0 });
      s.addText(c.d, { x: x + 0.35, y: cy + 2.25, w: cw - 0.7, h: 1.2, fontFace: FONT, fontSize: 13, color: INK, lineSpacingMultiple: 1.35, isTextBox: true, margin: 0, valign: "top" });
    });
    s.addText("윤리성  ·  전문성  ·  전략적 파트너십", {
      x: ML, y: 5.9, w: CW, h: 0.45, fontFace: FONT, fontSize: 15, bold: true, color: GOLD, align: "center", isTextBox: true, margin: 0,
    });
    footer(s, 4);
  }

  // ============ 5. Services overview ============
  {
    const s = pres.addSlide();
    s.background = { color: NAVY };
    s.addText("SERVICES", { x: ML, y: 0.55, w: CW, h: 0.3, fontFace: FONT_EN, fontSize: 11, bold: true, color: GOLD, charSpacing: 3, isTextBox: true, margin: 0 });
    s.addText("서비스 영역", { x: ML, y: 0.85, w: CW, h: 0.7, fontFace: FONT, fontSize: 30, bold: true, color: WHITE, isTextBox: true, margin: 0 });
    const cards = [
      { ic: ic.shieldG, en: "Audit & Assurance", ko: "회계감사", d: "K-IFRS · K-GAAP · US GAAP 등 국내외 회계기준에 따른 독립적·객관적 재무제표 감사" },
      { ic: ic.bookG, en: "Accounting Advisory", ko: "회계자문", d: "신규 회계기준 도입, 복잡한 거래의 회계처리, 내부회계관리제도 구축 지원" },
      { ic: ic.fileG, en: "Tax Services", ko: "세무", d: "세무조정과 각종 신고대리, 세무 리스크 최소화 및 합리적 세금 전략 수립" },
      { ic: ic.trendG, en: "Financial Advisory", ko: "재무자문", d: "M&A, 기업가치 평가, 실사(Due Diligence), 사업 타당성 분석" },
    ];
    const cw = 2.78, gap = 0.24, cy = 1.95, ch = 4.1;
    cards.forEach((c, i) => {
      const x = ML + i * (cw + gap);
      s.addShape("roundRect", { x, y: cy, w: cw, h: ch, fill: { color: NAVY2 }, line: { color: NAVY2, width: 0 }, rectRadius: 0.1 });
      s.addShape("ellipse", { x: x + 0.3, y: cy + 0.35, w: 0.75, h: 0.75, fill: { color: NAVY }, line: { color: GOLD, width: 1 } });
      s.addImage({ data: c.ic, x: x + 0.49, y: cy + 0.54, w: 0.37, h: 0.37 });
      s.addText(c.en, { x: x + 0.3, y: cy + 1.3, w: cw - 0.6, h: 0.3, fontFace: FONT_EN, fontSize: 10.5, bold: true, color: GOLD, isTextBox: true, margin: 0 });
      s.addText(c.ko, { x: x + 0.3, y: cy + 1.6, w: cw - 0.6, h: 0.5, fontFace: FONT, fontSize: 21, bold: true, color: WHITE, isTextBox: true, margin: 0 });
      s.addText(c.d, { x: x + 0.3, y: cy + 2.2, w: cw - 0.6, h: 1.7, fontFace: FONT, fontSize: 12, color: GOLD_SOFT, lineSpacingMultiple: 1.35, isTextBox: true, margin: 0, valign: "top" });
    });
    footer(s, 5, true);
  }

  // ============ 6-9. Service detail (shared layout) ============
  function serviceSlide(n, en, ko, iconData, lead, items, note) {
    const s = pres.addSlide();
    s.background = { color: WHITE };
    header(s, en, ko);
    // left: lead statement on tint panel
    s.addShape("roundRect", { x: ML, y: 1.9, w: 5.6, h: 4.2, fill: { color: TINT }, line: { color: TINT, width: 0 }, rectRadius: 0.1 });
    iconCircle(s, iconData, ML + 0.4, 2.3, 0.85, NAVY);
    s.addText(lead, {
      x: ML + 0.4, y: 3.4, w: 4.8, h: 2.4, fontFace: FONT, fontSize: 17, bold: true, color: NAVY,
      lineSpacingMultiple: 1.4, isTextBox: true, margin: 0, valign: "top",
    });
    // right: item list
    const rx = 7.0, rw = W - ML - rx;
    items.forEach((it, i) => {
      const y = 1.95 + i * 1.02;
      s.addShape("ellipse", { x: rx, y: y + 0.08, w: 0.42, h: 0.42, fill: { color: WHITE }, line: { color: GOLD, width: 1 } });
      s.addText(String(i + 1), { x: rx, y: y + 0.08, w: 0.42, h: 0.42, fontFace: FONT_EN, fontSize: 11, bold: true, color: GOLD, align: "center", valign: "middle", isTextBox: true, margin: 0 });
      s.addText(it.t, { x: rx + 0.65, y, w: rw - 0.65, h: 0.36, fontFace: FONT, fontSize: 15, bold: true, color: NAVY, isTextBox: true, margin: 0 });
      s.addText(it.d, { x: rx + 0.65, y: y + 0.37, w: rw - 0.65, h: 0.5, fontFace: FONT, fontSize: 12, color: MUTE, isTextBox: true, margin: 0, valign: "top" });
      if (i < items.length - 1) s.addShape("line", { x: rx + 0.65, y: y + 0.93, w: rw - 0.65, h: 0, line: { color: LINE, width: 0.75 } });
    });
    if (note) s.addText(note, { x: rx, y: 6.15, w: rw, h: 0.3, fontFace: FONT, fontSize: 10, color: MUTE, isTextBox: true, margin: 0 });
    footer(s, n);
    return s;
  }

  serviceSlide(6, "Audit & Assurance", "회계감사", ic.shield,
    "투명한 회계 정보는 모든 이해관계자와 기업의 신뢰를 연결하는 기반입니다.",
    [
      { t: "재무제표 감사", d: "K-IFRS, K-GAAP, US GAAP 등 국내외 회계기준에 따른 독립적·객관적 감사" },
      { t: "내부회계관리제도", d: "상장사 내부회계관리제도 관련 업무 수행 경험" },
      { t: "회계기준 대응", d: "국내외 기준 적용 이슈에 대한 검토와 대응" },
      { t: "이해관계자 신뢰", d: "투명한 회계 정보로 투자자·금융기관·감독당국과의 신뢰 기반 구축" },
    ]);

  serviceSlide(7, "Accounting Advisory Services", "회계자문", ic.book,
    "기업이 복잡한 회계 이슈에 효과적으로 대응할 수 있도록 전문적인 솔루션을 제공합니다.",
    [
      { t: "신규 회계기준 도입", d: "새로운 기준서 적용 영향 분석과 도입 지원" },
      { t: "복잡한 거래의 회계처리", d: "비정형 거래·구조화 거래에 대한 회계처리 검토" },
      { t: "내부회계관리제도 구축", d: "설계·운영·평가 체계 구축 지원" },
      { t: "표준회계처리", d: "회계처리 기준과 프로세스 표준화" },
    ]);

  serviceSlide(8, "Tax Services", "세무", ic.file,
    "복잡하게 변화하는 세법 환경 속에서 기업의 세무 리스크를 최소화하고, 합리적인 세금 전략을 수립할 수 있도록 지원합니다.",
    [
      { t: "세무조정", d: "법인세·소득세 신고를 위한 결산 및 세무조정" },
      { t: "각종 신고대리", d: "법인세·소득세·부가가치세·원천세 등 신고대리" },
      { t: "세무 리스크 관리", d: "세법 변화에 따른 리스크 식별과 사전 대응" },
      { t: "세금 전략 수립", d: "기업 상황에 맞는 합리적인 세금 전략 설계" },
    ]);

  serviceSlide(9, "Financial Advisory Services", "재무자문", ic.trend,
    "기업의 가치 극대화를 위해 전문적인 재무 분석과 전략적 자문을 제공합니다.",
    [
      { t: "M&A 자문", d: "인수·합병 거래 구조 검토와 자문" },
      { t: "기업가치 평가", d: "주식가치평가, 합병비율 분석 등 가치평가" },
      { t: "실사 (Due Diligence)", d: "재무·세무 실사를 통한 거래 리스크 파악" },
      { t: "사업 타당성 분석", d: "투자·사업 의사결정을 위한 타당성 검토" },
    ]);

  // ============ 10. Portfolio ============
  {
    const s = pres.addSlide();
    s.background = { color: WHITE };
    header(s, "Portfolio", "주요 수행 실적");
    const items = [
      { en: "Internal Control", t: "상장사 P사 내부회계관리제도 관련 업무" },
      { en: "Valuation", t: "합병비율 분석 및 주식가치평가" },
      { en: "Valuation", t: "외국계 기업 총괄 주식가치평가" },
      { en: "Audit", t: "회계감사 업무 수행" },
      { en: "Advisory", t: "표준회계처리 자문" },
    ];
    const cy = 1.95, ch = 0.74, gap = 0.14;
    items.forEach((it, i) => {
      const y = cy + i * (ch + gap);
      s.addShape("roundRect", { x: ML, y, w: CW, h: ch, fill: { color: OFF }, line: { color: OFF, width: 0 }, rectRadius: 0.08 });
      s.addText(String(i + 1).padStart(2, "0"), { x: ML + 0.3, y, w: 0.7, h: ch, fontFace: FONT_EN, fontSize: 18, bold: true, color: GOLD, valign: "middle", isTextBox: true, margin: 0 });
      s.addText(it.en.toUpperCase(), { x: ML + 1.1, y, w: 2.4, h: ch, fontFace: FONT_EN, fontSize: 10.5, bold: true, color: MUTE, charSpacing: 1.5, valign: "middle", isTextBox: true, margin: 0 });
      s.addText(it.t, { x: ML + 3.6, y, w: CW - 3.9, h: ch, fontFace: FONT, fontSize: 15, bold: true, color: NAVY, valign: "middle", isTextBox: true, margin: 0 });
    });
    s.addText("* 세부 실적은 고객사 비밀유지 의무에 따라 익명 처리되어 있습니다.", { x: ML, y: 6.4, w: CW, h: 0.3, fontFace: FONT, fontSize: 10, color: MUTE, isTextBox: true, margin: 0 });
    footer(s, 10);
  }

  // ============ 11. Experts ============
  {
    const s = pres.addSlide();
    s.background = { color: WHITE };
    header(s, "Experts", "전문가");
    const people = [
      { n: "최학수", r: "대표 회계사" },
      { n: "황휘순", r: "공인회계사" },
      { n: "한만현", r: "공인회계사" },
      { n: "이지훈", r: "공인회계사" },
      { n: "이준호", r: "공인회계사" },
      { n: "이범기", r: "공인회계사" },
    ];
    const cols = 3, cw = 3.75, ch = 1.85, gx = 0.3, gy = 0.3, cy = 1.95;
    people.forEach((p, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const x = ML + c * (cw + gx), y = cy + r * (ch + gy);
      const lead = i === 0;
      s.addShape("roundRect", { x, y, w: cw, h: ch, fill: { color: lead ? NAVY : OFF }, line: { color: lead ? NAVY : OFF, width: 0 }, rectRadius: 0.1 });
      s.addShape("ellipse", { x: x + 0.35, y: y + 0.5, w: 0.85, h: 0.85, fill: { color: lead ? NAVY2 : WHITE }, line: { color: GOLD, width: 1 } });
      s.addImage({ data: ic.userG, x: x + 0.575, y: y + 0.725, w: 0.4, h: 0.4 });
      s.addText(p.n, { x: x + 1.45, y: y + 0.5, w: cw - 1.7, h: 0.5, fontFace: FONT, fontSize: 20, bold: true, color: lead ? WHITE : NAVY, isTextBox: true, margin: 0 });
      s.addText(p.r, { x: x + 1.45, y: y + 1.0, w: cw - 1.7, h: 0.35, fontFace: FONT, fontSize: 13, color: lead ? GOLD_SOFT : MUTE, isTextBox: true, margin: 0 });
      s.addText("CPA", { x: x + cw - 1.0, y: y + 0.25, w: 0.75, h: 0.3, fontFace: FONT_EN, fontSize: 9, bold: true, color: GOLD, align: "right", charSpacing: 1.5, isTextBox: true, margin: 0 });
    });
    footer(s, 11);
  }

  // ============ 12. How we work ============
  {
    const s = pres.addSlide();
    s.background = { color: WHITE };
    header(s, "How We Work", "체계적이고 효율적인 운영");
    s.addText("반복적인 업무는 시스템화·자동화하고, 구성원은 고객 응대와 회계·세무 이슈 해결에 집중합니다.", {
      x: ML, y: 1.75, w: CW, h: 0.5, fontFace: FONT, fontSize: 15, color: INK, isTextBox: true, margin: 0,
    });
    const steps = [
      { ic: ic.cpu, t: "시스템화 · 자동화", d: "반복 업무를 시스템으로 처리해 정확성과 속도를 확보합니다." },
      { ic: ic.users, t: "고객 응대 집중", d: "확보한 시간을 고객과의 소통과 맞춤 대응에 투입합니다." },
      { ic: ic.check, t: "이슈 해결", d: "회계사의 전문성을 회계·세무 이슈의 실질적 해결에 집중합니다." },
    ];
    const cw = 3.75, gap = 0.3, cy = 2.65, ch = 3.1;
    steps.forEach((st, i) => {
      const x = ML + i * (cw + gap);
      s.addShape("roundRect", { x, y: cy, w: cw, h: ch, fill: { color: OFF }, line: { color: OFF, width: 0 }, rectRadius: 0.1 });
      iconCircle(s, st.ic, x + 0.35, cy + 0.4, 0.8, NAVY);
      s.addText(`STEP ${i + 1}`, { x: x + 1.35, y: cy + 0.45, w: 2, h: 0.3, fontFace: FONT_EN, fontSize: 10.5, bold: true, color: GOLD, charSpacing: 2, isTextBox: true, margin: 0 });
      s.addText(st.t, { x: x + 1.35, y: cy + 0.75, w: cw - 1.6, h: 0.45, fontFace: FONT, fontSize: 17, bold: true, color: NAVY, isTextBox: true, margin: 0 });
      s.addText(st.d, { x: x + 0.35, y: cy + 1.5, w: cw - 0.7, h: 1.3, fontFace: FONT, fontSize: 13, color: INK, lineSpacingMultiple: 1.35, isTextBox: true, margin: 0, valign: "top" });
    });
    footer(s, 12);
  }

  // ============ 13. Contact ============
  {
    const s = pres.addSlide();
    s.background = { color: NAVY };
    s.addShape("ellipse", { x: -2.5, y: 3.6, w: 6.5, h: 6.5, fill: { color: NAVY2 }, line: { color: NAVY2, width: 0 } });
    s.addText("CONTACT", { x: ML, y: 0.55, w: CW, h: 0.3, fontFace: FONT_EN, fontSize: 11, bold: true, color: GOLD, charSpacing: 3, isTextBox: true, margin: 0 });
    s.addText("신뢰할 수 있는 전략적 파트너,\n선영회계법인", { x: ML, y: 1.0, w: 8, h: 1.7, fontFace: FONT, fontSize: 32, bold: true, color: WHITE, lineSpacingMultiple: 1.2, isTextBox: true, margin: 0 });
    const rows = [
      { ic: ic.pin, k: "ADDRESS", v: "서울특별시 강남구 테헤란로70길 12 (대치동)" },
      { ic: ic.phone, k: "TEL", v: "02-1660-1261" },
      { ic: ic.globe, k: "WEB", v: "www.syacc.co.kr" },
    ];
    rows.forEach((r, i) => {
      const y = 3.3 + i * 0.95;
      s.addShape("ellipse", { x: 7.2, y, w: 0.6, h: 0.6, fill: { color: NAVY2 }, line: { color: GOLD, width: 1 } });
      s.addImage({ data: r.ic, x: 7.36, y: y + 0.16, w: 0.28, h: 0.28 });
      s.addText(r.k, { x: 8.05, y: y - 0.02, w: 4.5, h: 0.28, fontFace: FONT_EN, fontSize: 9.5, bold: true, color: GOLD, charSpacing: 2, isTextBox: true, margin: 0 });
      s.addText(r.v, { x: 8.05, y: y + 0.26, w: 5.0, h: 0.4, fontFace: FONT, fontSize: 13, color: WHITE, isTextBox: true, margin: 0 });
    });
    s.addText("SEONYEONG Accounting Corporation", { x: ML, y: 6.0, w: 6, h: 0.35, fontFace: FONT_EN, fontSize: 12, color: GOLD_SOFT, isTextBox: true, margin: 0 });
    footer(s, 13, true);
  }

  await pres.writeFile({ fileName: "선영회계법인_회사소개서.pptx" });
  console.log("written");
})().catch((e) => { console.error(e); process.exit(1); });
