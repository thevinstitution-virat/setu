import type { Lang } from "./dictionary";

export type JourneyStage = {
  title: string;
  time: string;
  who: string;
  whoClass: "kesar" | "mor" | "genda" | "mint";
  body: string;
};

export type StockMove = { qty: string; dir: "in" | "out"; label: string };

export type FaqItem = { q: string; a: string };

export type LandingContent = {
  // Nav
  navJourney: string;
  navGodown: string;
  navMap: string;
  navBill: string;
  navFaq: string;
  navBeat: string;
  navOwner: string;
  menuOpen: string;
  menuClose: string;
  signIn: string;
  demo: string;

  // Hero
  pillTag: string;
  pill: string;
  h1a: string;
  h1b: string;
  /** EN only: words that rotate after "every"; empty = static h1b. */
  rotWords: string[];
  lead: string;
  stats: { n: number; from: number; suffix: string; label: string }[];
  cta1: string;
  cta2: string;
  tick1: string;
  tick2: string;
  tick3: string;
  sceneAria: string;
  mapPill: string;
  nt1: string;
  nt1s: string;
  pickLbl: string;
  dropLbl: string;
  away: string;
  st1: string;
  st1s: string;
  st2: string;
  st2s: string;
  st3a: string;
  st3s: string;
  st4: string;
  st4s: string;
  st5: string;
  st5s: string;
  pl1: string;
  pl2: string;
  pl3: string;
  pl4: string;
  riderMeta: string;
  itemsW: string;
  cod: string;
  dTitle: string;
  dSub: string;

  // Built-for strip
  builtFor: string;
  bf1: string;
  bf2: string;
  bf3: string;
  bf4: string;

  // Journey ("how it works")
  jKick: string;
  jTitle: string;
  jSub: string;
  autoplay: string;
  shop: string;
  catalogue: string;
  newOrder: string;
  offerApplied: string;
  placeOrder: string;
  beat: string;
  checkedIn: string;
  linkedVisit: string;
  visitNote: string;
  visitNoteS: string;
  beatProgress: string;
  checkOut: string;
  office: string;
  godown: string;
  packAssign: string;
  stockWord: string;
  assignedTo: string;
  lgDel: string;
  drops: string;
  markPacked: string;
  onWay: string;
  toShop: string;
  deliveredBang: string;
  cashCollected: string;
  signed: string;
  retailerNotified: string;
  stages: JourneyStage[];

  // Godown & stock
  gKick: string;
  soon: string;
  gTitle: string;
  gSub: string;
  flow1: string;
  flow2: string;
  flow3: string;
  gp1: string;
  gp1d: string;
  gp2: string;
  gp2d: string;
  invAria: string;
  kSku: string;
  kPacked: string;
  kLow: string;
  p1: string;
  p2: string;
  p3: string;
  p4: string;
  reTitle: string;
  reBody: string;
  register: StockMove[];

  // Live map
  mKick: string;
  mTitle: string;
  mSub: string;
  mapAria: string;
  visit: string;
  agentsLive: string;
  ag1: string;
  ag2: string;
  ag3: string;
  ag4: string;
  fence: string;

  // Sales beat
  bKick: string;
  bTitle: string;
  bSub: string;
  bp1: string;
  bp1d: string;
  bp2: string;
  bp2d: string;
  bp3: string;
  bp3d: string;
  todayBeat: string;
  beatMeta: string;
  v1: string;
  v2: string;
  v3: string;
  next: string;
  noOrder: string;
  attendance: string;
  attendanceS: string;

  // Billing
  taxInvoice: string;
  billAria: string;
  offerLine: string;
  total: string;
  cash: string;
  online: string;
  credit: string;
  biKick: string;
  biTitle: string;
  biSub: string;
  bi1: string;
  bi1d: string;
  bi2: string;
  bi2d: string;
  bi3: string;
  bi3d: string;

  // Owner's dashboard
  oKick: string;
  oTitle: string;
  oSub: string;
  s1: string;
  s2: string;
  s3: string;
  s4: string;
  s5: string;
  byRegion: string;
  today: string;
  teamToday: string;
  salesAgents: string;
  delAgents: string;
  retailersOrdering: string;
  cashToday: string;
  seeDash: string;

  // Bilingual card
  lTitle: string;
  lSub: string;

  // Go live
  goKick: string;
  goTitle: string;
  g1: string;
  g1d: string;
  g2: string;
  g2d: string;
  g3: string;
  g3d: string;

  // FAQ
  faqKick: string;
  faqTitle: string;
  faq: FaqItem[];

  // CTA + footer
  ctaKick: string;
  ctaTitle: string;
  ctaSub: string;
  ctaStart: string;
  ctaWa: string;
  footTag: string;
  footProduct: string;
  footDesign: string;
  footExplore: string;
  footStart: string;
  footTalk: string;
  footEmail: string;
};

export const landingContent: Record<Lang, LandingContent> = {
  en: {
    navJourney: "How it works",
    navGodown: "Godown",
    navMap: "Live map",
    navBill: "Billing",
    navFaq: "FAQ",
    navBeat: "Sales beat",
    navOwner: "Dashboard",
    menuOpen: "Open menu",
    menuClose: "Close menu",
    signIn: "Sign in",
    demo: "Start free trial",

    pillTag: "NEW",
    pill: "Built for distributors and the retailers they serve",
    h1a: "The bridge between your godown and",
    h1b: "every retailer.",
    rotWords: ["retailer.", "kirana store.", "medical store.", "general store."],
    lead: "puts your orders, stock, sales beat, billing and deliveries on one app — so every retailer can order in a minute, and every delivery can be tracked to the shop door.",
    stats: [
      { n: 5, from: 0, suffix: "", label: "roles on one app — owner, office, sales, delivery, retailer" },
      { n: 2, from: 0, suffix: "", label: "languages on every screen — English and Hindi" },
      { n: 60, from: 0, suffix: "s", label: "for a retailer to place an order" },
      { n: 0, from: 9, suffix: "", label: "app-store downloads needed" },
    ],
    cta1: "Start free trial",
    cta2: "See how it works",
    tick1: "No app store needed",
    tick2: "OTP login for retailers",
    tick3: "GST-correct bills",
    sceneAria:
      "Live delivery tracking: the office map shows a delivery agent riding from the godown to Sharma Kirana while the retailer's phone counts down the ETA; on arrival the order is marked delivered with a burst of confetti",
    mapPill: "Live fleet · 4 agents on the road",
    nt1: "New order · ₹4,133",
    nt1s: "Sharma Kirana · 14 items",
    pickLbl: "Godown · pickup",
    dropLbl: "Sharma Kirana",
    away: "away",
    st1: "Order packed at the godown",
    st1s: "Basmati, oil and dal · stock updated",
    st2: "Ravi picked up your order",
    st2s: "Leaving the godown now",
    st3a: "Arriving in",
    st3s: "On the way · via Hazratganj",
    st4: "Almost there",
    st4s: "Ravi is near your shop",
    st5: "Delivered",
    st5s: "Signed and paid · 16:42",
    pl1: "Packed",
    pl2: "Picked up",
    pl3: "On the way",
    pl4: "Delivered",
    riderMeta: "Delivery agent",
    itemsW: "items",
    cod: "Cash on delivery",
    dTitle: "Delivered!",
    dSub: "Signed by Sharma ji · ₹4,133 cash collected",

    builtFor: "Built for",
    bf1: "Distributors",
    bf2: "Stockists & wholesalers",
    bf3: "Their retailers",
    bf4: "Field & delivery teams",

    jKick: "How it works",
    jTitle: "Follow one order across the bridge.",
    jSub: "Five steps, four people, one app. Everyone sees the same order move — so nobody has to call anybody to ask where it is.",
    autoplay: "Playing on its own — tap any step",
    shop: "Sharma Kirana",
    catalogue: "Catalogue",
    newOrder: "New order",
    offerApplied: "✓ Special prices applied · you save ₹396",
    placeOrder: "Place order",
    beat: "Beat",
    checkedIn: "Checked in at the shop",
    linkedVisit: "Order linked to this visit",
    visitNote: "Visit note",
    visitNoteS: "Wants Atta 10 kg next week",
    beatProgress: "Today's beat",
    checkOut: "Check out",
    office: "Office",
    godown: "Godown",
    packAssign: "Packed & assigned",
    stockWord: "Stock",
    assignedTo: "Assigned to",
    lgDel: "Delivery agent",
    drops: "drops today",
    markPacked: "Mark packed",
    onWay: "On the way to your shop",
    toShop: "to Sharma Kirana",
    deliveredBang: "Delivered!",
    cashCollected: "Cash collected",
    signed: "Signed by retailer",
    retailerNotified: "Retailer notified · bill sent",
    stages: [
      {
        title: "Retailer orders",
        time: "09:10 · Sharma Kirana",
        who: "Retailer",
        whoClass: "kesar",
        body: "From the catalogue on their phone, in under a minute. Prices, GST and offers are already worked out.",
      },
      {
        title: "Sales agent visits",
        time: "11:40 · on the beat",
        who: "Sales agent",
        whoClass: "mor",
        body: "Amit checks in at the shop with his location. The order is linked to the visit, with a note for next week.",
      },
      {
        title: "Office packs & assigns",
        time: "13:15 · godown",
        who: "Office",
        whoClass: "genda",
        body: "The order is confirmed and packed. Stock goes down by itself, and the drop is given to a delivery agent.",
      },
      {
        title: "On the way",
        time: "15:50 · live on the map",
        who: "Delivery agent",
        whoClass: "kesar",
        body: "Ravi follows the route. The retailer sees him coming, with an ETA — no “where is my order?” calls.",
      },
      {
        title: "Delivered",
        time: "16:42 · at the shop",
        who: "Proof captured",
        whoClass: "mint",
        body: "Signature on screen, ₹4,133 cash recorded, and the bill goes to the retailer. The order closes only at the shop.",
      },
    ],

    gKick: "Godown & stock",
    soon: "Rolling out",
    gTitle: "Stock that moves with every order.",
    gSub: "When an order is packed, stock goes down. When a new lot or a return comes in, it goes up. You always know what you can sell — before a retailer hears “maal khatam hai”.",
    flow1: "packed for orders",
    flow2: "new lot received",
    flow3: "returned",
    gp1: "Low-stock alerts",
    gp1d: "A reorder suggestion before a fast-moving item runs out.",
    gp2: "Every movement logged",
    gp2d: "In, out and returned — by product, by day, by godown.",
    invAria: "Stock dashboard: levels fall as orders are packed and refill on restock; Atta is running low",
    kSku: "Products",
    kPacked: "Packed today",
    kLow: "Low stock",
    p1: "Basmati Rice 5 kg",
    p2: "Mustard Oil 1 L",
    p3: "Atta 10 kg",
    p4: "Toor Dal 1 kg",
    reTitle: "Reorder Atta 10 kg",
    reBody: "About 2 days left at this week's pace. Suggested: 120 bags.",
    register: [
      { qty: "+120", dir: "in", label: "Atta 10 kg · new lot" },
      { qty: "−6", dir: "out", label: "Mustard Oil 1 L · SETU-1042" },
      { qty: "−4", dir: "out", label: "Basmati 5 kg · SETU-1042" },
      { qty: "−4", dir: "out", label: "Toor Dal 1 kg · SETU-1042" },
      { qty: "+2", dir: "in", label: "Basmati 5 kg · return" },
      { qty: "−12", dir: "out", label: "Atta 10 kg · SETU-1043" },
    ],

    mKick: "Live GPS tracking",
    mTitle: "Every delivery agent, live on one map.",
    mSub: "The office sees where every agent is and how many drops are left. Each retailer sees their own order coming — with the agent's name and an ETA.",
    mapAria: "Live map: delivery agents travel from the godown to retailers; each delivery turns the shop green with confetti",
    visit: "visit",
    agentsLive: "Agents · live",
    ag1: "3 drops left · Aminabad",
    ag2: "Crossing the river",
    ag3: "All delivered · returning",
    ag4: "Sales · at Sharma Kirana",
    fence: "An order can be marked delivered only at the retailer's shop",

    bKick: "Sales beat & field force",
    bTitle: "Your sales team's beat, visit by visit.",
    bSub: "Each sales agent gets today's route. Every visit is checked in with location, orders are booked on the spot, and attendance is marked from the field.",
    bp1: "Beats by area",
    bp1d: "Assign retailers and routes to each sales agent.",
    bp2: "Geo-tagged visits",
    bp2d: "Check-in and check-out at the shop, with notes.",
    bp3: "Attendance from the field",
    bp3d: "Clock in with location — no register needed.",
    todayBeat: "Today's beat",
    beatMeta: "9 of 14 shops visited · 7 orders",
    v1: "Checked in 10:55 · order booked",
    v2: "Checked in 11:40 · order booked",
    v3: "Checked in 12:20 · visit only",
    next: "Next on the route",
    noOrder: "No order",
    attendance: "Attendance · checked in",
    attendanceS: "Aminabad · location verified",

    taxInvoice: "Tax invoice",
    billAria: "A GST invoice building itself line by line, with collections by cash, online and credit",
    offerLine: "You save vs MRP",
    total: "Total",
    cash: "Cash",
    online: "Online",
    credit: "Credit",
    biKick: "Billing & collections",
    biTitle: "Bills that are right the first time.",
    biSub: "Every product carries its GST slab and offers. Every order shows subtotal, GST and total. Every rupee your agents collect — cash, online or credit — is recorded at the shop.",
    bi1: "GST by slab",
    bi1d: "0%, 5%, 12%, 18% — set once per product.",
    bi2: "Offers applied automatically",
    bi2d: "Quantity offers and special prices, worked out on the bill.",
    bi3: "Cash, online or credit",
    bi3d: "Collected, recorded and settled agent by agent.",

    oKick: "Owner's dashboard",
    oTitle: "Your whole business, on one screen.",
    oSub: "Every order at every stage, every region, every agent — and the day's collections — without a single phone call.",
    s1: "Placed",
    s2: "Confirmed",
    s3: "Packed",
    s4: "On the way",
    s5: "Delivered",
    byRegion: "Orders by area",
    today: "Today",
    teamToday: "Team today",
    salesAgents: "Sales agents on beat",
    delAgents: "Delivery agents out",
    retailersOrdering: "Retailers ordering",
    cashToday: "Collected today",
    seeDash: "Try it with your data",

    lTitle: "Works the way your team already talks.",
    lSub: "Switch the whole app between English and Hindi — every real screen, not just the menu. Try it: this page switches too.",

    goKick: "Go live",
    goTitle: "Three steps to your first order.",
    g1: "Add products & prices",
    g1d: "MRP, selling price, GST slab and offers — once, from the office.",
    g2: "Add your team & areas",
    g2d: "Sales agents, delivery agents, regions, areas and beats.",
    g3: "Send retailers a link",
    g3d: "They open it, add Seller's Setu to the home screen and log in with an OTP.",

    faqKick: "Questions",
    faqTitle: "Before you start",
    faq: [
      {
        q: "Who is Seller's Setu for?",
        a: "Distributors, stockists and wholesalers who sell to retailers through a sales team and their own delivery agents — and the retailers who order from them.",
      },
      {
        q: "Do retailers need to download an app?",
        a: "No. Seller's Setu opens from a link and adds itself to the home screen, straight from the browser. Retailers log in with an OTP.",
      },
      {
        q: "Can I see where my delivery agents are?",
        a: "Yes. Agents share their location while they are out on deliveries, so the office sees them on one map and each retailer sees an ETA for their own order.",
      },
      {
        q: "How does stock stay correct?",
        a: "Stock goes down when an order is packed and back up on a return or a new lot, and every movement is logged by product and day.",
      },
      {
        q: "Is GST handled correctly?",
        a: "Yes. Every product carries its GST slab, and every order shows subtotal, GST and total separately.",
      },
      {
        q: "Can my team use it only in Hindi?",
        a: "Yes. Switch EN / हिं anywhere in the app, and it stays in that language until you switch back.",
      },
    ],

    ctaKick: "Free trial",
    ctaTitle: "Build the bridge to every retailer.",
    ctaSub: "See Seller's Setu running with your own products, team and retailers.",
    ctaStart: "Get started",
    ctaWa: "WhatsApp us",
    footTag: "Orders, stock, beats, billing and deliveries — in one app.",
    footProduct: "A product of VPD Vastus Ventures Private Limited",
    footDesign: "Concept and design by VGraphics",
    footExplore: "Explore",
    footStart: "Get started",
    footTalk: "Talk to us",
    footEmail: "Email us",
  },
  hi: {
    navJourney: "कैसे काम करता है",
    navGodown: "गोदाम",
    navMap: "लाइव नक्शा",
    navBill: "बिलिंग",
    navFaq: "सवाल",
    navBeat: "सेल्स बीट",
    navOwner: "डैशबोर्ड",
    menuOpen: "मेन्यू खोलें",
    menuClose: "मेन्यू बंद करें",
    signIn: "लॉगिन",
    demo: "मुफ़्त ट्रायल शुरू करें",

    pillTag: "नया",
    pill: "डिस्ट्रीब्यूटर और उनके रिटेलरों के लिए बना",
    h1a: "आपके गोदाम और",
    h1b: "हर रिटेलर के बीच का सेतु।",
    rotWords: [],
    lead: "आपके ऑर्डर, स्टॉक, सेल्स बीट, बिलिंग और डिलीवरी को एक ऐप पर लाता है — ताकि हर रिटेलर एक मिनट में ऑर्डर कर सके, और हर डिलीवरी दुकान के दरवाज़े तक ट्रैक हो।",
    stats: [
      { n: 5, from: 0, suffix: "", label: "भूमिकाएँ एक ऐप पर — मालिक, ऑफ़िस, सेल्स, डिलीवरी, रिटेलर" },
      { n: 2, from: 0, suffix: "", label: "भाषाएँ हर स्क्रीन पर — अंग्रेज़ी और हिंदी" },
      { n: 60, from: 0, suffix: " सेकंड", label: "में रिटेलर का ऑर्डर" },
      { n: 0, from: 9, suffix: "", label: "ऐप स्टोर डाउनलोड की ज़रूरत" },
    ],
    cta1: "मुफ़्त ट्रायल शुरू करें",
    cta2: "देखें कैसे काम करता है",
    tick1: "ऐप स्टोर की ज़रूरत नहीं",
    tick2: "रिटेलर के लिए OTP लॉगिन",
    tick3: "GST के साथ सही बिल",
    sceneAria:
      "लाइव डिलीवरी ट्रैकिंग: ऑफ़िस के नक्शे पर एजेंट गोदाम से शर्मा किराना जाता है और रिटेलर के फ़ोन पर ETA घटता है; पहुँचने पर डिलीवर और कॉन्फ़ेटी",
    mapPill: "लाइव फ़्लीट · 4 एजेंट रास्ते में",
    nt1: "नया ऑर्डर · ₹4,133",
    nt1s: "शर्मा किराना · 14 आइटम",
    pickLbl: "गोदाम · पिकअप",
    dropLbl: "शर्मा किराना",
    away: "दूर",
    st1: "गोदाम में ऑर्डर पैक हुआ",
    st1s: "बासमती, तेल और दाल · स्टॉक अपडेट",
    st2: "रवि ने आपका ऑर्डर उठाया",
    st2s: "गोदाम से निकल रहे हैं",
    st3a: "पहुँच रहे हैं",
    st3s: "रास्ते में · हज़रतगंज होकर",
    st4: "बस पहुँचने वाले हैं",
    st4s: "रवि आपकी दुकान के पास हैं",
    st5: "डिलीवर हो गया",
    st5s: "हस्ताक्षर और भुगतान · 16:42",
    pl1: "पैक",
    pl2: "उठाया",
    pl3: "रास्ते में",
    pl4: "डिलीवर",
    riderMeta: "डिलीवरी एजेंट",
    itemsW: "आइटम",
    cod: "डिलीवरी पर नकद",
    dTitle: "डिलीवर हो गया!",
    dSub: "शर्मा जी ने हस्ताक्षर किए · ₹4,133 नकद मिला",

    builtFor: "किनके लिए",
    bf1: "डिस्ट्रीब्यूटर",
    bf2: "स्टॉकिस्ट और होलसेलर",
    bf3: "उनके रिटेलर",
    bf4: "फ़ील्ड और डिलीवरी टीम",

    jKick: "कैसे काम करता है",
    jTitle: "एक ऑर्डर को सेतु पार करते देखें।",
    jSub: "पाँच कदम, चार लोग, एक ऐप। सबको एक ही ऑर्डर आगे बढ़ता दिखता है — किसी को फ़ोन करके पूछना नहीं पड़ता।",
    autoplay: "अपने-आप चल रहा है — किसी भी कदम पर टैप करें",
    shop: "शर्मा किराना",
    catalogue: "कैटलॉग",
    newOrder: "नया ऑर्डर",
    offerApplied: "✓ खास दाम लगे · ₹396 की बचत",
    placeOrder: "ऑर्डर करें",
    beat: "बीट",
    checkedIn: "दुकान पर चेक-इन",
    linkedVisit: "ऑर्डर इस विज़िट से जुड़ा",
    visitNote: "विज़िट नोट",
    visitNoteS: "अगले हफ़्ते आटा 10 किलो चाहिए",
    beatProgress: "आज की बीट",
    checkOut: "चेक-आउट",
    office: "ऑफ़िस",
    godown: "गोदाम",
    packAssign: "पैक और सौंपा",
    stockWord: "स्टॉक",
    assignedTo: "सौंपा",
    lgDel: "डिलीवरी एजेंट",
    drops: "डिलीवरी आज",
    markPacked: "पैक मार्क करें",
    onWay: "आपकी दुकान की ओर",
    toShop: "शर्मा किराना तक",
    deliveredBang: "डिलीवर हो गया!",
    cashCollected: "नकद मिला",
    signed: "रिटेलर ने हस्ताक्षर किए",
    retailerNotified: "रिटेलर को सूचना · बिल भेजा",
    stages: [
      {
        title: "रिटेलर ऑर्डर करता है",
        time: "09:10 · शर्मा किराना",
        who: "रिटेलर",
        whoClass: "kesar",
        body: "फ़ोन के कैटलॉग से, एक मिनट से भी कम में। दाम, GST और ऑफ़र पहले से जुड़े हैं।",
      },
      {
        title: "सेल्स एजेंट की विज़िट",
        time: "11:40 · बीट पर",
        who: "सेल्स एजेंट",
        whoClass: "mor",
        body: "अमित लोकेशन के साथ दुकान पर चेक-इन करते हैं। ऑर्डर विज़िट से जुड़ता है, अगले हफ़्ते का नोट भी।",
      },
      {
        title: "ऑफ़िस पैक कर सौंपता है",
        time: "13:15 · गोदाम",
        who: "ऑफ़िस",
        whoClass: "genda",
        body: "ऑर्डर पक्का होकर पैक होता है। स्टॉक अपने-आप घटता है, और डिलीवरी एजेंट को सौंपा जाता है।",
      },
      {
        title: "रास्ते में",
        time: "15:50 · नक्शे पर लाइव",
        who: "डिलीवरी एजेंट",
        whoClass: "kesar",
        body: "रवि रूट पर हैं। रिटेलर को वे आते दिखते हैं, ETA के साथ — “मेरा ऑर्डर कहाँ है?” वाले फ़ोन नहीं।",
      },
      {
        title: "डिलीवर",
        time: "16:42 · दुकान पर",
        who: "प्रमाण के साथ",
        whoClass: "mint",
        body: "स्क्रीन पर हस्ताक्षर, ₹4,133 नकद दर्ज, और बिल रिटेलर को। ऑर्डर सिर्फ़ दुकान पर ही बंद होता है।",
      },
    ],

    gKick: "गोदाम और स्टॉक",
    soon: "जल्द आ रहा है",
    gTitle: "हर ऑर्डर के साथ चलने वाला स्टॉक।",
    gSub: "ऑर्डर पैक होते ही स्टॉक घटता है। नया माल या वापसी आते ही बढ़ता है। आपको हमेशा पता रहता है कि क्या बेच सकते हैं — रिटेलर के “माल खत्म है” सुनने से पहले।",
    flow1: "ऑर्डर के लिए पैक",
    flow2: "नया माल आया",
    flow3: "वापसी",
    gp1: "कम स्टॉक की चेतावनी",
    gp1d: "तेज़ बिकने वाला माल खत्म होने से पहले मँगाने का सुझाव।",
    gp2: "हर आवाजाही दर्ज",
    gp2d: "आया, गया, वापस आया — उत्पाद, दिन और गोदाम के हिसाब से।",
    invAria: "स्टॉक डैशबोर्ड: पैक होने पर स्टॉक घटता और नया माल आने पर भरता; आटा कम है",
    kSku: "उत्पाद",
    kPacked: "आज पैक",
    kLow: "कम स्टॉक",
    p1: "बासमती चावल 5 किलो",
    p2: "सरसों तेल 1 लीटर",
    p3: "आटा 10 किलो",
    p4: "अरहर दाल 1 किलो",
    reTitle: "आटा 10 किलो मँगाएं",
    reBody: "इस हफ़्ते की बिक्री से करीब 2 दिन का बचा है। सुझाव: 120 बोरी।",
    register: [
      { qty: "+120", dir: "in", label: "आटा 10 किलो · नया माल" },
      { qty: "−6", dir: "out", label: "सरसों तेल · SETU-1042" },
      { qty: "−4", dir: "out", label: "बासमती 5 किलो · SETU-1042" },
      { qty: "−4", dir: "out", label: "अरहर दाल · SETU-1042" },
      { qty: "+2", dir: "in", label: "बासमती · वापसी" },
      { qty: "−12", dir: "out", label: "आटा 10 किलो · SETU-1043" },
    ],

    mKick: "लाइव GPS ट्रैकिंग",
    mTitle: "हर डिलीवरी एजेंट, एक नक्शे पर लाइव।",
    mSub: "ऑफ़िस को दिखता है कि हर एजेंट कहाँ है और कितनी डिलीवरी बाकी हैं। हर रिटेलर को अपना ऑर्डर आता दिखता है — एजेंट के नाम और ETA के साथ।",
    mapAria: "लाइव नक्शा: डिलीवरी एजेंट गोदाम से रिटेलरों तक; हर डिलीवरी पर दुकान हरी और कॉन्फ़ेटी",
    visit: "विज़िट",
    agentsLive: "एजेंट · लाइव",
    ag1: "3 डिलीवरी बाकी · अमीनाबाद",
    ag2: "नदी पार कर रहे हैं",
    ag3: "सब डिलीवर · वापसी",
    ag4: "सेल्स · शर्मा किराना पर",
    fence: "ऑर्डर सिर्फ़ रिटेलर की दुकान पर ही डिलीवर मार्क हो सकता है",

    bKick: "सेल्स बीट और फ़ील्ड टीम",
    bTitle: "आपकी सेल्स टीम की बीट, विज़िट-दर-विज़िट।",
    bSub: "हर सेल्स एजेंट को आज का रूट मिलता है। हर विज़िट लोकेशन के साथ दर्ज होती है, वहीं ऑर्डर बुक होता है, और हाज़िरी फ़ील्ड से लगती है।",
    bp1: "एरिया के हिसाब से बीट",
    bp1d: "हर सेल्स एजेंट को रिटेलर और रूट सौंपें।",
    bp2: "लोकेशन के साथ विज़िट",
    bp2d: "दुकान पर चेक-इन और चेक-आउट, नोट के साथ।",
    bp3: "फ़ील्ड से हाज़िरी",
    bp3d: "लोकेशन के साथ हाज़िरी — रजिस्टर की ज़रूरत नहीं।",
    todayBeat: "आज की बीट",
    beatMeta: "14 में से 9 दुकानें · 7 ऑर्डर",
    v1: "चेक-इन 10:55 · ऑर्डर बुक",
    v2: "चेक-इन 11:40 · ऑर्डर बुक",
    v3: "चेक-इन 12:20 · सिर्फ़ विज़िट",
    next: "रूट पर अगला",
    noOrder: "ऑर्डर नहीं",
    attendance: "हाज़िरी · चेक-इन",
    attendanceS: "अमीनाबाद · लोकेशन पक्की",

    taxInvoice: "टैक्स इनवॉइस",
    billAria: "GST बिल जो लाइन-दर-लाइन बनता है, नकद, ऑनलाइन और उधार वसूली के साथ",
    offerLine: "MRP से बचत",
    total: "कुल",
    cash: "नकद",
    online: "ऑनलाइन",
    credit: "उधार",
    biKick: "बिलिंग और वसूली",
    biTitle: "पहली बार में ही सही बिल।",
    biSub: "हर उत्पाद की GST दर और ऑफ़र तय हैं। हर ऑर्डर में सबटोटल, GST और कुल दिखता है। एजेंट जो भी रुपया लेते हैं — नकद, ऑनलाइन या उधार — दुकान पर ही दर्ज होता है।",
    bi1: "दर के हिसाब से GST",
    bi1d: "0%, 5%, 12%, 18% — हर उत्पाद पर एक बार तय करें।",
    bi2: "ऑफ़र अपने-आप लगें",
    bi2d: "मात्रा पर छूट और खास दाम, बिल पर ही।",
    bi3: "नकद, ऑनलाइन या उधार",
    bi3d: "एजेंट के हिसाब से वसूली, दर्ज और जमा।",

    oKick: "मालिक का डैशबोर्ड",
    oTitle: "आपका पूरा कारोबार, एक स्क्रीन पर।",
    oSub: "हर चरण का हर ऑर्डर, हर क्षेत्र, हर एजेंट — और दिन की वसूली — बिना एक भी फ़ोन किए।",
    s1: "ऑर्डर हुआ",
    s2: "पक्का",
    s3: "पैक",
    s4: "रास्ते में",
    s5: "डिलीवर",
    byRegion: "एरिया के हिसाब से ऑर्डर",
    today: "आज",
    teamToday: "आज की टीम",
    salesAgents: "बीट पर सेल्स एजेंट",
    delAgents: "बाहर डिलीवरी एजेंट",
    retailersOrdering: "ऑर्डर करने वाले रिटेलर",
    cashToday: "आज की वसूली",
    seeDash: "अपने डेटा के साथ आज़माएँ",

    lTitle: "जैसे आपकी टीम बात करती है, वैसे ही काम करे।",
    lSub: "पूरा ऐप हिंदी और अंग्रेज़ी में बदलें — सिर्फ़ मेन्यू नहीं, हर असली स्क्रीन। आज़माकर देखें: यह पेज भी बदल जाता है।",

    goKick: "शुरुआत",
    goTitle: "पहले ऑर्डर तक बस तीन कदम।",
    g1: "उत्पाद और दाम जोड़ें",
    g1d: "MRP, बिक्री दाम, GST दर और ऑफ़र — एक बार, ऑफ़िस से।",
    g2: "टीम और एरिया जोड़ें",
    g2d: "सेल्स एजेंट, डिलीवरी एजेंट, क्षेत्र, एरिया और बीट।",
    g3: "रिटेलरों को लिंक भेजें",
    g3d: "वे लिंक खोलें, सेलर्स सेतु को होम स्क्रीन पर लगाएं और OTP से लॉगिन करें।",

    faqKick: "सवाल",
    faqTitle: "शुरू करने से पहले",
    faq: [
      {
        q: "सेलर्स सेतु किसके लिए है?",
        a: "उन डिस्ट्रीब्यूटर, स्टॉकिस्ट और होलसेलर के लिए जो सेल्स टीम और अपने डिलीवरी एजेंट के ज़रिए रिटेलरों को माल बेचते हैं — और उन रिटेलरों के लिए जो उनसे ऑर्डर करते हैं।",
      },
      {
        q: "क्या रिटेलर को कोई ऐप डाउनलोड करना होगा?",
        a: "नहीं। सेलर्स सेतु एक लिंक से खुलता है और ब्राउज़र से ही होम स्क्रीन पर लग जाता है। रिटेलर OTP से लॉगिन करते हैं।",
      },
      {
        q: "क्या मैं देख सकता हूँ कि डिलीवरी एजेंट कहाँ हैं?",
        a: "हाँ। डिलीवरी के दौरान एजेंट की लोकेशन दिखती है — ऑफ़िस को सब एक नक्शे पर, और हर रिटेलर को अपने ऑर्डर का ETA।",
      },
      {
        q: "स्टॉक सही कैसे रहता है?",
        a: "ऑर्डर पैक होते ही स्टॉक घटता है, वापसी या नया माल आने पर बढ़ता है, और हर आवाजाही उत्पाद और दिन के हिसाब से दर्ज होती है।",
      },
      {
        q: "क्या GST सही लगता है?",
        a: "हाँ। हर उत्पाद की GST दर तय है, और हर ऑर्डर में सबटोटल, GST और कुल अलग-अलग दिखते हैं।",
      },
      {
        q: "क्या मेरी टीम सिर्फ़ हिंदी में चला सकती है?",
        a: "हाँ। ऐप में कहीं भी EN / हिं बदलें — जब तक वापस न बदलें, वही भाषा रहती है।",
      },
    ],

    ctaKick: "मुफ़्त ट्रायल",
    ctaTitle: "हर रिटेलर तक अपना सेतु बनाइए।",
    ctaSub: "सेलर्स सेतु को अपने ही उत्पाद, टीम और रिटेलरों के साथ चलता देखें।",
    ctaStart: "शुरू करें",
    ctaWa: "WhatsApp करें",
    footTag: "ऑर्डर, स्टॉक, बीट, बिलिंग और डिलीवरी — एक ऐप में।",
    footProduct: "VPD Vastus Ventures Private Limited का एक प्रोडक्ट",
    footDesign: "संकल्पना और डिज़ाइन — VGraphics",
    footExplore: "देखें",
    footStart: "शुरू करें",
    footTalk: "बात करें",
    footEmail: "ईमेल करें",
  },
};
