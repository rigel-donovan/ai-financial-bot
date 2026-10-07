import { ParsedIntent } from '@/types';
import { normalizeText, normalizeGentle } from './text-normalizer';
import { ConversationContext } from './conversation';

// Default keyword-to-category mapping
export const DEFAULT_CATEGORY_KEYWORDS: Record<string, string[]> = {
  Food: [
    'makan', 'kopi', 'coffee', 'cafe', 'kafe', 'jajan', 'lunch', 'dinner', 'sarapan',
    'gofood', 'grabfood', 'shopeefood', 'resto', 'restoran', 'beras', 'cemilan',
    'snack', 'minum', 'bakso', 'mie', 'nasi', 'ayam', 'warteg', 'padang', 'soto',
    'sate', 'martabak', 'boba', 'roti', 'seblak', 'cilok', 'bebek', 'ikan'
  ],
  Transport: [
    'transport', 'bensin', 'ojek', 'tol', 'grab', 'gojek', 'parkir', 'krl', 'mrt', 'busway',
    'tiket', 'pertamax', 'pertalite', 'solar', 'angkot', 'taksi', 'kereta',
    'motor', 'mobil', 'servis', 'service', 'tambal', 'cuci motor', 'cuci mobil',
    'bus', 'kereta api'
  ],
  Shopping: [
    'belanja', 'baju', 'shopee', 'tokped', 'tokopedia', 'celana', 'sepatu',
    'beli', 'lazada', 'blibli', 'minimarket', 'indomaret', 'alfamart', 'supermarket',
    'pasar', 'sayur', 'popok', 'sabun', 'skincare'
  ],
  Bills: [
    'listrik', 'pln', 'pdam', 'air', 'wifi', 'indihome', 'biznet', 'telkom',
    'pulsa', 'kuota', 'pbb', 'bpjs', 'iuran', 'tagihan', 'sewa', 'kontrakan',
    'kost', 'kos', 'kosan', 'cicilan'
  ],
  Entertainment: [
    'netflix', 'spotify', 'youtube', 'bioskop', 'nonton', 'game', 'steam',
    'playstation', 'topup', 'konser', 'liburan', 'hotel'
  ],
  Health: [
    'obat', 'apotek', 'dokter', 'rs', 'rumah sakit', 'vitamin', 'klinik',
    'rontgen', 'rapid', 'tes lab'
  ],
  Education: [
    'buku', 'kursus', 'kelas', 'kuliah', 'sekolah', 'udemy', 'seminar', 'webinar'
  ]
};

/**
 * Parse Indonesian number formats like:
 * - 25000, 25.000, 25,000
 * - 25k, 25.5k
 * - 1.5jt, 2jt, 1.5m
 */
export function parseAmount(raw: string): number | null {
  if (!raw) return null;
  let cleaned = raw.trim().toLowerCase();

  // Strip leading currency symbols: "rp", "rp.", "idr"
  cleaned = cleaned.replace(/^(?:rp\.?|idr)\s*/i, '').trim();

  // match "1.5jt", "2jt", "1,5jt", "1.5 juta", "2 jt"
  const jtMatch = cleaned.match(/^([\d.,]+)\s*(?:jt|juta|m)$/);
  if (jtMatch) {
    const rawNum = jtMatch[1].replace(',', '.');
    const val = parseFloat(rawNum);
    return isNaN(val) ? null : Math.round(val * 1_000_000);
  }

  // match "500k", "25.5k", "150rb", "150 ribu", "150 k", "150 rb"
  const kMatch = cleaned.match(/^([\d.,]+)\s*(?:k|rb|ribu)$/);
  if (kMatch) {
    const rawNum = kMatch[1].replace(',', '.');
    const val = parseFloat(rawNum);
    return isNaN(val) ? null : Math.round(val * 1_000);
  }

  // match standard digits with dot or comma as thousand separator
  // e.g. "25.000", "25,000", "25000"
  let numStr = cleaned.replace(/[^\d.,]/g, '');
  if (numStr.includes('.') && !numStr.includes(',')) {
    numStr = numStr.replace(/\./g, '');
  } else if (numStr.includes(',') && !numStr.includes('.')) {
    numStr = numStr.replace(/,/g, '');
  } else if (numStr.includes('.') && numStr.includes(',')) {
    numStr = numStr.split(',')[0].replace(/\./g, '');
  }

  const result = parseInt(numStr, 10);
  return isNaN(result) || result <= 0 ? null : result;
}

/**
 * Detect category from text and optional custom keywords mapping
 */
export function detectCategory(
  text: string,
  explicitCategory?: string,
  customKeywords?: Record<string, string[]>
): string {
  if (explicitCategory) {
    return capitalize(explicitCategory);
  }

  const keywordMap = customKeywords || DEFAULT_CATEGORY_KEYWORDS;
  const lowerText = text.toLowerCase();

  for (const [category, keywords] of Object.entries(keywordMap)) {
    for (const kw of keywords) {
      const regex = new RegExp(`\\b${kw.toLowerCase()}\\b`, 'i');
      if (regex.test(lowerText) || lowerText.includes(kw.toLowerCase())) {
        return category;
      }
    }
  }

  return 'Lainnya';
}

function capitalize(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const MONTH_NAMES: Record<string, number> = {
  januari: 0, jan: 0,
  februari: 1, feb: 1,
  maret: 2, mar: 2,
  april: 3, apr: 3,
  mei: 4, may: 4,
  juni: 5, jun: 5,
  juli: 6, jul: 6,
  agustus: 7, ags: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  oktober: 9, okt: 9, oct: 9,
  november: 10, nov: 10,
  desember: 11, des: 11, dec: 11
};

export interface QueryDateResult {
  period: 'day' | 'week' | 'month' | 'year';
  targetDate?: string; // YYYY-MM-DD
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  displayDate?: string;
}

/**
 * Parse Indonesian date query expressions:
 * - "27 september 2026", "27 sep 2026", "tanggal 27 september"
 * - "27/09/2026", "27-09-2026", "27/09"
 * - "tanggal 27", "tgl 25"
 * - "kemarin lusa", "kemarin", "hari ini"
 * - "minggu ini", "minggu lalu", "bulan ini", "bulan lalu"
 */
export function parseQueryDate(text: string, referenceDate?: Date): QueryDateResult {
  const now = referenceDate || new Date();
  const lower = (text || '').toLowerCase().trim();

  const pad = (n: number) => String(n).padStart(2, '0');
  const formatDisplay = (d: Date) =>
    d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const parseMonthDayYear = (day: number, monthName: string, year?: number) => {
    const month = MONTH_NAMES[monthName.toLowerCase()];
    if (month === undefined) return null;
    const resolvedYear = year ?? now.getFullYear();
    return new Date(resolvedYear, month, day);
  };

  const rangeMatch = lower.match(/(?:\b(?:tgl|tanggal)\s+)?(\d{1,2})\s*(?:-|–|—|sampai|sd)\s*(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?/i);
  if (rangeMatch) {
    const startDay = parseInt(rangeMatch[1], 10);
    const endDay = parseInt(rangeMatch[2], 10);
    const monthName = rangeMatch[3].toLowerCase();
    const year = rangeMatch[4] ? parseInt(rangeMatch[4], 10) : now.getFullYear();
    const monthIndex = MONTH_NAMES[monthName];
    if (startDay >= 1 && startDay <= 31 && endDay >= 1 && endDay <= 31 && monthIndex !== undefined) {
      let start = new Date(year, monthIndex, startDay);
      let end = new Date(year, monthIndex, endDay);
      if (end < start) {
        const tmp = start;
        start = end;
        end = tmp;
      }
      return {
        period: 'day',
        startDate: toDateStr(start),
        endDate: toDateStr(end),
        displayDate: `${formatDisplay(start)} - ${formatDisplay(end)}`
      };
    }
  }

  const rangeMonthNameMatch = lower.match(/(?:\b(?:tgl|tanggal)\s+)?(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?\s*(?:-|–|—|sampai|sd)\s*(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?/i);
  if (rangeMonthNameMatch) {
    const startDay = parseInt(rangeMonthNameMatch[1], 10);
    const startMonth = rangeMonthNameMatch[2].toLowerCase();
    const startYear = rangeMonthNameMatch[3] ? parseInt(rangeMonthNameMatch[3], 10) : now.getFullYear();
    const endDay = parseInt(rangeMonthNameMatch[4], 10);
    const endMonth = rangeMonthNameMatch[5].toLowerCase();
    const endYear = rangeMonthNameMatch[6] ? parseInt(rangeMonthNameMatch[6], 10) : now.getFullYear();
    const startParsed = parseMonthDayYear(startDay, startMonth, startYear);
    const endParsed = parseMonthDayYear(endDay, endMonth, endYear);
    if (startParsed && endParsed) {
      const start = startParsed < endParsed ? startParsed : endParsed;
      const end = startParsed < endParsed ? endParsed : startParsed;
      return {
        period: 'day',
        startDate: toDateStr(start),
        endDate: toDateStr(end),
        displayDate: `${formatDisplay(start)} - ${formatDisplay(end)}`
      };
    }
  }

  // 1. "kemarin lusa"
  if (/\bkemarin\s+lusa\b/i.test(lower)) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2);
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return {
      targetDate: dateStr,
      displayDate: `Kemarin Lusa (${formatDisplay(d)})`,
      period: 'day'
    };
  }

  // 2. "kemarin"
  if (/\bkemarin\b/i.test(lower)) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return {
      targetDate: dateStr,
      displayDate: `Kemarin (${formatDisplay(d)})`,
      period: 'day'
    };
  }

  // 3. "hari ini" / "today"
  if (/\b(?:hari\s+ini|today)\b/i.test(lower)) {
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    return {
      targetDate: dateStr,
      displayDate: `Hari Ini (${formatDisplay(now)})`,
      period: 'day'
    };
  }

  // 4. "DD/MM/YYYY" or "DD-MM-YYYY" or "DD/MM" or "DD-MM"
  const slashDashMatch = lower.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (slashDashMatch) {
    const day = parseInt(slashDashMatch[1], 10);
    const month = parseInt(slashDashMatch[2], 10) - 1;
    let year = slashDashMatch[3] ? parseInt(slashDashMatch[3], 10) : now.getFullYear();
    if (year < 100) year += 2000;

    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
      const d = new Date(year, month, day);
      const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`;
      return {
        targetDate: dateStr,
        displayDate: formatDisplay(d),
        period: 'day'
      };
    }
  }

  // 5. "27 september 2026" / "tanggal 27 sep 2026" / "27 september"
  const wordDateMatch = lower.match(/(?:\b(?:tgl|tanggal)\s+)?(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?\b/i);
  if (wordDateMatch) {
    const day = parseInt(wordDateMatch[1], 10);
    const monthStr = wordDateMatch[2].toLowerCase();
    const yearStr = wordDateMatch[3];

    if (day >= 1 && day <= 31 && MONTH_NAMES[monthStr] !== undefined) {
      const month = MONTH_NAMES[monthStr];
      const year = yearStr ? parseInt(yearStr, 10) : now.getFullYear();
      const d = new Date(year, month, day);
      const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`;
      return {
        targetDate: dateStr,
        displayDate: formatDisplay(d),
        period: 'day'
      };
    }
  }

  // 6. "tanggal 27" / "tgl 27"
  const dayOnlyMatch = lower.match(/\b(?:tgl|tanggal)\s*(\d{1,2})\b/i);
  if (dayOnlyMatch) {
    const day = parseInt(dayOnlyMatch[1], 10);
    if (day >= 1 && day <= 31) {
      const year = now.getFullYear();
      const month = now.getMonth();
      const d = new Date(year, month, day);
      const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`;
      return {
        targetDate: dateStr,
        displayDate: formatDisplay(d),
        period: 'day'
      };
    }
  }

  // 7. "minggu ini" / "minggu lalu"
  if (/\bminggu\s+lalu\b/i.test(lower)) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay() || 7) - 6, 0, 0, 0);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999);
    return {
      period: 'week',
      startDate: toDateStr(start),
      endDate: toDateStr(end),
      displayDate: `Minggu Lalu (${start.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} - ${end.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })})`
    };
  }
  if (/\b(?:minggu(?:\s+ini)?|week)\b/i.test(lower)) {
    const day = now.getDay() || 7;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), start.getDate() + 6, 23, 59, 59, 999);
    return {
      period: 'week',
      startDate: toDateStr(start),
      endDate: toDateStr(end),
      displayDate: `Minggu Ini (${start.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} - ${end.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })})`
    };
  }

  const monthOnlyMatch = lower.match(/\b(?:bulan\s+)?(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|jan|feb|mar|apr|may|jun|jul|ags|aug|sep|sept|okt|oct|nov|des|dec)(?:\s+(\d{4}))?\b/i);
  if (monthOnlyMatch) {
    const monthName = monthOnlyMatch[1].toLowerCase();
    const monthIndex = MONTH_NAMES[monthName];
    const year = monthOnlyMatch[2] ? parseInt(monthOnlyMatch[2], 10) : now.getFullYear();
    if (monthIndex !== undefined) {
      const start = new Date(year, monthIndex, 1, 0, 0, 0);
      const end = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
      return {
        period: 'month',
        startDate: toDateStr(start),
        endDate: toDateStr(end),
        displayDate: `${start.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}`
      };
    }
  }

  const yearOnlyMatch = lower.match(/\b(?:tahun|thn|year)\s*(\d{4})\b/i);
  if (yearOnlyMatch) {
    const year = parseInt(yearOnlyMatch[1], 10);
    const start = new Date(year, 0, 1, 0, 0, 0);
    const end = new Date(year, 11, 31, 23, 59, 59, 999);
    return {
      period: 'year',
      startDate: toDateStr(start),
      endDate: toDateStr(end),
      displayDate: `${year}`
    };
  }

  // 8. "bulan ini" / "bulan lalu"
  if (/\bbulan\s+lalu\b/i.test(lower)) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return {
      period: 'month',
      startDate: toDateStr(start),
      endDate: toDateStr(end),
      displayDate: `Bulan Lalu (${start.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })})`
    };
  }
  if (/\b(?:bulan(?:\s+ini)?|month)\b/i.test(lower)) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return {
      period: 'month',
      startDate: toDateStr(start),
      endDate: toDateStr(end),
      displayDate: `Bulan Ini (${start.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })})`
    };
  }

  return {
    period: 'day',
    displayDate: `Hari Ini (${formatDisplay(now)})`
  };
}

/**
 * Extract transaction amount safely, ignoring 4-digit years in date contexts
 */
export function extractTransactionAmount(text: string): { amount: number; raw: string } | null {
  const AMOUNT_REGEX = /(?:(?:rp\.?|idr)\s*)?(?:\d+(?:[.,]\d+)?\s*(?:jt|juta|m|k|rb|ribu)\b|\d{1,3}(?:[.,]\d{3})+(?!\d)|\b\d{3,9}\b)/gi;
  const matches = Array.from(text.matchAll(AMOUNT_REGEX));
  if (!matches || matches.length === 0) return null;

  for (const match of matches) {
    const raw = match[0];
    const index = match.index ?? 0;

    // Guard: Abaikan jika angka ini segera diikuti satuan kuantitas (seperti "100 pcs", "50 cup")
    // kecuali angka tersebut memiliki prefix atau suffix mata uang (rp, idr, k, rb, jt)
    const textAfter = text.slice(index + raw.length, index + raw.length + 15).trim().toLowerCase();
    const isQtyUnit = /^(?:pcs|buah|bh|biji|unit|porsi|cup|gelas|botol|btl|pack|pak|bungkus|bks|lembar|lbr|kotak|ktk|dus|lusin|set|pasang|slice|potong|ptg|ekor|ekr|mangkok|mgk|item|pieces?|qty|roll|sachet|sct|kg|gram|gr|ons|liter|ltr|x\b)/i.test(textAfter);
    if (isQtyUnit && !/[k|rb|ribu|jt|juta|m|rp|idr]/i.test(raw)) {
      continue;
    }

    const num = parseInt(raw.replace(/[^\d]/g, ''), 10);
    if (num >= 2020 && num <= 2035 && !/[k|rb|ribu|jt|juta|m|rp|idr]/i.test(raw)) {
      const textBefore = text.slice(Math.max(0, index - 25), index).toLowerCase();
      const isDateYear =
        /(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|jan|feb|mar|apr|may|jun|jul|ags|aug|sep|sept|okt|oct|nov|des|dec|tahun|thn|\d{1,2}[/-])\s*$/i.test(textBefore.trim());
      if (isDateYear) {
        continue;
      }
    }

    const parsed = parseAmount(raw);
    if (parsed && parsed > 0) {
      return { amount: parsed, raw };
    }
  }

  return null;
}

/** Prefer an amount explicitly introduced by words such as "sebesar" or "total". */
function extractExplicitAmount(text: string): { amount: number; raw: string } | null {
  const match = text.match(
    /\b(?:sebesar|senilai|seharga|sejumlah|nominal(?:nya)?|total(?:nya)?|harga(?:nya)?)\s+((?:rp\.?\s*)?(?:\d+(?:[.,]\d+)?\s*(?:jt|juta|m|k|rb|ribu)\b|\d{1,3}(?:[.,]\d{3})+(?!\d)|\d{3,9}\b))/i
  );
  if (!match) return null;

  const amount = parseAmount(match[1]);
  return amount ? { amount, raw: match[1] } : null;
}

/**
 * Istilah analisis/statistik yang TIDAK bisa dijawab oleh rekap biasa.
 *
 * "rekap bulan ini" dijawab handleSummary, tetapi "rata-rata pengeluaran bulan
 * ini" atau "bandingkan minggu ini sama minggu lalu" memerlukan perhitungan
 * khusus, sehingga ditangani sebagai AI_ADVICE yang menerima data transaksi.
 */
const ANALYSIS_PATTERNS: RegExp[] = [
  /\brata[\s-]?rata\b/i,
  /\bpaling\s+(?:besar|mahal|banyak|berat|tinggi|ramai)\b/i,
  /\b(?:terbesar|termahal|terbanyak|terberat|tertinggi)\b/i,
  /\bbandingkan\b|\bbandingin\b|\bperbandingan\b|\bcompare\b|\bcomparison\b|\bversus\b|\bvs\b/i,
  /\bkategori\s+(?:apa|yg|yang)\b|\bkategori\s+terbanyak\b|\bkategori\s+terbesar\b/i,
  /\bdistribusi\b|\bsebaran\b|\bproporsi\b|\bpersentase\b/i,
  /\bkebanyakan\b/i
];

/** Kata kerja query yang menandakan user meminta laporan, bukan analisis. */
const PLAIN_REPORT_KEYWORDS =
  /\b(?:rekap|ringkasan|laporan|total|saldo|statistik|recap|summary)\b/i;

/**
 * Deteksi permintaan analisis.
 *
 * Syaratnya ada dua:
 *  1. ada istilah analisis (rata-rata, terbesar, bandingkan, ...)
 *  2. ada subjek keuangan (pengeluaran, transaksi, ...) agar kata "statistik"
 *     dalam kalimat lain tidak ikut terseret.
 */
export function isAnalysisRequest(text: string): boolean {
  const lower = (text || '').toLowerCase();
  if (!lower) return false;
  if (!ANALYSIS_PATTERNS.some((re) => re.test(lower))) return false;
  return hasFinancialSubject(lower);
}

function hasFinancialSubject(lower: string): boolean {
  return /\b(?:pengeluaran|pemasukan|transaksi|keuangan|uang|duit|dana|biaya|belanja|pendapatan|gaji|expense|income|bills?|tagihan)\b/i.test(lower);
}

/**
 * Kata ganti & penunjuk yang merujuk ke percakapan sebelumnya.
 *
 * Tanpa konteks, "yang tadi", "terus bensin?", atau "berapa?" akan gagal
 * dipahami karena tidak ada subjeknya.
 */
const BACKREFERENCE_WORDS =
  /^(?:yang\s+(?:tadi|itu|ini|kemarin|terakhir|sebelumnya|baru)|terus\s+(?:gitu|ya|beli|beliin)|l lanjut(?:an)?|lanjutan|selanjutnya|terus|abis\s+itu|setelah\s+itu|kemudian|berikutnya|selain\s+itu|itunya|same\s+itu)\b/i;

/** Kata tanya singkat yang bergantung penuh pada konteks sebelumnya. */
const ELLIPTICAL_QUESTION =
  /^(?:berapa(?:\s+dong)?|nanya\s+dong|sisa(?:nya)?\s+apa|sisa\s+apa|yang\s+mana|yg\s+mana|terus|next|lanjut|lanjutan|berikutnya|di\s*mana|dimana)\b/i;

/**
 * Penunjuk tanggal/periode eksplisit dalam pesan.
 *
 * Dipakai untuk mematikan aturan konteks "yang tadi": bila user menulis
 * "hapus transaksi 27 september 2026", perintahnya sudah lengkap dan tidak
 * boleh ditimpa dengan transaksi terakhir yang dikenang.
 */
const EXPLICIT_DATE_REF =
  /(?:\b(?:tgl|tanggal)\b|\b(?:kemarin(?:\s+lusa)?|hari\s+ini|today|minggu\s+(?:ini|lalu)|bulan\s+(?:ini|lalu)|tahun\s+(?:ini|lalu))\b|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{1,2}\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|jan|feb|mar|apr|may|jun|jul|ags|aug|sep|sept|okt|oct|nov|des|dec)(?:\s+\d{4})?)/i;

/**
 * Coba memcascade perintah lanjutan memakai konteks percakapan.
 *
 * Mengembalikan null bila pesan ini bukan perintah lanjutan, sehingga caller
 * lanjut ke parsing normal.
 */
function resolveFollowUp(
  text: string,
  lower: string,
  context?: ConversationContext
): ParsedIntent | null {
  if (!context) return null;

  // 1. Pesan singkat berisi nominal saja sementara ada transaksi yang belum
  //    lengkap → lengkapi transaksi tersebut ("25rb" setelah "beli kopi").
  if (context.pending && extractTransactionAmount(text)) {
    const pending = context.pending;
    const amount = extractTransactionAmount(text)?.amount;
    if (!amount) return null;
    return {
      intent: pending.intent,
      amount,
      note: pending.note,
      category: pending.category,
      rawMessage: text
    };
  }

  // 2. Pertanyaan elipsis yang merujuk periode terakhir:
  //    "yang kemarin?", "periode tadi berapa?"
  const isElliptical = ELLIPTICAL_QUESTION.test(lower) || BACKREFERENCE_WORDS.test(lower);
  if (isElliptical && context.lastPeriod) {
    const period = context.lastPeriod;

    // Pertanyaan analisis tetap boleh ride along dari periode sebelumnya.
    if (isAnalysisRequest(text)) {
      return { intent: 'AI_ADVICE', rawMessage: text };
    }

    const wantsProfit = /\b(?:laba|profit|untung|keuntungan|bersih|selisih|net)\b/i.test(lower);
    if (wantsProfit) {
      return {
        intent: 'SUMMARY_PROFIT',
        period: period.period,
        targetDate: period.targetDate,
        startDate: period.startDate,
        endDate: period.endDate,
        displayDate: period.displayDate,
        rawMessage: text
      };
    }

    // Tanpa penyebut income/expense eksplisit, pakai intent terakhir.
    const mentionsIncome = /\b(?:pemasukan|income|uang\s+masuk|pendapatan|gaji|masuk)\b/i.test(lower);
    const mentionsExpense = /\b(?:pengeluaran|biaya|expense|uang\s+keluar|keluar|belanja)\b/i.test(lower);

    let intent: ParsedIntent['intent'];
    if (mentionsIncome && mentionsExpense) intent = 'LIST_ALL';
    else if (mentionsIncome) intent = 'LIST_INCOMES';
    else if (mentionsExpense) intent = 'LIST_EXPENSES';
    else if (context.lastIntent === 'LIST_EXPENSES') intent = 'LIST_EXPENSES';
    else if (context.lastIntent === 'LIST_INCOMES') intent = 'LIST_INCOMES';
    else if (context.lastIntent === 'LIST_ALL') intent = 'LIST_ALL';
    else intent = period.period === 'week' ? 'SUMMARY_WEEK' : period.period === 'year' ? 'SUMMARY_MONTH' : period.period === 'month' ? 'SUMMARY_MONTH' : 'SUMMARY_DAY';

    return {
      intent,
      period: period.period,
      targetDate: period.targetDate,
      startDate: period.startDate,
      endDate: period.endDate,
      displayDate: period.displayDate,
      rawMessage: text
    };
  }

  // 3. Kategori yang disebutkan saat sebelumnya difilter:
  //    "yang food aja?", "kategori transport?"
  if (context.lastCategory && /^(?:yang\s+)?[a-z]{3,20}\s*(?:aja|saja)?$/i.test(lower)) {
    const detected = detectCategory(lower, undefined);
    if (detected !== 'Lainnya' && /\b(?:yang|kategori)\b/i.test(lower)) {
      const wantsProfit = /\b(?:laba|profit|untung|bersih)\b/i.test(lower);
      const wantsList = /\b(?:list|daftar|rincian|lihat|tampil|cek|yuh)\b/i.test(lower);
      const period = context.lastPeriod;

      if (wantsList) {
        return {
          intent: 'LIST_EXPENSES',
          period: period?.period,
          targetDate: period?.targetDate,
          startDate: period?.startDate,
          endDate: period?.endDate,
          displayDate: period?.displayDate,
          category: detected,
          rawMessage: text
        };
      }

      return {
        intent: wantsProfit ? 'SUMMARY_PROFIT' : 'SUMMARY_MONTH',
        period: period?.period,
        targetDate: period?.targetDate,
        startDate: period?.startDate,
        endDate: period?.endDate,
        displayDate: period?.displayDate,
        category: detected,
        rawMessage: text
      };
    }
  }

  // 4. "hapus yang tadi" / "hapus itu" → hapus transaksi terakhir yang dikenang.
  //    Dilewati bila pesan sudah menyebut tanggal/periode sendiri, mis.
  //    "hapus transaksi 27 september 2026" harus mengikuti tanggalnya,
  //    bukan transaksi terakhir yang dikenang.
  if (/\b(?:hapus|batal|batalin|undo|remove)\b/i.test(lower) &&
      context.lastTransaction &&
      !EXPLICIT_DATE_REF.test(lower)) {
    return {
      intent: 'DELETE_LAST',
      amount: context.lastTransaction.amount,
      note: context.lastTransaction.note,
      targetDate: context.lastTransaction.date,
      rawMessage: text
    };
  }

  // 5. "yang tadi bukan 25k tapi 30k" → edit transaksi terakhir.
  if (/\b(?:tadi|terakhir|itu|sebelumnya)\b/i.test(lower) &&
      /\b(?:salah|edit|ubah|ganti|koreksi|bukan|tapi|harusnya|harusnya)\b/i.test(lower)) {
    const amount = extractTransactionAmount(text)?.amount;
    return {
      intent: 'EDIT_LAST',
      amount,
      targetDate: context.lastTransaction?.date,
      rawMessage: text
    };
  }

  // 6. "berapa?" / "totalnya?" setelah mencatat transaksi → ringkas.
  if (ELLIPTICAL_QUESTION.test(lower) && context.lastIntent &&
      (context.lastIntent === 'RECORD_EXPENSE' || context.lastIntent === 'RECORD_INCOME')) {
    return { intent: 'SUMMARY_DAY', period: 'day', rawMessage: text };
  }

  return null;
}

/**
 * Deteksi perintah lanjutan yang memakai konteks. Dipakai juga oleh AI NLU
 * sebagai sinyal apakah perlu mempertimbangkan percakapan sebelumnya.
 */
export function hasContextualReference(text: string): boolean {
  const lower = (text || '').toLowerCase();
  return ELLIPTICAL_QUESTION.test(lower) || BACKREFERENCE_WORDS.test(lower);
}

/**
 * Main intent parser
 */
export function extractDateContextFromText(text: string): { targetDate?: string; startDate?: string; endDate?: string; displayDate?: string } | null {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  const hasDateContext = /(?:\b(?:tgl|tanggal)\b|\b(?:kemarin(?:\s+lusa)?|hari\s+ini|today)\b|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{1,2}\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|jan|feb|mar|apr|may|jun|jul|ags|aug|sep|sept|okt|oct|nov|des|dec)(?:\s+\d{4})?|\d{1,2}\s*(?:-|–|—|sampai|sd)\s*\d{1,2}\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|jan|feb|mar|apr|may|jun|jul|ags|aug|sep|sept|okt|oct|nov|des|dec))/i.test(lower);
  if (!hasDateContext) return null;

  const dateInfo = parseQueryDate(trimmed);
  if (dateInfo.startDate && dateInfo.endDate) {
    return {
      startDate: dateInfo.startDate,
      endDate: dateInfo.endDate,
      displayDate: dateInfo.displayDate
    };
  }
  return dateInfo.targetDate ? {
    targetDate: dateInfo.targetDate,
    displayDate: dateInfo.displayDate
  } : null;
}

/**
 * Extract quantity (qty) from text like "30 pcs", "5 buah", "2 porsi", "3x", "10 cup", etc.
 * Returns { qty, raw } or null if no quantity found.
 */
function extractQty(text: string): { qty: number; raw: string } | null {
  // Pattern: <number> <unit> — e.g. "30 pcs", "5 buah", "2 porsi", "10 cup", "3 botol"
  const qtyMatch = text.match(
    /(?:\b(?:sebanyak|sejumlah)\s+)?\b(\d+)\s*(?:pcs|buah|bh|biji|unit|porsi|cup|gelas|botol|btl|pack|pak|bungkus|bks|lembar|lbr|kotak|ktk|dus|lusin|set|pasang|slice|potong|ptg|ekor|ekr|mangkok|mgk|item|pieces?|qty|roll|sachet|sct|kg|gram|gr|ons|liter|ltr)\b/i
  );
  if (qtyMatch) {
    const qty = parseInt(qtyMatch[1], 10);
    if (qty > 0 && qty <= 99999) {
      return { qty, raw: qtyMatch[0] };
    }
  }

  // Pattern: <number>x — e.g. "3x", "5x" (but not amounts like "3x lipat")
  const xMatch = text.match(/(?:\b(?:sebanyak|sejumlah)\s+)?\b(\d+)\s*[xX]\s*(?!lipat|ganda)/i);
  if (xMatch) {
    const qty = parseInt(xMatch[1], 10);
    if (qty > 0 && qty <= 99999) {
      return { qty, raw: xMatch[0] };
    }
  }

  return null;
}

function cleanTransactionNote(note: string): string {
  const datePhrase = /\b(?:(?:buat|untuk|pada|tanggal|tgl|di)\s+)*(?:kemarin(?:\s+lusa)?|hari\s+ini|today|\d{1,2}\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|jan|feb|mar|apr|may|jun|jul|ags|aug|sep|sept|okt|oct|nov|des|dec)(?:\s+\d{4})?|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b/gi;
  return note
    .replace(datePhrase, ' ')
    // Hapus kata penghubung sebelum atau sesudah nominal: "sebesar", "senilai", "seharga", "dengan harga", "totalnya", "harganya", "sejumlah", "total", "nominal"
    .replace(/\b(?:sebesar|senilai|seharga|sejumlah|dengan\s+(?:harga|total|nominal)|harga(?:nya)?|total(?:nya)?|nominal(?:nya)?|(?:dengan|dgn)\s+harga)\b/gi, ' ')
    .replace(/\b(?:buat|untuk|pada|tanggal|tgl|di)\s*$/i, '')
    .replace(/^(?:buat|untuk|pada|di)\s+/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, '')
    .trim();
}

export function parseMessage(
  rawText: string,
  customCategoryMap?: Record<string, string[]>,
  context?: ConversationContext
): ParsedIntent {
  // Pesan asli tetap disimpan untuk audit, tapi parsing memakai teks yang sudah
  // dinormalisasi (slang, typo, angka terverbal, kata pengisi).
  const originalText = (rawText || '').trim();
  const normalized = normalizeText(originalText);
  // Bila normalisasi membuat pesan kosong (mis. hanya emoji/filler), pakai
  // teks asli agar intent lain tidak hilang tanpa sengaja.
  const trimmed = normalized || originalText;
  const lower = trimmed.toLowerCase();

  const followUp = resolveFollowUp(trimmed, lower, context);
  if (followUp) return followUp;

  // Strip polite prefixes: "tolong buatin", "buatin", "minta", "tolong", etc.
  const cleanPrefix = lower
    .replace(/^(?:tolong\s+|mohon\s+|coba\s+)?(?:buatin\s+|buatkan\s+|tampilin\s+|tampilkan\s+|minta\s+|kasih\s+|kasi\s+|lihat\s+|cek\s+)?/i, '')
    .trim();

  const dateContext = extractDateContextFromText(trimmed);

  // 1. Menu / Sapaan / Greeting
  if (/^(?:menu|halo|hi|hai|hello|helo|hey|hei|yo|p|mulai|start|fitur|woi|bos|boss|bang|kak|gan|sis|mas|mba|mbak|assalamualaikum|assalamu'?alaikum|selamat\s+(?:pagi|siang|sore|malam)|hola|oi|bosku|gais|guys)$/i.test(lower)) {
    return {
      intent: 'MENU',
      rawMessage: originalText
    };
  }

  // 1b. Ucapan terima kasih / acknowledgment → tampilkan menu
  if (/^(?:makasih|makasi|terima\s*kasih|thanks?|thank\s*you|thx|tq|ok(?:e|ay|eh|ey)?|sip|siap|mantap|noted|baik|good|bagus|keren|aman|nuhun|hatur\s+nuhun|iya|yoi|yoy|betul|bener|oke\s+(?:deh|sip|makasih|thanks)|nice|great|got\s*it|understood|paham|mengerti|ngerti)$/i.test(lower)) {
    return {
      intent: 'MENU',
      rawMessage: originalText
    };
  }

  if (
    /^(?:bantuan|help|panduan|cara\s+pakai|cara\s+pake|cara\s+kerja|cara\s*nya|caranya|tutorial|guide|how|tolong\s+bantu|bantu(?:\s+dong)?|gimana\s+(?:caranya|sih|nih|cara(?:nya)?)|bisa\s+(?:apa\s+(?:aja|saja)|ngapain(?:\s+aja)?)|fitur\s+(?:apa\s+(?:aja|saja))|cara\s+penggunaan|apa\s+aja\s+(?:fitur|bisa)|bot\s+ini\s+(?:bisa\s+apa|apa|ngapain)|kamu\s+(?:bisa\s+apa|siapa)|perintah|commands?)$/i.test(lower)
  ) {
    return {
      intent: 'HELP',
      rawMessage: originalText
    };
  }

  if (
    /(?:download|unduh|export|ekspor|ambil|kirim|minta|buat(?:in|kan)?|save|simpan|buka|lihat|akses|open|link)\s+(?:spreadsheet|excel|data|file|csv|sheets?|rekap|laporan|catatan|transaksi)(?:\s+(?:spreadsheet|excel|data|file|csv|sheets?|ku|saya|gw|gue))?/i.test(lower) ||
    /(?:spreadsheet|excel|sheets?)\s+(?:download|unduh|export|ekspor|ambil|kirim|minta|buka|lihat|akses|link)/i.test(lower) ||
    /^(?:sheet|sheets|spreadsheet|excel|google\s+sheets)$/i.test(lower.trim()) ||
    /^(?:download|unduh|export|ekspor)\s*(?:spreadsheet|excel|data|file|csv|sheets?)?\s*$/i.test(lower.trim())
  ) {
    return {
      intent: 'DOWNLOAD_SPREADSHEET',
      rawMessage: originalText
    };
  }

  // 2. AI Advisor / Saran / Analisa
  if (
    /^(?:saran|analisa|analisis|insight|rekomendasi|evaluasi|gimana\s+keuangan(?:ku)?|tips\s+hemat|konsultasi|cek\s+keuangan|advice|financial\s+advice|gimana\s+(?:nih|dong)\s+keuangan|keuangan(?:ku)?\s+gimana|review\s+keuangan|audit|analisa\s+keuangan)(?:\s+.*)?$/i.test(lower)
  ) {
    return {
      intent: 'AI_ADVICE',
      rawMessage: originalText
    };
  }

  // 3. Query / List / Rekap / Ringkasan / Laporan (Batas luas & mengenali tanggal/periode)
  const isRecurringWord = /\b(?:rutin|langganan|subscription|subs)(?:ku)?\b/i.test(lower);
  const hasIncomeExpression = /\b(?:pemasukan|income|uang\s+masuk|pendapatan|gaji)\b/i.test(lower);
  const hasExpenseExpression = /\b(?:pengeluaran|biaya|expense|uang\s+keluar|belanja|penyusutan|potongan)\b/i.test(lower);
  const hasIncomeMinusExpense = /\b(?:pemasukan|income|uang\s+masuk|pendapatan|gaji)\b\s*-\s*\b(?:pengeluaran|biaya|expense|uang\s+keluar|belanja)\b/i.test(lower);
  const hasExpenseMinusIncome = /\b(?:pengeluaran|biaya|expense|uang\s+keluar|belanja)\b\s*-\s*\b(?:pemasukan|income|uang\s+masuk|pendapatan|gaji)\b/i.test(lower);
  const isNetCalculationRequest =
    (hasIncomeExpression && hasExpenseExpression && /\b(?:kurang|dikurangi|minus|selisih|net(?:to)?|bersih|beda)\b/i.test(lower)) ||
    hasIncomeMinusExpense ||
    hasExpenseMinusIncome ||
    /\b(?:berapa|hitung|total|jumlah|akumulasi)\b.{0,40}\b(?:pemasukan|income|pendapatan).{0,40}\b(?:pengeluaran|biaya|expense)\b/i.test(lower);
  const hasFinancialPeriod = /\b(?:hari(?:\s+ini)?|kemarin|minggu(?:\s+ini|\s+lalu)?|bulan(?:\s+ini|\s+lalu)?|tahun|januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|today|week|month|year)\b/i.test(lower);
  const isQueryOrReport =
    !isRecurringWord && (
      /^(?:list|daftar|rincian|tampilkan|tampilin|lihat|cek|berapa|laporan|rekap|recap|ringkasan|riwayat|history|summary|report|stats|statistik|total|saldo|catatan|data|transaksi)\b/i.test(cleanPrefix) ||
      /^(?:list|daftar|rincian|tampilkan|tampilin|lihat|cek|berapa|laporan|rekap|recap|ringkasan|riwayat|history|summary|report|stats|statistik|total|saldo)\b/i.test(lower) ||
      /\b(?:habis berapa|sisa saldo|saldo sekarang|pengeluaran tanggal|pemasukan tanggal)\b/i.test(lower) ||
      /^(?:pengeluaran|biaya|pemasukan|expenses?|incomes?|pendapatan|belanja)\s*(?:hari(?:\s+ini)?|today|minggu(?:\s+ini)?|week|bulan(?:\s+ini)?|month|kemarin)?(?:\s+(?:list|daftar|rincian|semua))?$/i.test(lower) ||
      /\b(?:laba|profit|keuntungan|untung|saldo\s+bersih|margin|net(?:to)?)\b/i.test(lower) ||
      isNetCalculationRequest ||
      /\b(?:uang(?:ku|\s+(?:saya|gw|gue|gua|aku))?|duit(?:ku)?|dana(?:ku)?)\s*(?:berapa|sisa|tersisa|masih|ada|tinggal)/i.test(lower) ||
      /\b(?:sisa|masih\s+(?:ada|punya)|tinggal)\s*(?:berapa|uang|duit|dana)/i.test(lower) ||
      /\b(?:berapa\s+(?:sisa(?:nya)?|uang|duit|total|semua)|total(?:nya)?\s+(?:berapa|hari|minggu|bulan))/i.test(lower) ||
      /\b(?:catatan\s+(?:keuangan|transaksi)|data\s+(?:keuangan|transaksi)|ada\s+(?:transaksi|catatan)\s+apa)/i.test(lower) ||
      /\b(?:cek(?:in)?|check)\s+(?:uang|duit|saldo|dana|keuangan|transaksi|pengeluaran|pemasukan)/i.test(lower) ||
      /\b(?:habis|abis)\s+(?:berapa|banyak|total)/i.test(lower) ||
      ((hasIncomeExpression || hasExpenseExpression) && hasFinancialPeriod && /\b(?:total|jumlah|berapa|akumulasi|rekap|laporan|ringkasan|catatan|riwayat|tampilkan|lihat|cek)\b/i.test(lower))
    );

  if (isQueryOrReport) {
    const dateInfo = parseQueryDate(trimmed);

    const hasIncomeWord =
      hasIncomeExpression ||
      (/\bmasuk\b/i.test(lower) && !/\b(?:pengeluaran|biaya|keluar|penyusutan)\b/i.test(lower));

    const hasExpenseWord =
      hasExpenseExpression ||
      (/\bkeluar\b/i.test(lower) && !/\b(?:pemasukan|income|masuk)\b/i.test(lower));

    const hasProfitWord = isNetCalculationRequest || /\b(?:laba|profit|keuntungan|untung|saldo\s+bersih|bersih)\b/i.test(lower);
    const categoryMatch = lower.match(/\b(?:kategori|kat)\s+([a-z0-9\s\-_]+?)(?:\s+(?:pada|di|untuk|dari|hari|minggu|bulan|tahun|ini|lalu)|$)/i);
    const categoryHint = categoryMatch ? detectCategory(categoryMatch[1], undefined, customCategoryMap) : undefined;

    if (hasProfitWord) {
      return {
        intent: 'SUMMARY_PROFIT',
        period: dateInfo.period,
        targetDate: dateInfo.targetDate,
        startDate: dateInfo.startDate,
        endDate: dateInfo.endDate,
        displayDate: dateInfo.displayDate,
        category: categoryHint,
        rawMessage: originalText
      };
    }

    // 3a. Gabungan Pemasukan & Pengeluaran ("list pemasukan dan pengeluaran", "semua transaksi", dsb)
    if (hasIncomeWord && hasExpenseWord) {
      return {
        intent: 'LIST_ALL',
        period: dateInfo.period,
        targetDate: dateInfo.targetDate,
        startDate: dateInfo.startDate,
        endDate: dateInfo.endDate,
        displayDate: dateInfo.displayDate,
        rawMessage: originalText
      };
    }

    if (/\b(?:semua\s+transaksi|daftar\s+transaksi|list\s+transaksi|semua)\b/i.test(lower) && !hasIncomeWord && !hasExpenseWord) {
      return {
        intent: 'LIST_ALL',
        period: dateInfo.period,
        targetDate: dateInfo.targetDate,
        startDate: dateInfo.startDate,
        endDate: dateInfo.endDate,
        displayDate: dateInfo.displayDate,
        rawMessage: originalText
      };
    }

    // 3b. Khusus Pemasukan
    // Contoh: "list pemasukan tanggal 27 september 2026", "daftar pemasukan kemarin", "rincian uang masuk"
    if (hasIncomeWord && !hasExpenseWord) {
      return {
        intent: 'LIST_INCOMES',
        period: dateInfo.period,
        targetDate: dateInfo.targetDate,
        startDate: dateInfo.startDate,
        endDate: dateInfo.endDate,
        displayDate: dateInfo.displayDate,
        rawMessage: originalText
      };
    }

    // 3c. Khusus Pengeluaran
    // Contoh: "list pengeluaran hari ini", "daftar pengeluaran 27 sep 2026", "rincian biaya kemarin"
    if (hasExpenseWord && !hasIncomeWord) {
      return {
        intent: 'LIST_EXPENSES',
        period: dateInfo.period,
        targetDate: dateInfo.targetDate,
        startDate: dateInfo.startDate,
        endDate: dateInfo.endDate,
        displayDate: dateInfo.displayDate,
        category: categoryHint,
        rawMessage: originalText
      };
    }

    // 3c. Rekap / Ringkasan / Laporan Umum / Semua Transaksi
    // Contoh: "buatin list tanggal 27 september 2026", "rekap kemarin", "laporan bulan ini", "saldo sekarang"
    if (dateInfo.period === 'week') {
      return {
        intent: 'SUMMARY_WEEK',
        period: 'week',
        targetDate: dateInfo.targetDate,
        startDate: dateInfo.startDate,
        endDate: dateInfo.endDate,
        displayDate: dateInfo.displayDate,
        rawMessage: originalText
      };
    }
    if (dateInfo.period === 'month') {
      return {
        intent: 'SUMMARY_MONTH',
        period: 'month',
        targetDate: dateInfo.targetDate,
        startDate: dateInfo.startDate,
        endDate: dateInfo.endDate,
        displayDate: dateInfo.displayDate,
        rawMessage: originalText
      };
    }
    if (dateInfo.period === 'year') {
      return {
        intent: 'SUMMARY_MONTH',
        period: 'year',
        targetDate: dateInfo.targetDate,
        startDate: dateInfo.startDate,
        endDate: dateInfo.endDate,
        displayDate: dateInfo.displayDate,
        rawMessage: originalText
      };
    }

    return {
      intent: 'SUMMARY_DAY',
      period: 'day',
      targetDate: dateInfo.targetDate,
      startDate: dateInfo.startDate,
      endDate: dateInfo.endDate,
      displayDate: dateInfo.displayDate,
      rawMessage: originalText
    };
  }

  // 4. Hapus Terakhir / Undo / Batal
  // Mendukung: "hapus terakhir", "batalin transaksi tadi", "ga jadi", "gausah", "cancel aja", dll.
  if (!isRecurringWord) {
    const isDeleteWord =
      /^(?:hapus|batal|batalin|cancel|undo|delete|ralat|tolong\s+hapus|remove)\b/i.test(trimmed) ||
      /\b(?:hapus|batal|batalin|cancel|undo)\s+(?:transaksi|catatan|pengeluaran|pemasukan|struk|yang tadi|tadi|sebelumnya|aja|saja|dong|deh)\b/i.test(lower) ||
      /^(?:ga\s*jadi|gak?\s*jadi|nggak?\s*jadi|ngga\s*jadi|tidak\s*jadi|gajadi|gakjadi|gausah|ga\s*usah|gak?\s*usah|nggak?\s*usah|udah\s+(?:ga|gak|nggak|ngga)\s+jadi)(?:\s|$)/i.test(lower) ||
      /\b(?:batalin|cancel|hapus|remove)\s+(?:aja|saja|dong|deh|ya)\b/i.test(lower);

    if (isDeleteWord) {
      const extractedAmount = extractTransactionAmount(trimmed);
      const deleteAmount = extractedAmount?.amount;

      let cleanNote = trimmed
        .replace(/^(?:tolong\s+)?(?:hapus|batal|batalin|cancel|undo|delete|ralat)\s+/i, '')
        .replace(/\b(?:dari struk|struk tadi|yang tadi|tadi|sebelumnya|terakhir|transaksi|catatan|pengeluaran|pemasukan)\b/gi, '')
        .trim();
      if (extractedAmount) {
        cleanNote = cleanNote.replace(extractedAmount.raw, '').replace(/\s+/g, ' ').trim();
      }
      cleanNote = cleanNote
        .replace(/\b(?:tgl|tanggal)\s*\d{1,2}\b/gi, '')
        .replace(/\b\d{1,2}\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|jan|feb|mar|apr|may|jun|jul|ags|aug|sep|sept|okt|oct|nov|des|dec)(?:\s+\d{4})?\b/gi, '')
        .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, '')
        .replace(/\b(?:kemarin(?:\s+lusa)?|hari\s+ini|today)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (/^(?:undo|cancel|hapus|batal|ga\s*jadi|gak?\s*jadi|nggak?\s*jadi|gajadi|gakjadi|gausah|ga\s*usah|aja|saja|dong|deh|ya|batalin|remove)$/i.test(cleanNote)) {
        cleanNote = '';
      }

      return {
        intent: 'DELETE_LAST',
        amount: deleteAmount,
        note: cleanNote || undefined,
        targetDate: dateContext?.targetDate,
        displayDate: dateContext?.displayDate,
        rawMessage: originalText
      };
    }
  }

  // 5. Edit Terakhir / Ubah / Ganti / Koreksi
  // Mendukung: "edit terakhir 30000", "edit jadi 35k", "ganti jadi 35rb", "edit bensin jadi 40k", "salah harusnya 35rb"
  const isEditWord =
    /^(?:edit|ubah|ganti|koreksi|ralat|revisi)\b/i.test(trimmed) ||
    /^(?:salah|bukan)\s+.*(?:harusnya|tapi|jadinya)\s+/i.test(lower);

  if (isEditWord) {
    const AMOUNT_REGEX = /(?:(?:rp\.?|idr)\s*)?(?:\d+(?:[.,]\d+)?\s*(?:jt|juta|m|k|rb|ribu)\b|\d{1,3}(?:[.,]\d{3})+(?!\d)|\b\d{4,9}\b)/i;

    // Pola A: "edit [target] jadi [pengganti]"
    const jadiMatch = trimmed.match(/^(?:edit|ubah|ganti|koreksi|ralat|revisi)(?:\s+(.+?))?\s+(?:jadi|ke|menjadi)\s+(.+)$/i);
    if (jadiMatch) {
      const targetPart = (jadiMatch[1] || '').trim();
      const replacementPart = (jadiMatch[2] || '').trim();

      const newDateInfo = extractDateContextFromText(replacementPart);
      const newDate = newDateInfo?.targetDate;
      const replacementContent = newDate
        ? replacementPart.replace(/(?:\b(?:ke|pada)\s+)?(?:\b(?:tgl|tanggal)\s+)?(?:\d{1,2}\s+[a-z]+(?:\s+\d{4})?|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\b(?:kemarin(?:\s+lusa)?|hari\s+ini|today)\b)/i, '').trim()
        : replacementPart;
      const amtMatch = replacementContent.match(AMOUNT_REGEX);
      const amount = amtMatch ? parseAmount(amtMatch[0]) || undefined : undefined;

      const categoryRequested = /\b(?:kategori|category)\b/i.test(targetPart) || /^\s*(?:kategori|category)\b/i.test(replacementContent);
      const explicitCategory = replacementContent.match(/\b(?:kategori|category)\s*(?:menjadi|jadi|ke|adalah)?\s*#?([\p{L}\d_-]+)/iu);
      const noteClause = replacementContent.match(/\b(?:catatan|keterangan|note)\s*(?:menjadi|jadi|ke|adalah)?\s*(.+)$/i);
      const replacementIsCategoryOnly = /^\s*(?:kategori|category)\s*(?:menjadi|jadi|ke|adalah)?\s*#[\p{L}\d_-]+\s*$/iu.test(replacementContent);
      const categoryText = replacementContent.split(/\s+(?:dan\s+)?(?:catatan|keterangan|note)\b/i)[0];
      const newCategory = explicitCategory?.[1] || (categoryRequested && !amtMatch ? categoryText.replace(/^\s*(?:kategori|category)\s*(?:menjadi|jadi|ke|adalah)?\s*/i, '').replace(/^#/, '').trim() : undefined);

      let newNote = replacementContent;
      if (amtMatch) {
        newNote = replacementContent.replace(amtMatch[0], '').replace(/\s+/g, ' ').trim();
      }
      newNote = newNote
        .replace(/^(?:beli|membeli|order|pesan|bayar|catat(?:kan)?)\s+/i, '')
        .replace(/\b(?:sebesar|senilai|seharga|totalnya|nominalnya)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (newDate && !amtMatch && !noteClause) {
        newNote = '';
      }
      if (noteClause) {
        newNote = noteClause[1]
          .replace(/^\s*(?:menjadi|jadi|ke|adalah)\s+/i, '')
          .replace(/\s+(?:dan\s+)?(?:kategori|category)\b.*$/i, '')
          .replace(AMOUNT_REGEX, '')
          .replace(/\s+/g, ' ')
          .trim();
      }
      const remainderWithoutCategory = newNote
        .replace(/\b(?:kategori|category)\s*(?:menjadi|jadi|ke|adalah)?\s*#?[\p{L}\d_-]+/iu, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (replacementIsCategoryOnly || (categoryRequested && newCategory && !amtMatch && !explicitCategory) || (newCategory && !noteClause && !remainderWithoutCategory)) {
        newNote = '';
      }

      const targetQuery = targetPart
        .replace(AMOUNT_REGEX, '')
        .replace(/\b(?:kategori|category|pengeluaran|pemasukan|terakhir|transaksi|nominal|catatan|keterangan|yang tadi|tadi|beli|membeli|bayar|tolong|dong|hari ini|today|kemarin|sebelumnya|barusan)\b/gi, '')
        .replace(/\b(?:tgl|tanggal)?\s*\d{1,2}\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|jan|feb|mar|apr|may|jun|jul|ags|aug|sep|sept|okt|oct|nov|des|dec)(?:\s+\d{4})?\b/gi, '')
        .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, '')
        .replace(/\b\d{4}\b/g, '')
        .replace(/[+,:;]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const dateInfo = extractDateContextFromText(targetPart) || (newDate ? undefined : dateContext);
      return {
        intent: 'EDIT_LAST',
        amount,
        note: newNote || undefined,
        category: newCategory,
        name: targetQuery || undefined,
        targetDate: dateInfo?.targetDate,
        newDate,
        startDate: dateInfo?.startDate,
        endDate: dateInfo?.endDate,
        displayDate: dateInfo?.displayDate,
        rawMessage: originalText
      };
    }

    // Pola B: "salah ... harusnya/tapi <pengganti>"
    const harusnyaMatch = trimmed.match(/(?:harusnya|tapi|jadinya)\s+(.+)$/i);
    if (harusnyaMatch) {
      const replacement = harusnyaMatch[1].trim();
      const amtMatch = replacement.match(AMOUNT_REGEX);
      const amount = amtMatch ? parseAmount(amtMatch[0]) || undefined : undefined;
      let newNote = replacement;
      if (amtMatch) {
        newNote = replacement.replace(amtMatch[0], '').replace(/\s+/g, ' ').trim();
      }
      return {
        intent: 'EDIT_LAST',
        amount,
        note: newNote || undefined,
        rawMessage: originalText
      };
    }

    // Pola C: "edit [terakhir] [nominal/keterangan]" (cth: "edit 35k", "edit terakhir 30000", "koreksi 35rb")
    const directMatch = trimmed.match(/^(?:edit|ubah|ganti|koreksi|ralat|revisi)(?:\s+terakhir)?(?:\s+nominal)?\s+(.+)$/i);
    if (directMatch) {
      const rest = directMatch[1].trim();
      const amtMatch = rest.match(AMOUNT_REGEX);
      const amount = amtMatch ? parseAmount(amtMatch[0]) || undefined : undefined;
      let newNote = rest;
      if (amtMatch) {
        newNote = rest.replace(amtMatch[0], '').replace(/\s+/g, ' ').trim();
      }
      return {
        intent: 'EDIT_LAST',
        amount,
        note: newNote || undefined,
        targetDate: dateContext?.targetDate,
        displayDate: dateContext?.displayDate,
        rawMessage: originalText
      };
    }

    return {
      intent: 'EDIT_LAST',
      targetDate: dateContext?.targetDate,
      displayDate: dateContext?.displayDate,
      rawMessage: originalText
    };
  }

  // 6. Pengeluaran Rutin & Langganan: List
  // Mendukung: "list langganan", "daftar langganan", "cek langganan", "langganan apa aja", "langganan aktif", "tolong cek langganan", "buatin list langganan", dsb.
  const isListRecurring =
    /\b(?:list|daftar|cek|rincian|lihat|tampilkan|tampilin|semua)\s+(?:pengeluaran\s+)?(?:rutin|langganan|subscription|subs|tagihan\s+rutin)(?:ku)?\b/i.test(lower) ||
    /\b(?:rutin|langganan|subscription|subs)(?:ku)?\s+(?:list|daftar|cek|rincian|apa\s+saja|apa\s+aja|aktif)\b/i.test(lower) ||
    /^(?:langganan|rutin)(?:ku)?(?:\s+(?:saya|gue|gw|ku|apa\s+aja|apa\s+saja))?$/i.test(cleanPrefix);

  if (isListRecurring) {
    return {
      intent: 'LIST_RECURRING',
      rawMessage: originalText
    };
  }

  // 7. Pengeluaran Rutin & Langganan: Hapus / Stop / Batal / Nonaktif
  // Mendukung: "stop langganan netflix", "hapus langganan spotify", "berhenti langganan youtube", "batal langganan icloud", "hapus rutin wifi"
  const delRecurringMatch =
    trimmed.match(/^(?:hapus|batal|batalin|nonaktif|nonaktifkan|stop|berhenti|cancel|delete)\s+(?:pengeluaran\s+)?(?:rutin|langganan|subscription|subs|tagihan\s+rutin)\s+(.+)$/i) ||
    trimmed.match(/^(?:stop|berhenti)\s+(?:langganan|rutin)\s+(.+)$/i);
  if (delRecurringMatch) {
    const name = delRecurringMatch[1].trim();
    return {
      intent: 'DELETE_RECURRING',
      name,
      rawMessage: originalText
    };
  }

  // 8. Pengeluaran Rutin & Langganan: Panduan / Bantuan
  // Mendukung: "cara langganan", "bantuan langganan", "panduan langganan", "info langganan", "rutin help"
  const isHelpRecurring =
    /^(?:(?:cara\s+|bantuan\s+|panduan\s+|info\s+)?(?:tambah\s+)?(?:pengeluaran\s+)?(?:rutin|langganan|subscription|subs)|(?:rutin|langganan|subscription|subs)\s+(?:cara|bantuan|panduan|info))$/i.test(cleanPrefix) ||
    /^(?:bantuan\s+langganan|cara\s+langganan|panduan\s+langganan|langganan\s+help|info\s+langganan|cara\s+rutin|bantuan\s+rutin)$/i.test(lower);
  if (isHelpRecurring) {
    return {
      intent: 'HELP_RECURRING',
      rawMessage: originalText
    };
  }

  // 9. Pengeluaran Rutin & Langganan: Tambah Rutin / Langganan (Fleksibel)
  // Contoh:
  // - langganan netflix 186k tgl 5
  // - langganan spotify 55rb tiap tgl 25
  // - tambah langganan wifi indihome 350k tgl 20
  // - tambah rutin 150000 netflix tgl 5
  // - rutin gym 150k tiap bulan tgl 1
  // - catat langganan icloud 45k tiap bulan tgl 10
  const recurringPrefixMatch = trimmed.match(
    /^(?:tambah\s+(?:pengeluaran\s+)?(?:rutin|langganan|subscription)|(?:rutin|langganan|subscription)\s+tambah|pengeluaran\s+rutin|catat\s+langganan|pasang\s+langganan|langganan|rutin)\s+(.+)$/i
  );
  if (recurringPrefixMatch) {
    let body = recurringPrefixMatch[1].trim();

    // Extract hashtag category if any
    const hashtagMatch = body.match(/#(\w+)/);
    const hashtagCat = hashtagMatch ? hashtagMatch[1] : undefined;
    body = body.replace(/#\w+/g, '').trim();

    // Strip recurrent frequency words: "tiap bulan", "setiap bulan", "per bulan", "perbulan"
    body = body.replace(/\b(?:tiap|setiap|per)\s*bulan\b/gi, '').trim();
    body = body.replace(/\b(?:perbulan|bulanan)\b/gi, '').trim();

    // Extract due date: "tgl 5", "tanggal 20", "tiap tgl 5", "setiap tanggal 10"
    const dateMatch = body.match(/(?:\b(?:tiap|setiap)\s+)?(?:tgl|tanggal)\s*(\d{1,2})\b/i);
    if (dateMatch) {
      const dueDate = parseInt(dateMatch[1], 10);
      if (dueDate >= 1 && dueDate <= 31) {
        body = body.replace(dateMatch[0], '').trim();

        // Extract amount token
        const amountRegex = /(?:rp\.?\s*)?(?:\d+(?:[.,]\d+)?\s*(?:jt|juta|m|k|rb|ribu)|\d{1,3}(?:[.,]\d{3})+|\d+)/i;
        const matchAmount = body.match(amountRegex);
        if (matchAmount) {
          const amount = parseAmount(matchAmount[0]);
          const name = body.replace(matchAmount[0], '').replace(/\s+/g, ' ').trim();
          if (amount && name) {
            const category = detectCategory(name, hashtagCat, customCategoryMap);
            return {
              intent: 'ADD_RECURRING',
              amount,
              name,
              dueDate,
              category,
              rawMessage: originalText
            };
          }
        }
      }
    }

    // Jika user menulis "langganan ..." atau "tambah rutin ..." tapi tanggal atau nominal belum lengkap, tampilkan panduan format
    return {
      intent: 'HELP_RECURRING',
      rawMessage: originalText
    };
  }

  // 10. Catat Pemasukan
  // masuk 5000000 gaji bulanan
  // masuk 500k bonus
  // masuk 150rb freelance
  const incomeMatch = trimmed.match(
    /^(?:(?:catat\s+)?(?:masuk|income|pemasukan|in|m)|catat\s+masuk)\s+(.+)$/i
  );
  if (incomeMatch) {
    const incomeBody = incomeMatch[1].trim();
    // Search the entire description for the monetary amount. Taking the first
    // number mistakes a date such as "1 Oktober 2026" for Rp1.
    const extractedAmount = extractExplicitAmount(incomeBody) || extractTransactionAmount(incomeBody);
    const leadingAmountCandidate = incomeBody.match(/^(?:rp\.?\s*)?([0-9.,]+(?:\s*(?:k|rb|ribu|jt|juta|m))?)(?:\s+|$)/i);
    const leadingAmountIsQty = leadingAmountCandidate && /^(?:pcs|buah|bh|biji|unit|porsi|cup|gelas|botol|btl|pack|pak|bungkus|bks|lembar|lbr|kotak|ktk|dus|lusin|set|pasang|slice|potong|ptg|ekor|ekr|mangkok|mgk|item|pieces?|qty|roll|sachet|sct|kg|gram|gr|ons|liter|ltr)\b/i.test(incomeBody.slice(leadingAmountCandidate[0].length).trim());
    const leadingAmount = !dateContext && !leadingAmountIsQty ? leadingAmountCandidate : null;
    const amountRaw = extractedAmount?.raw || leadingAmount?.[0];
    const amount = amountRaw ? parseAmount(amountRaw) : null;
    const rest = amountRaw
      ? incomeBody.replace(amountRaw, ' ').replace(/\s+/g, ' ').trim()
      : incomeBody;
    if (amount) {
      const qtyInfo = extractQty(rest);
      const hashtagMatch = rest.match(/#(\w+)/);
      const hashtagCategory = hashtagMatch ? hashtagMatch[1] : undefined;
      let restWithoutHashtag = rest.replace(/#\w+/, '').trim();
      if (qtyInfo) {
        restWithoutHashtag = restWithoutHashtag.replace(qtyInfo.raw, ' ').replace(/\s+/g, ' ').trim();
      }
      const cleanNote = cleanTransactionNote(restWithoutHashtag) || 'Pemasukan';
      const category = detectCategory(cleanNote, hashtagCategory || 'Income', customCategoryMap);

      return {
        intent: 'RECORD_INCOME',
        amount,
        qty: qtyInfo?.qty,
        note: cleanNote,
        category,
        targetDate: dateContext?.targetDate,
        displayDate: dateContext?.displayDate,
        rawMessage: originalText
      };
    }
  }

  // 11. Catat Pengeluaran
  // keluar 25000 makan siang [#food]
  // k 25k kopi susu
  // keluar 150rb belanja
  const expensePrefixMatch = trimmed.match(
    /^(?:(?:catat\s+)?(?:keluar|expense|pengeluaran|out|k)|catat\s+keluar)\s+(.+)$/i
  );
  if (expensePrefixMatch) {
    const expenseBody = expensePrefixMatch[1].trim();
    const extractedAmount = extractTransactionAmount(expenseBody);
    const leadingAmountCandidate = expenseBody.match(/^(?:rp\.?\s*)?([0-9.,]+(?:\s*(?:k|rb|ribu|jt|juta|m))?)(?:\s+|$)/i);
    const leadingAmountIsQty = leadingAmountCandidate && /^(?:pcs|buah|bh|biji|unit|porsi|cup|gelas|botol|btl|pack|pak|bungkus|bks|lembar|lbr|kotak|ktk|dus|lusin|set|pasang|slice|potong|ptg|ekor|ekr|mangkok|mgk|item|pieces?|qty|roll|sachet|sct|kg|gram|gr|ons|liter|ltr)\b/i.test(expenseBody.slice(leadingAmountCandidate[0].length).trim());
    const leadingAmount = !dateContext && !leadingAmountIsQty ? leadingAmountCandidate : null;
    const amountRaw = extractedAmount?.raw || leadingAmount?.[0];
    const amount = amountRaw ? parseAmount(amountRaw) : null;
    const rest = amountRaw
      ? expenseBody.replace(amountRaw, ' ').replace(/\s+/g, ' ').trim()
      : expenseBody;
    if (amount) {
      const qtyInfo = extractQty(rest);
      const hashtagMatch = rest.match(/#(\w+)/);
      const hashtagCategory = hashtagMatch ? hashtagMatch[1] : undefined;
      let restWithoutHashtag = rest.replace(/#\w+/, '').trim();
      if (qtyInfo) {
        restWithoutHashtag = restWithoutHashtag.replace(qtyInfo.raw, ' ').replace(/\s+/g, ' ').trim();
      }
      restWithoutHashtag = restWithoutHashtag.replace(/^(?:beli|order|pesan|bayar)\s+/i, '');
      const cleanNote = cleanTransactionNote(restWithoutHashtag) || 'Pengeluaran';
      const category = detectCategory(cleanNote, hashtagCategory, customCategoryMap);

      return {
        intent: 'RECORD_EXPENSE',
        amount,
        qty: qtyInfo?.qty,
        note: cleanNote,
        category,
        targetDate: dateContext?.targetDate,
        displayDate: dateContext?.displayDate,
        rawMessage: originalText
      };
    }
  }

  // 12. Shortcut Format: "<amount> <note>" (e.g. "25000 kopi", "25k makan siang", "150rb baju")
  const shortcutMatch = trimmed.match(
    /^(?:rp\.?\s*)?([0-9.,]+(?:\s*(?:k|rb|ribu|jt|juta|m))?)\s+(.+)$/i
  );
  if (shortcutMatch) {
    const rawAmt = shortcutMatch[1];
    const amount = parseAmount(rawAmt);
    const rest = shortcutMatch[2].trim();
    const hasUnit = /(?:k|rb|ribu|jt|juta|m)/i.test(rawAmt);

    // Guard: Abaikan jika rest diawali nama bulan atau pola tanggal (misal: "27 september 2026")
    const isDatePattern =
      /^(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|jan|feb|mar|apr|may|jun|jul|ags|aug|sep|sept|okt|oct|nov|des|dec)\b/i.test(rest);

    // Guard: Jika angka polos tanpa k/rb/jt, harus minimal 500 (bukan tanggal 1-31)
    const isReasonableAmount = hasUnit || (amount !== null && amount >= 500);

    if (amount && isReasonableAmount && !isDatePattern && rest && isNaN(Number(rest))) {
      const qtyInfo = extractQty(rest);
      const hashtagMatch = rest.match(/#(\w+)/);
      const hashtagCategory = hashtagMatch ? hashtagMatch[1] : undefined;
      let restWithoutHashtag = rest.replace(/#\w+/, '').trim();
      if (qtyInfo) {
        restWithoutHashtag = restWithoutHashtag.replace(qtyInfo.raw, ' ').replace(/\s+/g, ' ').trim();
      }
      const cleanNote = cleanTransactionNote(restWithoutHashtag) || 'Pengeluaran';
      const category = detectCategory(cleanNote, hashtagCategory, customCategoryMap);

      return {
        intent: 'RECORD_EXPENSE',
        amount,
        qty: qtyInfo?.qty,
        note: cleanNote,
        category,
        targetDate: dateContext?.targetDate,
        displayDate: dateContext?.displayDate,
        rawMessage: originalText
      };
    }
  }

  // 13. General Natural Language Parser (Bebas tanpa format kaku)
  // Guard: Jangan pernah memproses pesan hapus / batal sebagai pengeluaran!
  if (
    /^(?:hapus|batal|batalin|cancel|undo|delete|ralat|tolong\s+hapus|remove)\b/i.test(trimmed) ||
    /^(?:ga\s*jadi|gak?\s*jadi|nggak?\s*jadi|ngga\s*jadi|tidak\s*jadi|gajadi|gakjadi|gausah|ga\s*usah)(?:\s|$)/i.test(lower)
  ) {
    return {
      intent: 'DELETE_LAST',
      rawMessage: originalText
    };
  }

  // Guard: Jangan pernah memproses pesan edit / ubah / koreksi sebagai pengeluaran baru!
  if (/^(?:edit|ubah|ganti|koreksi|ralat|revisi)\b/i.test(trimmed) || /^(?:salah|bukan)\s+.*(?:harusnya|tapi)\s+/i.test(lower)) {
    return {
      intent: 'EDIT_LAST',
      rawMessage: originalText
    };
  }

  // Guard: Jangan pernah memproses pesan query / list / rekap / info sebagai transaksi baru!
  if (isQueryOrReport) {
    return {
      intent: 'UNKNOWN',
      rawMessage: originalText
    };
  }

  // Gunakan extractTransactionAmount yang kebal dari angka tahun/tanggal
  const extracted = extractTransactionAmount(trimmed);
  if (extracted) {
    const { amount, raw: rawAmountStr } = extracted;
    let note = trimmed.replace(rawAmountStr, ' ').replace(/\s+/g, ' ').trim();
    const hashtagMatch = note.match(/#(\w+)/);
    const hashtagCat = hashtagMatch ? hashtagMatch[1] : undefined;
    note = note.replace(/#\w+/g, '').trim();

    const INCOME_KEYWORDS = [
      'masuk', 'pemasukan', 'income', 'gaji', 'gajian', 'bonus', 'transferan',
      'dapat', 'dapet', 'terima', 'thr', 'penjualan', 'laku', 'revenue',
      'komisi', 'arisan', 'cashback', 'cair', 'upah', 'honor', 'honorarium',
      'bayaran', 'dibayar', 'fee', 'invoice', 'tagih', 'piutang', 'refund',
      'pengembalian', 'dividen', 'hadiah', 'hibah', 'sedekah', 'donasi',
      'untung', 'profit', 'hasil', 'orderan', 'freelance', 'proyek',
      'klien', 'client', 'payout', 'withdraw', 'penarikan', 'pencairan'
    ];

    const isIncome = INCOME_KEYWORDS.some(kw => {
      const reg = new RegExp(`\\b${kw}\\b`, 'i');
      return reg.test(lower);
    });

    if (isIncome) {
      const qtyInfo = extractQty(note);
      let noteToClean = note;
      if (qtyInfo) {
        noteToClean = noteToClean.replace(qtyInfo.raw, ' ');
      }
      let cleanNote = cleanTransactionNote(noteToClean
        .replace(/^(?:catat\s+)?(?:masuk|pemasukan|income|in|m)\s+/i, '')
        .replace(/^(?:dapat|dapet|terima)\s+(?:uang\s+|transferan\s+)?/i, '')
        .trim());
      if (!cleanNote) cleanNote = 'Pemasukan';
      const category = detectCategory(cleanNote, hashtagCat || 'Income', customCategoryMap);
      return {
        intent: 'RECORD_INCOME',
        amount,
        qty: qtyInfo?.qty,
        note: cleanNote,
        category,
        targetDate: dateContext?.targetDate,
        displayDate: dateContext?.displayDate,
        rawMessage: originalText
      };
    }

    // Expense
    const qtyInfo = extractQty(note);
    let noteToClean = note;
    if (qtyInfo) {
      noteToClean = noteToClean.replace(qtyInfo.raw, ' ');
    }
    let cleanNote = cleanTransactionNote(noteToClean
      .replace(/^(?:catat\s+)?(?:keluar|expense|pengeluaran|out|k)\s+/i, '')
      .replace(/^(?:tadi\s+|kemarin\s+)?(?:abis\s+|habis\s+)?/i, '')
      .replace(/^(?:beli|order|pesan|bayar)\s+/i, '')
      .replace(/\b(?:abis|habis)\b/gi, '')
      .trim());

    if (!cleanNote) cleanNote = 'Pengeluaran';
    const category = detectCategory(cleanNote, hashtagCat, customCategoryMap);
    return {
      intent: 'RECORD_EXPENSE',
      amount,
      qty: qtyInfo?.qty,
      note: cleanNote,
      category,
      targetDate: dateContext?.targetDate,
      displayDate: dateContext?.displayDate,
      rawMessage: originalText
    };
  }

  // 14. Permintaan analisis statistik (rata-rata, terbesar, perbandingan, ...)
  //
  // Dicek SETELAH semua blok transaksi & query terlewat supaya "rata-rata"
  // tidak capturing pesan biasa, dan tidak pernah sebelum blok recording
  // supaya "makan 25rb" tidak salah dikira analisis.
  if (isAnalysisRequest(trimmed)) {
    return {
      intent: 'AI_ADVICE',
      period: parseQueryDate(trimmed).period,
      rawMessage: originalText
    };
  }

  // 15. Fallback / Unknown
  return {
    intent: 'UNKNOWN',
    rawMessage: originalText
  };
}
