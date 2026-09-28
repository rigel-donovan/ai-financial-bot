import { ParsedIntent } from '@/types';

// Default keyword-to-category mapping
export const DEFAULT_CATEGORY_KEYWORDS: Record<string, string[]> = {
  Food: [
    'makan', 'kopi', 'coffee', 'cafe', 'kafe', 'jajan', 'lunch', 'dinner', 'sarapan',
    'gofood', 'grabfood', 'shopeefood', 'resto', 'restoran', 'beras', 'cemilan',
    'snack', 'minum', 'bakso', 'mie', 'nasi', 'ayam', 'warteg', 'padang', 'soto',
    'sate', 'martabak', 'boba', 'roti', 'seblak', 'cilok', 'bebek', 'ikan'
  ],
  Transport: [
    'bensin', 'ojek', 'tol', 'grab', 'gojek', 'parkir', 'krl', 'mrt', 'busway',
    'tiket', 'pertamax', 'pertalite', 'solar', 'angkot', 'taksi', 'kereta',
    'motor', 'mobil', 'servis', 'service', 'tambal', 'cuci motor', 'cuci mobil'
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
  period: 'day' | 'week' | 'month';
  targetDate?: string; // YYYY-MM-DD
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
    return {
      period: 'week',
      displayDate: 'Minggu Lalu'
    };
  }
  if (/\b(?:minggu(?:\s+ini)?|week)\b/i.test(lower)) {
    return {
      period: 'week',
      displayDate: 'Minggu Ini'
    };
  }

  // 8. "bulan ini" / "bulan lalu"
  if (/\bbulan\s+lalu\b/i.test(lower)) {
    return {
      period: 'month',
      displayDate: 'Bulan Lalu'
    };
  }
  if (/\b(?:bulan(?:\s+ini)?|month)\b/i.test(lower)) {
    return {
      period: 'month',
      displayDate: 'Bulan Ini'
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

/**
 * Main intent parser
 */
export function parseMessage(
  rawText: string,
  customCategoryMap?: Record<string, string[]>
): ParsedIntent {
  const trimmed = (rawText || '').trim();
  const lower = trimmed.toLowerCase();

  // Strip polite prefixes: "tolong buatin", "buatin", "minta", "tolong", etc.
  const cleanPrefix = lower
    .replace(/^(?:tolong\s+|mohon\s+|coba\s+)?(?:buatin\s+|buatkan\s+|tampilin\s+|tampilkan\s+|minta\s+|kasih\s+|kasi\s+|lihat\s+|cek\s+)?/i, '')
    .trim();

  // 1. Menu / Bantuan / Help / Sapaan
  if (/^(?:menu|bantuan|help|halo|hi|hai|mulai|start|fitur|panduan|cara pakai)$/i.test(lower)) {
    return {
      intent: 'MENU',
      rawMessage: trimmed
    };
  }

  // 2. AI Advisor / Saran / Analisa
  if (
    /^(?:saran|analisa|analisis|insight|rekomendasi|evaluasi|gimana keuanganku|tips hemat|konsultasi|cek keuangan)(?:\s+.*)?$/i.test(lower)
  ) {
    return {
      intent: 'AI_ADVICE',
      rawMessage: trimmed
    };
  }

  // 3. Query / List / Rekap / Ringkasan / Laporan (Batas luas & mengenali tanggal/periode)
  const isQueryOrReport =
    !lower.includes('rutin') && (
      /^(?:list|daftar|rincian|tampilkan|tampilin|lihat|cek|berapa|laporan|rekap|ringkasan|riwayat|history|summary)\b/i.test(cleanPrefix) ||
      /^(?:list|daftar|rincian|tampilkan|tampilin|lihat|cek|berapa|laporan|rekap|ringkasan|riwayat|history|summary)\b/i.test(lower) ||
      /\b(?:habis berapa|sisa saldo|saldo sekarang|pengeluaran tanggal|pemasukan tanggal)\b/i.test(lower) ||
      /^(?:pengeluaran|biaya|pemasukan)\s+(?:hari(?:\s+ini)?|today|minggu(?:\s+ini)?|week|bulan(?:\s+ini)?|month)\s+(?:list|daftar|rincian|semua)$/i.test(lower)
    );

  if (isQueryOrReport) {
    const dateInfo = parseQueryDate(trimmed);

    // 3a. Khusus Pemasukan
    // Contoh: "list pemasukan tanggal 27 september 2026", "daftar pemasukan kemarin", "rincian uang masuk"
    if (
      /\b(?:pemasukan|income|uang\s+masuk)\b/i.test(lower) ||
      (/\bmasuk\b/i.test(lower) && !/\b(?:pengeluaran|biaya|keluar)\b/i.test(lower))
    ) {
      return {
        intent: 'LIST_INCOMES',
        period: dateInfo.period,
        targetDate: dateInfo.targetDate,
        displayDate: dateInfo.displayDate,
        rawMessage: trimmed
      };
    }

    // 3b. Khusus Pengeluaran
    // Contoh: "list pengeluaran hari ini", "daftar pengeluaran 27 sep 2026", "rincian biaya kemarin"
    if (
      /\b(?:pengeluaran|biaya|expense)\b/i.test(lower) ||
      (/\bkeluar\b/i.test(lower) && !/\b(?:pemasukan|income|masuk)\b/i.test(lower))
    ) {
      return {
        intent: 'LIST_EXPENSES',
        period: dateInfo.period,
        targetDate: dateInfo.targetDate,
        displayDate: dateInfo.displayDate,
        rawMessage: trimmed
      };
    }

    // 3c. Rekap / Ringkasan / Laporan Umum / Semua Transaksi
    // Contoh: "buatin list tanggal 27 september 2026", "rekap kemarin", "laporan bulan ini", "saldo sekarang"
    if (dateInfo.period === 'week') {
      return {
        intent: 'SUMMARY_WEEK',
        period: 'week',
        targetDate: dateInfo.targetDate,
        displayDate: dateInfo.displayDate,
        rawMessage: trimmed
      };
    }
    if (dateInfo.period === 'month') {
      return {
        intent: 'SUMMARY_MONTH',
        period: 'month',
        targetDate: dateInfo.targetDate,
        displayDate: dateInfo.displayDate,
        rawMessage: trimmed
      };
    }

    return {
      intent: 'SUMMARY_DAY',
      period: 'day',
      targetDate: dateInfo.targetDate,
      displayDate: dateInfo.displayDate,
      rawMessage: trimmed
    };
  }

  // 4. Hapus Terakhir / Undo / Batal
  // Mendukung: "hapus terakhir", "batalin transaksi tadi", "hapus isi bensin 30ribu dari struk tadi", "hapus catatan pengeluaran sebelumnya"
  if (!lower.startsWith('hapus rutin') && !lower.startsWith('batal rutin') && !lower.startsWith('nonaktif rutin')) {
    const isDeleteWord =
      /^(?:hapus|batal|batalin|cancel|undo|delete|ralat|tolong\s+hapus)\b/i.test(trimmed) ||
      /\b(?:hapus|batal|batalin|cancel|undo)\s+(?:transaksi|catatan|pengeluaran|pemasukan|struk|yang tadi|tadi|sebelumnya)\b/i.test(lower);

    if (isDeleteWord) {
      const AMOUNT_REGEX = /(?:(?:rp\.?|idr)\s*)?(?:\d+(?:[.,]\d+)?\s*(?:jt|juta|m|k|rb|ribu)\b|\d{1,3}(?:[.,]\d{3})+(?!\d)|\b\d{4,9}\b)/i;
      let deleteAmount: number | undefined;
      const matchAmt = trimmed.match(AMOUNT_REGEX);
      if (matchAmt) {
        deleteAmount = parseAmount(matchAmt[0]) || undefined;
      }

      let cleanNote = trimmed
        .replace(/^(?:tolong\s+)?(?:hapus|batal|batalin|cancel|undo|delete|ralat)\s+/i, '')
        .replace(/\b(?:dari struk|struk tadi|yang tadi|tadi|sebelumnya|terakhir|transaksi|catatan|pengeluaran|pemasukan)\b/gi, '')
        .trim();
      if (matchAmt) {
        cleanNote = cleanNote.replace(matchAmt[0], '').replace(/\s+/g, ' ').trim();
      }
      if (cleanNote === 'undo' || cleanNote === 'cancel' || cleanNote === 'hapus' || cleanNote === 'batal') {
        cleanNote = '';
      }

      return {
        intent: 'DELETE_LAST',
        amount: deleteAmount,
        note: cleanNote || undefined,
        rawMessage: trimmed
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

      const amtMatch = replacementPart.match(AMOUNT_REGEX);
      const amount = amtMatch ? parseAmount(amtMatch[0]) || undefined : undefined;

      let newNote = replacementPart;
      if (amtMatch) {
        newNote = replacementPart.replace(amtMatch[0], '').replace(/\s+/g, ' ').trim();
      }

      let targetQuery = targetPart
        .replace(/\b(?:terakhir|transaksi|nominal|catatan|keterangan|yang tadi|tadi)\b/gi, '')
        .trim();

      return {
        intent: 'EDIT_LAST',
        amount,
        note: newNote || undefined,
        name: targetQuery || undefined,
        rawMessage: trimmed
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
        rawMessage: trimmed
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
        rawMessage: trimmed
      };
    }

    return {
      intent: 'EDIT_LAST',
      rawMessage: trimmed
    };
  }

  // 6. Pengeluaran Rutin: List Rutin
  if (
    lower === 'list rutin' ||
    lower === 'daftar rutin' ||
    lower === 'rutin list' ||
    lower === 'cek rutin'
  ) {
    return {
      intent: 'LIST_RECURRING',
      rawMessage: trimmed
    };
  }

  // 7. Pengeluaran Rutin: Hapus / Nonaktif Rutin
  // hapus rutin netflix / nonaktif rutin spotify
  const delRecurringMatch = trimmed.match(/^(?:hapus\s+rutin|nonaktif\s+rutin|batal\s+rutin)\s+(.+)$/i);
  if (delRecurringMatch) {
    const name = delRecurringMatch[1].trim();
    return {
      intent: 'DELETE_RECURRING',
      name,
      rawMessage: trimmed
    };
  }

  // 8. Pengeluaran Rutin: Panduan / Bantuan
  if (
    lower === 'tambah rutin' ||
    lower === 'rutin' ||
    lower === 'pengeluaran rutin' ||
    lower === 'cara tambah rutin' ||
    lower === 'bantuan rutin'
  ) {
    return {
      intent: 'HELP_RECURRING',
      rawMessage: trimmed
    };
  }

  // 9. Pengeluaran Rutin: Tambah Rutin (Fleksibel)
  // Contoh:
  // - tambah rutin 150000 netflix tgl 5
  // - tambah rutin 150k spotify tanggal 20
  // - tambah rutin netflix 150rb tgl 5
  // - tambah rutin netflix 150k tiap tgl 5
  // - tambah rutin netflix 150k setiap tgl 5
  // - tambah rutin netflix 150k tiap bulan tgl 5
  // - tambah rutin 150k netflix tgl 5 tiap bulan
  // - rutin netflix 150k tgl 5
  const recurringPrefixMatch = trimmed.match(
    /^(?:tambah\s+(?:pengeluaran\s+)?rutin|rutin\s+tambah|pengeluaran\s+rutin|rutin)\s+(.+)$/i
  );
  if (recurringPrefixMatch) {
    let body = recurringPrefixMatch[1].trim();

    // Extract hashtag category if any
    const hashtagMatch = body.match(/#(\w+)/);
    const hashtagCat = hashtagMatch ? hashtagMatch[1] : undefined;
    body = body.replace(/#\w+/g, '').trim();

    // Strip recurrent frequency words: "tiap bulan", "setiap bulan", "per bulan", "perbulan"
    body = body.replace(/\b(?:tiap|setiap|per)\s*bulan\b/gi, '').trim();
    body = body.replace(/\bperbulan\b/gi, '').trim();

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
              rawMessage: trimmed
            };
          }
        }
      }
    }
  }

  // 10. Catat Pemasukan
  // masuk 5000000 gaji bulanan
  // masuk 500k bonus
  // masuk 150rb freelance
  const incomeMatch = trimmed.match(
    /^(?:masuk|income|in|m)\s+(?:rp\.?\s*)?([0-9.,]+(?:\s*(?:k|rb|ribu|jt|juta|m))?)(?:\s+(.*))?$/i
  );
  if (incomeMatch) {
    const amount = parseAmount(incomeMatch[1]);
    const rest = (incomeMatch[2] || '').trim();
    if (amount) {
      const hashtagMatch = rest.match(/#(\w+)/);
      const hashtagCategory = hashtagMatch ? hashtagMatch[1] : undefined;
      const cleanNote = rest.replace(/#\w+/, '').trim() || 'Pemasukan';
      const category = detectCategory(cleanNote, hashtagCategory || 'Income', customCategoryMap);

      return {
        intent: 'RECORD_INCOME',
        amount,
        note: cleanNote,
        category,
        rawMessage: trimmed
      };
    }
  }

  // 11. Catat Pengeluaran
  // keluar 25000 makan siang [#food]
  // k 25k kopi susu
  // keluar 150rb belanja
  const expensePrefixMatch = trimmed.match(
    /^(?:keluar|expense|out|k)\s+(?:rp\.?\s*)?([0-9.,]+(?:\s*(?:k|rb|ribu|jt|juta|m))?)(?:\s+(.*))?$/i
  );
  if (expensePrefixMatch) {
    const amount = parseAmount(expensePrefixMatch[1]);
    const rest = (expensePrefixMatch[2] || '').trim();
    if (amount) {
      const hashtagMatch = rest.match(/#(\w+)/);
      const hashtagCategory = hashtagMatch ? hashtagMatch[1] : undefined;
      const cleanNote = rest.replace(/#\w+/, '').trim() || 'Pengeluaran';
      const category = detectCategory(cleanNote, hashtagCategory, customCategoryMap);

      return {
        intent: 'RECORD_EXPENSE',
        amount,
        note: cleanNote,
        category,
        rawMessage: trimmed
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
      const hashtagMatch = rest.match(/#(\w+)/);
      const hashtagCategory = hashtagMatch ? hashtagMatch[1] : undefined;
      const cleanNote = rest.replace(/#\w+/, '').trim();
      const category = detectCategory(cleanNote, hashtagCategory, customCategoryMap);

      return {
        intent: 'RECORD_EXPENSE',
        amount,
        note: cleanNote,
        category,
        rawMessage: trimmed
      };
    }
  }

  // 13. General Natural Language Parser (Bebas tanpa format kaku)
  // Guard: Jangan pernah memproses pesan hapus / batal sebagai pengeluaran!
  if (/^(?:hapus|batal|batalin|cancel|undo|delete|ralat|tolong\s+hapus)\b/i.test(trimmed)) {
    return {
      intent: 'DELETE_LAST',
      rawMessage: trimmed
    };
  }

  // Guard: Jangan pernah memproses pesan edit / ubah / koreksi sebagai pengeluaran baru!
  if (/^(?:edit|ubah|ganti|koreksi|ralat|revisi)\b/i.test(trimmed) || /^(?:salah|bukan)\s+.*(?:harusnya|tapi)\s+/i.test(lower)) {
    return {
      intent: 'EDIT_LAST',
      rawMessage: trimmed
    };
  }

  // Guard: Jangan pernah memproses pesan query / list / rekap / info sebagai transaksi baru!
  if (isQueryOrReport) {
    return {
      intent: 'UNKNOWN',
      rawMessage: trimmed
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
      'dapat', 'dapet', 'terima', 'thr', 'penjualan', 'laku',
      'komisi', 'arisan', 'cashback', 'cair', 'upah', 'honor'
    ];

    const isIncome = INCOME_KEYWORDS.some(kw => {
      const reg = new RegExp(`\\b${kw}\\b`, 'i');
      return reg.test(lower);
    });

    if (isIncome) {
      let cleanNote = note
        .replace(/^(?:masuk|pemasukan|income|in|m)\s+/i, '')
        .replace(/^(?:dapat|dapet|terima)\s+(?:uang\s+|transferan\s+)?/i, '')
        .trim();
      if (!cleanNote) cleanNote = 'Pemasukan';
      const category = detectCategory(cleanNote, hashtagCat || 'Income', customCategoryMap);
      return {
        intent: 'RECORD_INCOME',
        amount,
        note: cleanNote,
        category,
        rawMessage: trimmed
      };
    }

    // Expense
    let cleanNote = note
      .replace(/^(?:keluar|expense|out|k)\s+/i, '')
      .replace(/^(?:tadi\s+|kemarin\s+)?(?:abis\s+|habis\s+)?/i, '')
      .replace(/\b(?:abis|habis)\b/gi, '')
      .trim();

    if (!cleanNote) cleanNote = 'Pengeluaran';
    const category = detectCategory(cleanNote, hashtagCat, customCategoryMap);
    return {
      intent: 'RECORD_EXPENSE',
      amount,
      note: cleanNote,
      category,
      rawMessage: trimmed
    };
  }

  // 14. Fallback / Unknown
  return {
    intent: 'UNKNOWN',
    rawMessage: trimmed
  };
}
