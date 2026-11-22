import type { Lang } from "./dictionary";

/**
 * Copy for the parts of the landing page (src/components/landing/bt) that the older landing never had:
 * labels inside the product mock-ups, the delivery and billing panels, the "Ask your business" band and
 * the "works with" strip. Everything else on the page reads proContent / landingContent.
 * Shop names and amounts in the mock-ups are sample data, kept in English in both languages.
 */
export type BtContent = {
  mock: {
    taxInvoice: string;
    items: string;
    orderingFor: string;
    week: string;
    yourCatalogue: string;
    heard: string;
    heardSay: string;
    heardNote: string;
    lines: [string, string, string];
    weekday: string;
    signatureSaved: string;
    paidUpi: string;
    shareLink: string;
    creditNote: string;
  };
  delivery: { kick: string; accent: string };
  billing: {
    kick: string;
    accent: string;
    gstrTitle: string;
    gstrBig: string;
    gstrNote: string;
    khata: string;
    within: string;
    of: string;
    khataNote: string;
  };
  ask: {
    kick: string;
    title: string;
    sub: string;
    question: string;
    answer: string;
    range: string;
    days: string;
    open: string;
  };
  works: { title1: string; title2: string; chips: string[] };
  faqTitle: string;
  menu: string;
  closeMenu: string;
};

export const btContent: Record<Lang, BtContent> = {
  en: {
    mock: {
      taxInvoice: "Tax invoice",
      items: "14 items",
      orderingFor: "Ordering for",
      week: "This week",
      yourCatalogue: "Your catalogue",
      heard: "Heard in Hindi",
      heardSay: "“दस आटा, पाँच नमक…”",
      heardNote: "Read into a cart for a quick check",
      lines: ["Atta 10 kg × 10", "Salt 1 kg × 5", "Biscuits × 24"],
      weekday: "Friday · 6:40 pm",
      signatureSaved: "Photo and signature saved",
      paidUpi: "Paid by UPI",
      shareLink: "PDF + share link",
      creditNote: "Credit note",
    },
    delivery: { kick: "Delivery", accent: "proof" },
    billing: {
      kick: "Billing and khata",
      accent: "that add up",
      gstrTitle: "GSTR-1 · November",
      gstrBig: "Export ready",
      gstrNote: "Register and Tally export too",
      khata: "Khata",
      within: "Within limit",
      of: "of",
      khataNote: "Credit limit · statement sent",
    },
    ask: {
      kick: "Ask your business",
      title: "Ask in plain words. Get the report.",
      sub: "No filters to learn. Type the question the way you would ask your munim — in English or Hindi.",
      question: "Who didn't order this week?",
      answer: "7 shops haven't ordered",
      range: "Mon–Fri",
      days: "days",
      open: "Open full report",
    },
    works: {
      title1: "Works the way India",
      title2: "sells, pays and files",
      chips: [
        "UPI links and QR",
        "GST invoices + GSTR-1",
        "Tally export",
        "Orders on WhatsApp",
        "Bank statement matching",
        "English + हिंदी",
        "Cheques and cash handover",
        "Laptop, tablet and phone",
      ],
    },
    faqTitle: "Questions distributors ask",
    menu: "Open menu",
    closeMenu: "Close menu",
  },
  hi: {
    mock: {
      taxInvoice: "टैक्स इनवॉइस",
      items: "14 आइटम",
      orderingFor: "ऑर्डर किसके लिए",
      week: "इस हफ़्ते",
      yourCatalogue: "आपका कैटलॉग",
      heard: "हिंदी में सुना",
      heardSay: "“दस आटा, पाँच नमक…”",
      heardNote: "कार्ट में आ गया, बस एक बार जाँच लें",
      lines: ["आटा 10 किलो × 10", "नमक 1 किलो × 5", "बिस्किट × 24"],
      weekday: "शुक्रवार · शाम 6:40",
      signatureSaved: "फ़ोटो और साइन सेव",
      paidUpi: "UPI से भुगतान",
      shareLink: "PDF + शेयर लिंक",
      creditNote: "क्रेडिट नोट",
    },
    delivery: { kick: "डिलीवरी", accent: "" },
    billing: {
      kick: "बिलिंग और खाता",
      accent: "",
      gstrTitle: "GSTR-1 · नवंबर",
      gstrBig: "एक्सपोर्ट तैयार",
      gstrNote: "रजिस्टर और Tally एक्सपोर्ट भी",
      khata: "खाता",
      within: "लिमिट के अंदर",
      of: "में से",
      khataNote: "क्रेडिट लिमिट · स्टेटमेंट भेजा गया",
    },
    ask: {
      kick: "अपने बिज़नेस से पूछिए",
      title: "सीधे शब्दों में पूछिए। रिपोर्ट पाइए।",
      sub: "कोई फ़िल्टर सीखने की ज़रूरत नहीं। सवाल वैसे ही लिखिए जैसे अपने मुनीम से पूछते — हिंदी या अंग्रेज़ी में।",
      question: "इस हफ़्ते किसने ऑर्डर नहीं किया?",
      answer: "7 दुकानों ने ऑर्डर नहीं किया",
      range: "सोम–शुक्र",
      days: "दिन",
      open: "पूरी रिपोर्ट खोलें",
    },
    works: {
      title1: "वैसे ही काम करे जैसे भारत",
      title2: "बेचता, भुगतान करता और GST भरता है",
      chips: [
        "UPI लिंक और QR",
        "GST इनवॉइस + GSTR-1",
        "Tally एक्सपोर्ट",
        "WhatsApp पर ऑर्डर",
        "बैंक स्टेटमेंट मिलान",
        "English + हिंदी",
        "चेक और नकद जमा",
        "लैपटॉप, टैबलेट और फ़ोन",
      ],
    },
    faqTitle: "डिस्ट्रीब्यूटर जो पूछते हैं",
    menu: "मेन्यू खोलें",
    closeMenu: "मेन्यू बंद करें",
  },
};
