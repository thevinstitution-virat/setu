import type { Lang } from "./dictionary";

/** Copy for the VBiz Pro landing page (the product mock-ups still read landing-content.ts). */

export type RoleKey = "owner" | "office" | "sales" | "delivery" | "retailer";
export type IconKey =
  | "bill"
  | "box"
  | "truck"
  | "pin"
  | "tag"
  | "wallet"
  | "bank"
  | "chart"
  | "chat"
  | "camera"
  | "brand"
  | "cart"
  | "mic"
  | "bell"
  | "star"
  | "route"
  | "clock"
  | "shield"
  | "lang"
  | "phone";

export type ProContent = {
  nav: { features: string; problems: string; how: string; faq: string };
  hero: { eyebrow: string; title1: string; title2: string; sub: string; cta1: string; cta2: string; notes: string[] };
  roles: { key: RoleKey; label: string; caption: string; toasts: [string, string][] }[];
  trust: { lead: string; items: string[] };
  problems: { kick: string; title: string; sub: string; tabs: { tab: string; title: string; body: string; points: string[] }[] };
  retail: { kick: string; title: string; sub: string; items: { icon: IconKey; t: string; d: string }[] };
  statsKick: string;
  suite: { kick: string; title: string; sub: string; live: string; counter: string; devices: { t: string; d: string }[] };
  foot: {
    about: string;
    chips: string[];
    badge: string;
    product: string;
    devices: string;
    builtFor: string;
    start: string;
    contact: string;
    call: string;
    whatsapp: string;
    email: string;
    address: string;
    terms: string;
    privacy: string;
    brandLine: string;
    rights: string;
    designedBy: string;
  };
  grid: { kick: string; title: string; sub: string; items: { icon: IconKey; t: string; d: string }[] };
  steps: { kick: string; title: string };
  cta: { title: string; sub: string; primary: string; secondary: string };
  mock: {
    search: string;
    today: string;
    ordersToday: string;
    collected: string;
    outForDelivery: string;
    lowStock: string;
    recentOrders: string;
    shop: string;
    amount: string;
    status: string;
    st: { placed: string; packed: string; onWay: string; delivered: string };
    dispatch: string;
    planTrips: string;
    tripsReady: string;
    beat: string;
    checkIn: string;
    nextShop: string;
    trip: string;
    dropsLeft: string;
    collect: string;
    cart: string;
    placeOrder: string;
    typeOrder: string;
    offer: string;
    menu: string[];
  };
};

export const proContent: Record<Lang, ProContent> = {
  en: {
    nav: { features: "Features", problems: "Solutions", how: "How it works", faq: "FAQ" },
    hero: {
      eyebrow: "Distribution management software",
      title1: "Run your whole distribution business",
      title2: "from one app",
      sub: "Orders, stock, sales beat, billing, delivery and payments — connected for the owner, the office, the field team and every retailer you supply.",
      cta1: "Start free trial",
      cta2: "See how it works",
      notes: ["Free trial", "Works on any phone", "English and Hindi"],
    },
    roles: [
      { key: "owner", label: "Owner", caption: "The whole business on one screen", toasts: [["New order", "Gupta General Store · ₹3,120"], ["Evening summary", "Sales up 12% on last Friday"]] },
      { key: "office", label: "Office", caption: "Orders, packing and dispatch", toasts: [["Trips planned", "3 trips · 41 drops"], ["Low stock", "Atta 10 kg · 14 left"]] },
      { key: "sales", label: "Sales agent", caption: "Today's beat, visit by visit", toasts: [["Checked in", "Sharma Kirana · 09:42"], ["Order booked", "₹4,133 · 14 items"]] },
      { key: "delivery", label: "Delivery agent", caption: "Trips, drops and collections", toasts: [["Delivered", "Photo and signature saved"], ["Cash collected", "₹4,133 · settled tonight"]] },
      { key: "retailer", label: "Retailer", caption: "Order in a minute, from a link", toasts: [["Offer applied", "You saved ₹396"], ["On the way", "Ravi · 12 min away"]] },
    ],
    trust: {
      lead: "Built for distributors, stockists and wholesalers in",
      items: ["FMCG & grocery", "Pharma", "Dairy & beverages", "Hardware & paints", "Electricals", "Stationery & books"],
    },
    problems: {
      kick: "Why VBiz Pro",
      title: "Five problems we solve",
      sub: "Most distributors run on phone calls, registers and three different apps. Here is what changes when everyone works in one.",
      tabs: [
        {
          tab: "Orders by phone",
          title: "Orders that don't depend on phone calls",
          body: "Retailers order from a link on their phone — or send a WhatsApp message — and the order lands in the office already priced.",
          points: [
            "Each shop sees its own catalogue, prices and schemes",
            "Orders by text or voice are read into a cart for a quick check",
            "Offers and GST worked out on the bill automatically",
          ],
        },
        {
          tab: "Stock",
          title: "Stock you can trust",
          body: "Stock goes down when an order is packed and up when a lot or a return comes in — so you always know what you can sell.",
          points: [
            "Batches and expiry dates, oldest stock out first",
            "Purchase orders and goods received, supplier by supplier",
            "A reorder suggestion before a fast item runs out",
          ],
        },
        {
          tab: "Field team",
          title: "A sales team you can actually see",
          body: "Every sales agent gets today's route. Visits are checked in with location and orders are booked on the spot.",
          points: [
            "Beats by area, assigned to each agent",
            "Geo-tagged check-in, check-out and attendance",
            "Targets, visit notes and a supervisor view",
          ],
        },
        {
          tab: "Delivery",
          title: "Deliveries with proof",
          body: "Trips are planned from the day's orders. The office sees every agent on the map, and each retailer sees their own order coming.",
          points: [
            "Trips and drop order planned in one click",
            "Live location while the agent is on duty",
            "Photo, signature or delivery code at the shop",
          ],
        },
        {
          tab: "Billing",
          title: "Bills and collections that add up",
          body: "Every product carries its GST slab and offers, and every rupee your agents collect is recorded at the shop.",
          points: [
            "GST tax invoices, credit and debit notes, GSTR-1 export",
            "Cash, UPI, cheque or credit — settled agent by agent",
            "Khata with credit limits and statements for every shop",
          ],
        },
      ],
    },
    retail: {
      kick: "For your retailers",
      title: "Your retailers order in a minute — without calling you",
      sub: "No app store, no password. Retailers open a link, add it to the home screen and log in with an OTP.",
      items: [
        { icon: "cart", t: "Their own catalogue", d: "Prices, schemes and minimum order set by you, per shop." },
        { icon: "mic", t: "Order by text or voice", d: "Type or say the list — in Hindi or English — and check the cart." },
        { icon: "tag", t: "Offers applied for them", d: "Quantity offers and special prices worked out on the bill." },
        { icon: "wallet", t: "Pay online", d: "UPI links and QR codes, recorded against their khata." },
        { icon: "truck", t: "Track the delivery", d: "The agent's name and an ETA, right up to the shop door." },
        { icon: "star", t: "Complaints and ratings", d: "Raise an issue on an order and rate the delivery." },
      ],
    },
    statsKick: "By design",
    foot: {
      about: "Distribution management software for distributors, stockists and wholesalers — orders, stock, sales beats, GST billing, delivery and payments in one app, for the whole team.",
      chips: ["GST-ready billing", "English + हिंदी", "Laptop, tablet and phone"],
      badge: "Made in India, for Indian distribution",
      product: "Product",
      devices: "Every device",
      builtFor: "Built for",
      start: "Get started",
      contact: "Contact",
      call: "Call us",
      whatsapp: "WhatsApp us",
      email: "Email us",
      address: "VPD Vastus Ventures Pvt. Ltd., 2nd Floor, Property No. 44, Regal Building, Connaught Place, New Delhi — 110090",
      terms: "Terms of use",
      privacy: "Privacy policy",
      brandLine: "VBiz Pro is a product of VPD Vastus Ventures Private Limited.",
      rights: "All rights reserved.",
      designedBy: "Designed by",
    },
    suite: {
      kick: "Any screen",
      title: "One app on every device",
      sub: "The owner on a laptop, the office on a tablet, the field team on their phones — the same VBiz Pro, live on all of them. Nothing to install: open it in the browser or add it to the home screen.",
      live: "Live on every device",
      counter: "Counter tablet",
      devices: [
        { t: "Laptop and desktop", d: "The full dashboard, reports and billing" },
        { t: "Tablet", d: "Dispatch board at the godown or the counter" },
        { t: "Phone", d: "Beats, deliveries and orders on the road" },
      ],
    },
    grid: {
      kick: "Everything in one place",
      title: "Everything a distributor needs",
      sub: "One login for the owner, office, sales and delivery teams — and one link for every retailer.",
      items: [
        { icon: "bill", t: "GST invoicing", d: "Tax invoices, credit and debit notes, PDF and share links, GSTR-1 and Tally exports." },
        { icon: "box", t: "Inventory and batches", d: "Godowns, batches, expiry and stock moves you can audit." },
        { icon: "cart", t: "Purchase and GRN", d: "Purchase orders, goods received and supplier lead times." },
        { icon: "route", t: "Trips and routes", d: "Plan trips from the day's orders, load the van, close the day." },
        { icon: "clock", t: "Field attendance", d: "Duty on and off, check-ins and leave, with location." },
        { icon: "tag", t: "Schemes and offers", d: "Quantity offers, special prices and coupons, applied on the bill." },
        { icon: "shield", t: "Khata and credit control", d: "Credit limits, holds, cheques and a double-entry ledger." },
        { icon: "bank", t: "Payments and bank matching", d: "UPI links and QR, bank statement upload and auto-matching." },
        { icon: "chart", t: "Reports and daily summary", d: "Sales, churn, scheme results and route profit, plus an evening summary." },
        { icon: "chat", t: "Ask your business", d: "Ask in plain words — \"who didn't order this week?\" — and get the report." },
        { icon: "camera", t: "Photo checks and shelf audits", d: "Payment screenshots, delivery photos and shelf photos, checked." },
        { icon: "brand", t: "Your brand, your address", d: "Your name, colours, logo and web address on every screen." },
      ],
    },
    steps: { kick: "Go live", title: "Three steps to your first order" },
    cta: {
      title: "Ready to run your business on VBiz Pro?",
      sub: "Start a free trial with your own products, team and retailers.",
      primary: "Start free trial",
      secondary: "Sign in",
    },
    mock: {
      search: "Search orders, shops, products",
      today: "Today",
      ordersToday: "Orders today",
      collected: "Collected",
      outForDelivery: "Out for delivery",
      lowStock: "Low stock",
      recentOrders: "Recent orders",
      shop: "Shop",
      amount: "Amount",
      status: "Status",
      st: { placed: "Placed", packed: "Packed", onWay: "On the way", delivered: "Delivered" },
      dispatch: "Dispatch",
      planTrips: "Plan trips",
      tripsReady: "3 trips ready · 41 drops",
      beat: "Today's beat",
      checkIn: "Check in",
      nextShop: "Next shop",
      trip: "Trip 2 · Aminabad",
      dropsLeft: "drops left",
      collect: "Collect ₹4,133",
      cart: "Cart",
      placeOrder: "Place order",
      typeOrder: "Type or say your order…",
      offer: "Special price on 4 or more",
      menu: ["Dashboard", "Orders", "Dispatch", "Stock", "Retailers", "Team", "Billing", "Reports"],
    },
  },
  hi: {
    nav: { features: "फ़ीचर", problems: "समाधान", how: "कैसे काम करता है", faq: "सवाल" },
    hero: {
      eyebrow: "डिस्ट्रीब्यूशन मैनेजमेंट सॉफ़्टवेयर",
      title1: "अपना पूरा डिस्ट्रीब्यूशन बिज़नेस चलाइए",
      title2: "एक ही ऐप से",
      sub: "ऑर्डर, स्टॉक, सेल्स बीट, बिलिंग, डिलीवरी और पेमेंट — मालिक, ऑफ़िस, फ़ील्ड टीम और हर रिटेलर के लिए एक साथ जुड़े हुए।",
      cta1: "मुफ़्त ट्रायल शुरू करें",
      cta2: "देखें कैसे काम करता है",
      notes: ["मुफ़्त ट्रायल", "किसी भी फ़ोन पर", "हिंदी और अंग्रेज़ी"],
    },
    roles: [
      { key: "owner", label: "मालिक", caption: "पूरा बिज़नेस एक स्क्रीन पर", toasts: [["नया ऑर्डर", "Gupta General Store · ₹3,120"], ["शाम का सार", "पिछले शुक्रवार से 12% ज़्यादा बिक्री"]] },
      { key: "office", label: "ऑफ़िस", caption: "ऑर्डर, पैकिंग और डिस्पैच", toasts: [["ट्रिप तैयार", "3 ट्रिप · 41 ड्रॉप"], ["कम स्टॉक", "आटा 10 किलो · 14 बचे"]] },
      { key: "sales", label: "सेल्स एजेंट", caption: "आज की बीट, हर विज़िट", toasts: [["चेक-इन हुआ", "शर्मा किराना · 09:42"], ["ऑर्डर बुक", "₹4,133 · 14 आइटम"]] },
      { key: "delivery", label: "डिलीवरी एजेंट", caption: "ट्रिप, ड्रॉप और वसूली", toasts: [["डिलीवर हुआ", "फ़ोटो और साइन सेव"], ["नकद मिला", "₹4,133 · आज रात हिसाब"]] },
      { key: "retailer", label: "रिटेलर", caption: "एक लिंक से, एक मिनट में ऑर्डर", toasts: [["ऑफ़र लगा", "आपने ₹396 बचाए"], ["रास्ते में", "रवि · 12 मिनट दूर"]] },
    ],
    trust: {
      lead: "इनके डिस्ट्रीब्यूटर, स्टॉकिस्ट और होलसेलर के लिए बना",
      items: ["FMCG और किराना", "फ़ार्मा", "डेयरी और पेय", "हार्डवेयर और पेंट", "इलेक्ट्रिकल", "स्टेशनरी और किताबें"],
    },
    problems: {
      kick: "VBiz Pro क्यों",
      title: "पाँच समस्याएँ जो हम हल करते हैं",
      sub: "ज़्यादातर डिस्ट्रीब्यूटर फ़ोन कॉल, रजिस्टर और तीन अलग ऐप से काम चलाते हैं। देखिए जब सब एक ही ऐप में काम करें तो क्या बदलता है।",
      tabs: [
        {
          tab: "फ़ोन पर ऑर्डर",
          title: "ऑर्डर अब फ़ोन कॉल के भरोसे नहीं",
          body: "रिटेलर अपने फ़ोन पर एक लिंक से ऑर्डर करते हैं — या WhatsApp पर लिख देते हैं — और ऑर्डर कीमत के साथ ऑफ़िस पहुँच जाता है।",
          points: [
            "हर दुकान को अपना कैटलॉग, अपनी कीमतें और स्कीम दिखती हैं",
            "लिखकर या बोलकर किया ऑर्डर कार्ट में आ जाता है, बस जाँच लें",
            "ऑफ़र और GST बिल पर अपने-आप",
          ],
        },
        {
          tab: "स्टॉक",
          title: "स्टॉक जिस पर भरोसा हो",
          body: "ऑर्डर पैक होते ही स्टॉक घटता है और नया लॉट या वापसी आते ही बढ़ता है — आपको हमेशा पता रहता है क्या बेच सकते हैं।",
          points: [
            "बैच और एक्सपायरी, पुराना माल पहले",
            "हर सप्लायर के परचेज़ ऑर्डर और माल की प्राप्ति",
            "तेज़ बिकने वाला माल खत्म होने से पहले दोबारा मँगाने का सुझाव",
          ],
        },
        {
          tab: "फ़ील्ड टीम",
          title: "सेल्स टीम जो सच में दिखे",
          body: "हर सेल्स एजेंट को आज का रूट मिलता है। हर विज़िट लोकेशन के साथ दर्ज होती है और ऑर्डर वहीं बुक होता है।",
          points: [
            "इलाके के हिसाब से बीट, हर एजेंट के लिए",
            "लोकेशन के साथ चेक-इन, चेक-आउट और हाज़िरी",
            "टारगेट, विज़िट नोट और सुपरवाइज़र व्यू",
          ],
        },
        {
          tab: "डिलीवरी",
          title: "सबूत के साथ डिलीवरी",
          body: "दिन के ऑर्डर से ट्रिप बनते हैं। ऑफ़िस नक्शे पर हर एजेंट देखता है, और हर रिटेलर अपना ऑर्डर आते देखता है।",
          points: [
            "एक क्लिक में ट्रिप और ड्रॉप का क्रम",
            "ड्यूटी के दौरान एजेंट की लाइव लोकेशन",
            "दुकान पर फ़ोटो, साइन या डिलीवरी कोड",
          ],
        },
        {
          tab: "बिलिंग",
          title: "बिल और वसूली जो मिलान में रहें",
          body: "हर प्रोडक्ट का GST स्लैब और ऑफ़र तय है, और एजेंट जो भी पैसा लेते हैं वह दुकान पर ही दर्ज होता है।",
          points: [
            "GST टैक्स इनवॉइस, क्रेडिट और डेबिट नोट, GSTR-1 एक्सपोर्ट",
            "नकद, UPI, चेक या उधार — हर एजेंट का हिसाब अलग",
            "हर दुकान का खाता, उधार सीमा और स्टेटमेंट",
          ],
        },
      ],
    },
    retail: {
      kick: "आपके रिटेलरों के लिए",
      title: "रिटेलर एक मिनट में ऑर्डर करें — बिना आपको फ़ोन किए",
      sub: "न ऐप स्टोर, न पासवर्ड। रिटेलर लिंक खोलें, होम स्क्रीन पर लगाएँ और OTP से लॉगिन करें।",
      items: [
        { icon: "cart", t: "उनका अपना कैटलॉग", d: "कीमत, स्कीम और न्यूनतम ऑर्डर — हर दुकान के लिए आप तय करें।" },
        { icon: "mic", t: "लिखकर या बोलकर ऑर्डर", d: "हिंदी या अंग्रेज़ी में लिस्ट लिखें या बोलें, फिर कार्ट जाँचें।" },
        { icon: "tag", t: "ऑफ़र अपने-आप", d: "मात्रा पर ऑफ़र और खास कीमतें बिल पर लग जाती हैं।" },
        { icon: "wallet", t: "ऑनलाइन पेमेंट", d: "UPI लिंक और QR कोड, सीधे उनके खाते में दर्ज।" },
        { icon: "truck", t: "डिलीवरी ट्रैक करें", d: "एजेंट का नाम और पहुँचने का समय, दुकान के दरवाज़े तक।" },
        { icon: "star", t: "शिकायत और रेटिंग", d: "ऑर्डर पर शिकायत करें और डिलीवरी को रेट करें।" },
      ],
    },
    statsKick: "बनावट से ही",
    foot: {
      about: "डिस्ट्रीब्यूटर, स्टॉकिस्ट और होलसेलर के लिए डिस्ट्रीब्यूशन मैनेजमेंट सॉफ़्टवेयर — ऑर्डर, स्टॉक, सेल्स बीट, GST बिलिंग, डिलीवरी और पेमेंट, पूरी टीम के लिए एक ऐप में।",
      chips: ["GST वाली बिलिंग", "English + हिंदी", "लैपटॉप, टैबलेट और फ़ोन"],
      badge: "भारत में बना, भारतीय डिस्ट्रीब्यूशन के लिए",
      product: "प्रोडक्ट",
      devices: "हर डिवाइस",
      builtFor: "किनके लिए",
      start: "शुरू करें",
      contact: "संपर्क",
      call: "कॉल करें",
      whatsapp: "WhatsApp करें",
      email: "ईमेल करें",
      address: "VPD Vastus Ventures Pvt. Ltd., दूसरी मंज़िल, प्रॉपर्टी नं. 44, रीगल बिल्डिंग, कनॉट प्लेस, नई दिल्ली — 110090",
      terms: "उपयोग की शर्तें",
      privacy: "प्राइवेसी नीति",
      brandLine: "VBiz Pro, VPD Vastus Ventures Private Limited का एक प्रोडक्ट है।",
      rights: "सर्वाधिकार सुरक्षित।",
      designedBy: "डिज़ाइन",
    },
    suite: {
      kick: "हर स्क्रीन",
      title: "हर डिवाइस पर एक ही ऐप",
      sub: "मालिक लैपटॉप पर, ऑफ़िस टैबलेट पर, फ़ील्ड टीम फ़ोन पर — वही VBiz Pro, सब पर एक साथ लाइव। कुछ इंस्टॉल नहीं करना: ब्राउज़र में खोलें या होम स्क्रीन पर जोड़ें।",
      live: "हर डिवाइस पर लाइव",
      counter: "काउंटर टैबलेट",
      devices: [
        { t: "लैपटॉप और डेस्कटॉप", d: "पूरा डैशबोर्ड, रिपोर्ट और बिलिंग" },
        { t: "टैबलेट", d: "गोदाम या काउंटर पर डिस्पैच बोर्ड" },
        { t: "फ़ोन", d: "रास्ते में बीट, डिलीवरी और ऑर्डर" },
      ],
    },
    grid: {
      kick: "सब कुछ एक जगह",
      title: "डिस्ट्रीब्यूटर को जो चाहिए, सब",
      sub: "मालिक, ऑफ़िस, सेल्स और डिलीवरी टीम के लिए एक लॉगिन — और हर रिटेलर के लिए एक लिंक।",
      items: [
        { icon: "bill", t: "GST बिलिंग", d: "टैक्स इनवॉइस, क्रेडिट और डेबिट नोट, PDF और शेयर लिंक, GSTR-1 और Tally एक्सपोर्ट।" },
        { icon: "box", t: "इन्वेंटरी और बैच", d: "गोदाम, बैच, एक्सपायरी और हर स्टॉक मूवमेंट का हिसाब।" },
        { icon: "cart", t: "परचेज़ और GRN", d: "परचेज़ ऑर्डर, माल की प्राप्ति और सप्लायर का समय।" },
        { icon: "route", t: "ट्रिप और रूट", d: "दिन के ऑर्डर से ट्रिप बनाएँ, गाड़ी लोड करें, दिन बंद करें।" },
        { icon: "clock", t: "फ़ील्ड हाज़िरी", d: "ड्यूटी चालू-बंद, चेक-इन और छुट्टी, लोकेशन के साथ।" },
        { icon: "tag", t: "स्कीम और ऑफ़र", d: "मात्रा पर ऑफ़र, खास कीमतें और कूपन, बिल पर लागू।" },
        { icon: "shield", t: "खाता और उधार नियंत्रण", d: "उधार सीमा, होल्ड, चेक और डबल-एंट्री लेजर।" },
        { icon: "bank", t: "पेमेंट और बैंक मिलान", d: "UPI लिंक और QR, बैंक स्टेटमेंट अपलोड और अपने-आप मिलान।" },
        { icon: "chart", t: "रिपोर्ट और रोज़ का सार", d: "बिक्री, छूटे ग्राहक, स्कीम का असर और रूट का मुनाफ़ा, शाम का सार।" },
        { icon: "chat", t: "अपने बिज़नेस से पूछें", d: "सीधे शब्दों में पूछें — \"इस हफ़्ते किसने ऑर्डर नहीं किया?\" — और रिपोर्ट पाएँ।" },
        { icon: "camera", t: "फ़ोटो जाँच और शेल्फ़ ऑडिट", d: "पेमेंट स्क्रीनशॉट, डिलीवरी फ़ोटो और शेल्फ़ फ़ोटो की जाँच।" },
        { icon: "brand", t: "आपका ब्रांड, आपका पता", d: "हर स्क्रीन पर आपका नाम, रंग, लोगो और वेब पता।" },
      ],
    },
    steps: { kick: "शुरुआत", title: "पहले ऑर्डर तक तीन कदम" },
    cta: {
      title: "VBiz Pro पर अपना बिज़नेस चलाने के लिए तैयार?",
      sub: "अपने ही उत्पाद, टीम और रिटेलरों के साथ मुफ़्त ट्रायल शुरू करें।",
      primary: "मुफ़्त ट्रायल शुरू करें",
      secondary: "लॉगिन",
    },
    mock: {
      search: "ऑर्डर, दुकान, प्रोडक्ट खोजें",
      today: "आज",
      ordersToday: "आज के ऑर्डर",
      collected: "वसूली",
      outForDelivery: "डिलीवरी पर",
      lowStock: "कम स्टॉक",
      recentOrders: "हाल के ऑर्डर",
      shop: "दुकान",
      amount: "रकम",
      status: "स्थिति",
      st: { placed: "आया", packed: "पैक", onWay: "रास्ते में", delivered: "डिलीवर" },
      dispatch: "डिस्पैच",
      planTrips: "ट्रिप बनाएँ",
      tripsReady: "3 ट्रिप तैयार · 41 ड्रॉप",
      beat: "आज की बीट",
      checkIn: "चेक-इन",
      nextShop: "अगली दुकान",
      trip: "ट्रिप 2 · अमीनाबाद",
      dropsLeft: "ड्रॉप बाकी",
      collect: "₹4,133 लें",
      cart: "कार्ट",
      placeOrder: "ऑर्डर करें",
      typeOrder: "अपना ऑर्डर लिखें या बोलें…",
      offer: "4 या ज़्यादा पर खास दाम",
      menu: ["डैशबोर्ड", "ऑर्डर", "डिस्पैच", "स्टॉक", "रिटेलर", "टीम", "बिलिंग", "रिपोर्ट"],
    },
  },
};
