export type Product = {
  id: string;
  name: string;
  nameAr: string;
  brand: string;
  category: Category;
  price: number;
  rating: number; // 0-5
  emoji: string;
  description: string;
  descriptionAr: string;
  tags: string[];
  inStock: boolean;
};

export type Category =
  | "electronics"
  | "audio"
  | "wearables"
  | "computers"
  | "home"
  | "fashion"
  | "fitness";

export const CURRENCY = "$";

export const PRODUCTS: Product[] = [
  {
    id: "p-1001",
    name: "Aero Wireless Headphones",
    nameAr: "سماعات إيرو اللاسلكية",
    brand: "SonicWave",
    category: "audio",
    price: 129.99,
    rating: 4.6,
    emoji: "🎧",
    description: "Over-ear noise-cancelling headphones with 40h battery life.",
    descriptionAr: "سماعات تغطي الأذن مع عزل ضوضاء وبطارية 40 ساعة.",
    tags: ["headphones", "noise cancelling", "bluetooth", "music"],
    inStock: true,
  },
  {
    id: "p-1002",
    name: "Pulse Buds Pro",
    nameAr: "سماعات بَلس برو",
    brand: "SonicWave",
    category: "audio",
    price: 79.0,
    rating: 4.3,
    emoji: "🎵",
    description: "Compact true-wireless earbuds with active noise cancellation.",
    descriptionAr: "سماعات أذن لاسلكية صغيرة مع عزل ضوضاء فعّال.",
    tags: ["earbuds", "wireless", "noise cancelling", "music"],
    inStock: true,
  },
  {
    id: "p-1003",
    name: "Lumin 14 Laptop",
    nameAr: "لابتوب لومين 14",
    brand: "Nova",
    category: "computers",
    price: 999.0,
    rating: 4.7,
    emoji: "💻",
    description: '14" ultrabook, 16GB RAM, 512GB SSD, 18h battery.',
    descriptionAr: "لابتوب خفيف 14 إنش، رام 16 جيجا، تخزين 512 جيجا، بطارية 18 ساعة.",
    tags: ["laptop", "ultrabook", "work", "computer", "student"],
    inStock: true,
  },
  {
    id: "p-1004",
    name: "Lumin 14 Pro Laptop",
    nameAr: "لابتوب لومين 14 برو",
    brand: "Nova",
    category: "computers",
    price: 1499.0,
    rating: 4.8,
    emoji: "💻",
    description: '14" pro laptop, 32GB RAM, 1TB SSD, dedicated GPU.',
    descriptionAr: "لابتوب احترافي 14 إنش، رام 32 جيجا، تخزين 1 تيرا، كرت شاشة مخصص.",
    tags: ["laptop", "pro", "gaming", "work", "computer"],
    inStock: true,
  },
  {
    id: "p-1005",
    name: "Strato Smartphone",
    nameAr: "هاتف ستراتو",
    brand: "Nova",
    category: "electronics",
    price: 699.0,
    rating: 4.5,
    emoji: "📱",
    description: '6.5" OLED smartphone, triple camera, 256GB storage.',
    descriptionAr: "هاتف بشاشة 6.5 إنش OLED، ثلاث كاميرات، تخزين 256 جيجا.",
    tags: ["phone", "smartphone", "camera", "android"],
    inStock: true,
  },
  {
    id: "p-1006",
    name: "Strato Lite Smartphone",
    nameAr: "هاتف ستراتو لايت",
    brand: "Nova",
    category: "electronics",
    price: 349.0,
    rating: 4.1,
    emoji: "📱",
    description: "Budget-friendly smartphone with great battery life.",
    descriptionAr: "هاتف اقتصادي مع بطارية ممتازة.",
    tags: ["phone", "smartphone", "budget", "cheap", "android"],
    inStock: true,
  },
  {
    id: "p-1007",
    name: "Tempo Smartwatch",
    nameAr: "ساعة تيمبو الذكية",
    brand: "FitX",
    category: "wearables",
    price: 199.0,
    rating: 4.4,
    emoji: "⌚",
    description: "GPS smartwatch with heart-rate and sleep tracking.",
    descriptionAr: "ساعة ذكية بنظام GPS وتتبّع نبض القلب والنوم.",
    tags: ["watch", "smartwatch", "fitness", "health", "gps"],
    inStock: true,
  },
  {
    id: "p-1008",
    name: "Tempo Band",
    nameAr: "سوار تيمبو",
    brand: "FitX",
    category: "fitness",
    price: 59.0,
    rating: 4.0,
    emoji: "📿",
    description: "Lightweight fitness band with step and calorie tracking.",
    descriptionAr: "سوار رياضي خفيف لتتبّع الخطوات والسعرات.",
    tags: ["band", "fitness", "tracker", "steps", "cheap"],
    inStock: true,
  },
  {
    id: "p-1009",
    name: "Brew Master Coffee Machine",
    nameAr: "ماكينة قهوة برو ماستر",
    brand: "HomeKraft",
    category: "home",
    price: 149.0,
    rating: 4.5,
    emoji: "☕",
    description: "Programmable espresso machine with milk frother.",
    descriptionAr: "ماكينة إسبريسو قابلة للبرمجة مع خفّاقة حليب.",
    tags: ["coffee", "espresso", "kitchen", "home"],
    inStock: true,
  },
  {
    id: "p-1010",
    name: "AirPure Mini Purifier",
    nameAr: "منقّي هواء إير بيور ميني",
    brand: "HomeKraft",
    category: "home",
    price: 89.0,
    rating: 4.2,
    emoji: "🌬️",
    description: "Compact HEPA air purifier for rooms up to 30m².",
    descriptionAr: "منقّي هواء HEPA صغير لغرف حتى 30 متر مربع.",
    tags: ["air", "purifier", "home", "hepa"],
    inStock: true,
  },
  {
    id: "p-1011",
    name: "Glide Running Shoes",
    nameAr: "حذاء جلايد للجري",
    brand: "Stride",
    category: "fashion",
    price: 119.0,
    rating: 4.6,
    emoji: "👟",
    description: "Lightweight cushioned running shoes for daily training.",
    descriptionAr: "حذاء جري خفيف ومبطّن للتمرين اليومي.",
    tags: ["shoes", "running", "sport", "fashion", "fitness"],
    inStock: true,
  },
  {
    id: "p-1012",
    name: "Trail Backpack 30L",
    nameAr: "حقيبة ظهر تريل 30 لتر",
    brand: "Stride",
    category: "fashion",
    price: 69.0,
    rating: 4.3,
    emoji: "🎒",
    description: "Water-resistant 30L backpack with laptop compartment.",
    descriptionAr: "حقيبة ظهر 30 لتر مقاومة للماء مع جيب للابتوب.",
    tags: ["backpack", "travel", "laptop", "fashion"],
    inStock: true,
  },
  {
    id: "p-1013",
    name: "Vista 4K Monitor",
    nameAr: "شاشة فيستا 4K",
    brand: "Nova",
    category: "computers",
    price: 329.0,
    rating: 4.5,
    emoji: "🖥️",
    description: '27" 4K IPS monitor with USB-C and 99% sRGB.',
    descriptionAr: "شاشة 27 إنش بدقة 4K ومنفذ USB-C ودقّة ألوان عالية.",
    tags: ["monitor", "4k", "computer", "work", "display"],
    inStock: true,
  },
  {
    id: "p-1014",
    name: "Click Mechanical Keyboard",
    nameAr: "كيبورد كليك الميكانيكي",
    brand: "Nova",
    category: "computers",
    price: 89.0,
    rating: 4.4,
    emoji: "⌨️",
    description: "Compact mechanical keyboard with hot-swap switches.",
    descriptionAr: "كيبورد ميكانيكي صغير مع مفاتيح قابلة للتبديل.",
    tags: ["keyboard", "mechanical", "computer", "gaming"],
    inStock: true,
  },
  {
    id: "p-1015",
    name: "Boom Portable Speaker",
    nameAr: "مكبّر صوت بووم المحمول",
    brand: "SonicWave",
    category: "audio",
    price: 49.0,
    rating: 4.2,
    emoji: "🔊",
    description: "Waterproof portable Bluetooth speaker, 12h playtime.",
    descriptionAr: "مكبّر صوت بلوتوث محمول ومقاوم للماء، 12 ساعة تشغيل.",
    tags: ["speaker", "bluetooth", "portable", "music", "cheap"],
    inStock: true,
  },
  {
    id: "p-1016",
    name: "Flux Wireless Charger",
    nameAr: "شاحن فلكس اللاسلكي",
    brand: "Nova",
    category: "electronics",
    price: 29.0,
    rating: 4.1,
    emoji: "🔋",
    description: "15W fast wireless charging pad for phones and earbuds.",
    descriptionAr: "قاعدة شحن لاسلكي سريع 15 واط للهواتف والسماعات.",
    tags: ["charger", "wireless", "accessory", "cheap"],
    inStock: true,
  },
];

export function getProductById(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

export type SearchParams = {
  query?: string;
  category?: Category;
  maxPrice?: number;
  minPrice?: number;
  minRating?: number;
  brand?: string;
  sortBy?: "price_asc" | "price_desc" | "rating_desc";
  limit?: number;
};

export function searchProducts(params: SearchParams): Product[] {
  const q = params.query?.trim().toLowerCase();

  let results = PRODUCTS.filter((p) => {
    if (params.category && p.category !== params.category) return false;
    if (params.brand && p.brand.toLowerCase() !== params.brand.toLowerCase())
      return false;
    if (typeof params.maxPrice === "number" && p.price > params.maxPrice)
      return false;
    if (typeof params.minPrice === "number" && p.price < params.minPrice)
      return false;
    if (typeof params.minRating === "number" && p.rating < params.minRating)
      return false;

    if (q) {
      const haystack = [
        p.name,
        p.nameAr,
        p.brand,
        p.category,
        p.description,
        p.descriptionAr,
        ...p.tags,
      ]
        .join(" ")
        .toLowerCase();
      // match if any whitespace-separated token of the query appears
      const tokens = q.split(/\s+/).filter(Boolean);
      const matched = tokens.some((t) => haystack.includes(t));
      if (!matched) return false;
    }
    return true;
  });

  switch (params.sortBy) {
    case "price_asc":
      results = results.sort((a, b) => a.price - b.price);
      break;
    case "price_desc":
      results = results.sort((a, b) => b.price - a.price);
      break;
    case "rating_desc":
      results = results.sort((a, b) => b.rating - a.rating);
      break;
    default:
      // relevance-ish: highest rating first
      results = results.sort((a, b) => b.rating - a.rating);
  }

  const limit = params.limit && params.limit > 0 ? params.limit : 6;
  return results.slice(0, limit);
}

export const CATEGORIES: Category[] = [
  "electronics",
  "audio",
  "wearables",
  "computers",
  "home",
  "fashion",
  "fitness",
];
