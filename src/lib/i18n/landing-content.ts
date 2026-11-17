import type { Lang } from "./dictionary";

export type TimelineStop = {
  time: string;
  phase: string;
  icon: string;
  title: string;
  body: string;
};

export type FeatureCard = {
  role: "retailer" | "sales" | "delivery" | "admin";
  icon: string;
  title: string;
  desc: string;
};

export type FaqItem = { q: string; a: string };

export type LandingContent = {
  eyebrow: string;
  heroLead: string;
  heroAccent: string;
  heroSub: string;
  ctaPrimary: string;
  ctaSecondary: string;
  timelineKicker: string;
  timelineTitle: string;
  timeline: TimelineStop[];
  compareKicker: string;
  compareTitle: string;
  compareBefore: string;
  compareBeforeItems: string[];
  compareAfter: string;
  compareAfterItems: string[];
  bilingualKicker: string;
  bilingualTitle: string;
  bilingualSub: string;
  bilingualCardTitle: string;
  bilingualCardBody: string;
  bilingualCardStatus: string;
  stats: { value: number; decimals: number; suffix: string; label: string }[];
  featuresKicker: string;
  featuresTitle: string;
  roleFilters: { key: "all" | "retailer" | "sales" | "delivery" | "admin"; label: string }[];
  features: FeatureCard[];
  faqKicker: string;
  faqTitle: string;
  faq: FaqItem[];
  ctaFooterTitle: string;
  ctaFooterSub: string;
  footerTagline: string;
  footerProductOf: string;
  footerDesignBy: string;
};

export const landingContent: Record<Lang, LandingContent> = {
  en: {
    eyebrow: "One app, four roles, zero app-switching",
    heroLead: "Retailer to delivery,",
    heroAccent: "in one bridge.",
    heroSub:
      "Setu replaces three separate apps with a single connected workflow — retailer ordering, sales field activity and delivery, all in one login.",
    ctaPrimary: "Get started",
    ctaSecondary: "See how it works",
    timelineKicker: "A DAY WITH SETU",
    timelineTitle: "One order, followed end to end",
    timeline: [
      {
        time: "09:10",
        phase: "MORNING",
        icon: "🛒",
        title: "The retailer places an order",
        body: "From the catalogue, in under a minute — GST and any special offers already worked out.",
      },
      {
        time: "11:40",
        phase: "MIDDAY",
        icon: "📍",
        title: "The sales agent checks in on the beat",
        body: "A geo-tagged visit, right from the retailer's shop, with the order already linked to it.",
      },
      {
        time: "13:15",
        phase: "AFTERNOON",
        icon: "📊",
        title: "Admin moves it through the pipeline",
        body: "Confirmed, packed, assigned to a delivery agent — one screen, no phone calls.",
      },
      {
        time: "16:30",
        phase: "EVENING",
        icon: "🛵",
        title: "The delivery agent completes it",
        body: "Cash collected, a signature captured on screen, proof of delivery attached.",
      },
      {
        time: "19:00",
        phase: "NIGHT",
        icon: "✅",
        title: "The retailer sees it, live",
        body: "Delivered — with the agent's name, not just a status word.",
      },
    ],
    compareKicker: "WHY ONE APP",
    compareTitle: "One bridge, not three apps",
    compareBefore: "Before",
    compareBeforeItems: [
      "Three separate apps to install",
      "Three logins to remember",
      "No shared view of an order's status",
    ],
    compareAfter: "With Setu",
    compareAfterItems: [
      "One app, role-based views",
      "One login for everyone",
      "Live pipeline, visible to all four roles",
    ],
    bilingualKicker: "भाषा / LANGUAGE",
    bilingualTitle: "Works the way your team already talks",
    bilingualSub: "Switch the whole app between English and Hindi — not just the menu, the real screens.",
    bilingualCardTitle: "Order status",
    bilingualCardBody: "Basmati Rice 5kg × 1",
    bilingualCardStatus: "Out for delivery",
    stats: [
      { value: 4, decimals: 0, suffix: "", label: "Connected roles, one login" },
      { value: 2, decimals: 0, suffix: "", label: "Languages, one toggle" },
      { value: 5, decimals: 0, suffix: "", label: "Order stages, always visible" },
      { value: 100, decimals: 0, suffix: "%", label: "GST-correct billing" },
    ],
    featuresKicker: "FOUR ROLES, ONE APP",
    featuresTitle: "Built for everyone in the chain",
    roleFilters: [
      { key: "all", label: "All" },
      { key: "retailer", label: "Retailer" },
      { key: "sales", label: "Sales Agent" },
      { key: "delivery", label: "Delivery Agent" },
      { key: "admin", label: "Admin" },
    ],
    features: [
      { role: "retailer", icon: "🛒", title: "Catalogue & ordering", desc: "Browse, order, and see GST and offers upfront." },
      { role: "retailer", icon: "📦", title: "Live order timeline", desc: "Placed → confirmed → packed → delivered, with no guessing." },
      { role: "sales", icon: "🗺️", title: "Beat & visits", desc: "Geo-tagged check-ins at every retailer on the route." },
      { role: "sales", icon: "🕒", title: "Attendance", desc: "Clock in and out with location, right from the field." },
      { role: "delivery", icon: "🛵", title: "Assigned deliveries", desc: "A clear queue, no mix-ups about who's carrying what." },
      { role: "delivery", icon: "✍️", title: "Proof of delivery", desc: "Signature, photo and cash collection, captured on the spot." },
      { role: "admin", icon: "📊", title: "Pipeline dashboard", desc: "Every order's status, across every role, in real time." },
      { role: "admin", icon: "🏷️", title: "Products, GST & offers", desc: "Set prices, GST slabs and special offers centrally." },
    ],
    faqKicker: "QUESTIONS",
    faqTitle: "Before you start",
    faq: [
      { q: "Do retailers need to download an app?", a: "No separate install — Setu installs itself to the home screen as a PWA, straight from the browser." },
      { q: "Is GST handled correctly?", a: "Yes — every product carries a GST slab, and every order shows subtotal, GST and total separately." },
      { q: "Can I use it only in Hindi?", a: "Yes — toggle EN/हिं anywhere in the app, and it stays on that language until you switch it back." },
      { q: "What happens to the three old apps?", a: "Setu replaces all three with one login and role-based views — nothing to install three times over." },
    ],
    ctaFooterTitle: "Ready to bridge retailer to delivery?",
    ctaFooterSub: "One login. Four roles. No more app-switching.",
    footerTagline: "One app for retailer orders, sales visits and deliveries.",
    footerProductOf: "A product of VPD Vastus Ventures Private Limited",
    footerDesignBy: "Concept and design by VGraphics",
  },
  hi: {
    eyebrow: "एक ऐप, चार भूमिकाएं, कोई ऐप बदलना नहीं",
    heroLead: "Retailer से Delivery तक,",
    heroAccent: "एक ही सेतु में।",
    heroSub:
      "सेतु तीन अलग-अलग ऐप की जगह एक जुड़ा हुआ वर्कफ़्लो देता है — रिटेलर ऑर्डरिंग, सेल्स फील्ड गतिविधि और डिलीवरी, सब एक ही लॉगिन में।",
    ctaPrimary: "शुरू करें",
    ctaSecondary: "देखें कैसे काम करता है",
    timelineKicker: "सेतु के साथ एक दिन",
    timelineTitle: "एक ऑर्डर, शुरू से आखिर तक",
    timeline: [
      {
        time: "09:10",
        phase: "सुबह",
        icon: "🛒",
        title: "रिटेलर ऑर्डर करता है",
        body: "कैटलॉग से, एक मिनट से भी कम में — GST और ऑफ़र पहले से साफ़ दिखते हैं।",
      },
      {
        time: "11:40",
        phase: "दोपहर",
        icon: "📍",
        title: "सेल्स एजेंट बीट पर चेक-इन करता है",
        body: "रिटेलर की दुकान से ही जियो-टैग विज़िट, और ऑर्डर उससे जुड़ा हुआ।",
      },
      {
        time: "13:15",
        phase: "दोपहर बाद",
        icon: "📊",
        title: "एडमिन ऑर्डर आगे बढ़ाता है",
        body: "पुष्टि, पैकिंग, डिलीवरी एजेंट को सौंपा — एक ही स्क्रीन से, बिना फोन किए।",
      },
      {
        time: "16:30",
        phase: "शाम",
        icon: "🛵",
        title: "डिलीवरी एजेंट पूरा करता है",
        body: "नकद लिया, स्क्रीन पर हस्ताक्षर लिया, डिलीवरी का प्रमाण जोड़ा।",
      },
      {
        time: "19:00",
        phase: "रात",
        icon: "✅",
        title: "रिटेलर को तुरंत दिखता है",
        body: "डिलीवर हुआ — एजेंट के नाम के साथ, सिर्फ एक शब्द नहीं।",
      },
    ],
    compareKicker: "एक ऐप क्यों",
    compareTitle: "एक सेतु, तीन ऐप नहीं",
    compareBefore: "पहले",
    compareBeforeItems: [
      "तीन अलग-अलग ऐप इंस्टॉल करने पड़ते थे",
      "तीन लॉगिन याद रखने पड़ते थे",
      "ऑर्डर की स्थिति किसी को एक साथ नहीं दिखती थी",
    ],
    compareAfter: "सेतु के साथ",
    compareAfterItems: [
      "एक ऐप, भूमिका के अनुसार स्क्रीन",
      "सबके लिए एक ही लॉगिन",
      "लाइव पाइपलाइन, चारों भूमिकाओं को दिखे",
    ],
    bilingualKicker: "भाषा / LANGUAGE",
    bilingualTitle: "जैसे आपकी टीम बात करती है, वैसे ही काम करे",
    bilingualSub: "पूरा ऐप अंग्रेज़ी और हिंदी के बीच बदलें — सिर्फ मेन्यू नहीं, असली स्क्रीन भी।",
    bilingualCardTitle: "ऑर्डर की स्थिति",
    bilingualCardBody: "बासमती चावल 5 किलो × 1",
    bilingualCardStatus: "डिलीवरी के लिए निकला",
    stats: [
      { value: 4, decimals: 0, suffix: "", label: "भूमिकाएं, एक लॉगिन" },
      { value: 2, decimals: 0, suffix: "", label: "भाषाएं, एक टॉगल" },
      { value: 5, decimals: 0, suffix: "", label: "ऑर्डर स्थितियां, हमेशा दिखें" },
      { value: 100, decimals: 0, suffix: "%", label: "सही GST बिलिंग" },
    ],
    featuresKicker: "चार भूमिकाएं, एक ऐप",
    featuresTitle: "हर किसी के लिए बना",
    roleFilters: [
      { key: "all", label: "सभी" },
      { key: "retailer", label: "रिटेलर" },
      { key: "sales", label: "सेल्स एजेंट" },
      { key: "delivery", label: "डिलीवरी एजेंट" },
      { key: "admin", label: "एडमिन" },
    ],
    features: [
      { role: "retailer", icon: "🛒", title: "कैटलॉग और ऑर्डरिंग", desc: "देखें, ऑर्डर करें, GST और ऑफ़र पहले से साफ़।" },
      { role: "retailer", icon: "📦", title: "लाइव ऑर्डर टाइमलाइन", desc: "प्लेस → पुष्टि → पैक → डिलीवर, बिना अंदाज़ा लगाए।" },
      { role: "sales", icon: "🗺️", title: "बीट और विज़िट", desc: "रूट के हर रिटेलर पर जियो-टैग चेक-इन।" },
      { role: "sales", icon: "🕒", title: "उपस्थिति", desc: "फील्ड से ही लोकेशन के साथ चेक-इन और चेक-आउट।" },
      { role: "delivery", icon: "🛵", title: "सौंपी गई डिलीवरी", desc: "साफ़ सूची, किसे क्या ले जाना है इसमें कोई उलझन नहीं।" },
      { role: "delivery", icon: "✍️", title: "डिलीवरी का प्रमाण", desc: "हस्ताक्षर, फोटो और नकद संग्रह, मौके पर ही।" },
      { role: "admin", icon: "📊", title: "पाइपलाइन डैशबोर्ड", desc: "हर भूमिका में, हर ऑर्डर की स्थिति, रीयल-टाइम में।" },
      { role: "admin", icon: "🏷️", title: "उत्पाद, GST और ऑफ़र", desc: "कीमतें, GST दरें और ऑफ़र केंद्र से तय करें।" },
    ],
    faqKicker: "सवाल",
    faqTitle: "शुरू करने से पहले",
    faq: [
      { q: "क्या रिटेलर को कोई ऐप डाउनलोड करना होगा?", a: "अलग इंस्टॉल की ज़रूरत नहीं — सेतु ब्राउज़र से सीधे होम स्क्रीन पर खुद इंस्टॉल हो जाता है।" },
      { q: "क्या GST सही तरीके से लगता है?", a: "हां — हर उत्पाद की GST दर तय है, और हर ऑर्डर में सबटोटल, GST और कुल अलग-अलग दिखते हैं।" },
      { q: "क्या मैं सिर्फ हिंदी में इस्तेमाल कर सकता हूं?", a: "हां — ऐप में कहीं भी EN/हिं बदलें, जब तक आप वापस न बदलें वही भाषा बनी रहती है।" },
      { q: "पुराने तीन ऐप का क्या होगा?", a: "सेतु तीनों की जगह एक लॉगिन और भूमिका-आधारित स्क्रीन देता है — तीन बार इंस्टॉल करने की ज़रूरत नहीं।" },
    ],
    ctaFooterTitle: "Retailer से Delivery तक सेतु बनाने के लिए तैयार?",
    ctaFooterSub: "एक लॉगिन। चार भूमिकाएं। अब कोई ऐप बदलना नहीं।",
    footerTagline: "रिटेलर ऑर्डर, सेल्स विज़िट और डिलीवरी के लिए एक ऐप।",
    footerProductOf: "VPD Vastus Ventures Private Limited का एक प्रोडक्ट",
    footerDesignBy: "संकल्पना और डिज़ाइन — VGraphics",
  },
};
