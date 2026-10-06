import { GoogleGenerativeAI } from '@google/generative-ai';
import { appendTransaction } from './sheets';
import { detectCategory } from './parser';
import { formatRp } from './transactions';
import { Transaction } from '@/types';
import crypto from 'crypto';

export interface ScannedReceiptResult {
  success: boolean;
  replyText: string;
  transaction?: Transaction;
  error?: string;
}

/**
 * Scan receipt image using Gemini Vision and automatically record to Google Sheets
 */
function resolveReceiptDate(targetDate?: string): string {
  if (!targetDate) return new Date().toISOString();
  const [year, month, day] = targetDate.split('-').map(Number);
  if (!year || !month || !day) return new Date().toISOString();
  return new Date(`${targetDate}T12:00:00+07:00`).toISOString();
}

const RETRYABLE_GEMINI_STATUSES = new Set([429, 503, 504]);
const MAX_GEMINI_ATTEMPTS_PER_MODEL = 2;
const GEMINI_REQUEST_TIMEOUT_MS = 25_000;
const OCR_SPACE_REQUEST_TIMEOUT_MS = 20_000;

/**
 * Jumlah nominal pada baris item yang formatnya tegas:
 *   "<qty> <nama barang> <nominal>"  → "2 Kopi 50.000"
 *
 * Baris wajib diawali angka kuantitas agar metadata ("NAMA: BUDI", "IDPEL: 13802",
 * "BIAYA ADM 2.500") tidak ikut terhitung. Tanpa syarat ini, peringatan
 * mismatch akan muncul hampir di setiap struk sehingga tidak berguna.
 */
function sumItemLineAmounts(lines: string[]): number | undefined {
  const metadata =
    /\b(?:total|jumlah|bayar|pembayaran|tunai|cash|debit|credit|kembali|change|subtotal|ppn|pajak|npwp|diskon|discount|admin|terima\s+kasih|struk|receipt|invoice|faktur)\b/i;

  const itemRow = /^\s*\d{1,4}\s*(?:[xX×]\s*)?[a-z].*?\d[\d.,]*\s*$/i;

  let sum = 0;
  let found = false;

  for (const line of lines) {
    if (metadata.test(line)) continue;
    if (!itemRow.test(line)) continue;

    const amount = extractAmountFromOcrLine(line);
    if (amount > 0) {
      sum += amount;
      found = true;
    }
  }

  if (!found) return undefined;
  return sum;
}

/**
 * Peringatkan bila total yang terbaca tidak masuk akal dibanding penjumlahan
 * item.
 *
 * Total pada struk bisa lebih besar dari penjumlahan item (ada pajak, ongkir,
 * biaya admin) tetapi tidak mungkin berbeda jauh. Ambang 40% dipakai agar
 * selisih yang wajar tidak memicu peringatan, sementara nominal yang salah
 * terbaca (mis. membaca "750.000" padahal total 50.000) tetap ditandai.
 */
function buildTotalMismatchWarning(total: number, itemSum?: number): string | undefined {
  if (!itemSum || itemSum <= 0) return undefined;

  const ratio = total / itemSum;
  if (ratio >= 0.6 && ratio <= 1.4) return undefined;

  const direction = total > itemSum ? 'lebih besar' : 'lebih kecil';
  return `⚠️ Nominal total (${direction} dari penjumlahan rincian item) perlu dicek. Mohon pastikan angkanya benar, atau hapus catatan ini dengan "hapus terakhir".`;
}

interface ReceiptExtraction {
  total_amount: number;
  amountSource?: 'total' | 'subtotal' | 'item_sum';
  merchant: string;
  category?: string;
  items?: string;
  qty?: number;
  note?: string;
  /** Peringatan kualitas ekstraksi, mis. total tidak cocok dengan rincian item. */
  warning?: string;
}

function getGeminiErrorStatus(err: any): number | undefined {
  const status = Number(err?.status || err?.statusCode || err?.response?.status);
  return Number.isFinite(status) ? status : undefined;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getOcrCategory(text: string): string {
  if (/\b(?:pertamina|pertamax|spbu|bbm|bensin|solar)\b/i.test(text)) return 'Transport';
  if (/\b(?:bread|roti|croissant|pudding|brulee|cake|kue|kopi|coffee|cafe|restaurant|restoran|makan)\b/i.test(text)) return 'Food';
  return detectCategory(text);
}

function extractAmountFromOcrLine(line: string): number {
  const values = line.match(/(?:rp\.?\s*)?[\d][\d.,\s]*/gi) || [];
  const value = values.at(-1);
  if (!value) return 0;

  const numeric = value.replace(/[^\d.,]/g, '');
  if (!numeric) return 0;

  const lastSeparator = Math.max(numeric.lastIndexOf('.'), numeric.lastIndexOf(','));
  const decimalDigits = lastSeparator >= 0 ? numeric.length - lastSeparator - 1 : 0;
  if (decimalDigits > 0 && decimalDigits <= 2) {
    const integerPart = numeric.slice(0, lastSeparator).replace(/\D/g, '');
    return integerPart ? Number(integerPart) : 0;
  }

  const digits = numeric.replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

/**
 * Baris yang bukan nama toko: alamat, NPWP, nomor telepon, jam, tanggal,
 * slogan, dan kalimat terima kasih. Baris seperti ini sering muncul di bagian
 * atas struk dan sebelumnya sempat dianggap sebagai merchant.
 */
const notMerchantLine =
  /^(?:terima\s+kasih|thank\s*you|www\.|https?:\/\/|jl\.?\s|jln\.?\s|jalan|no\.?\s*(?:telp|tel|hp)|telepon|tel\.?\s|npwp|np\.?\s|kasir|cashier|struk|receipt|invoice|faktur|nota|tanggal|date|waktu|time|jam|pax|meja|table|shift|kas|account|kartu)\b/i;

/**
 * Pilih baris yang paling mungkin berisi nama toko.
 *
 * Strategi: nama toko hampir selalu ada di bagian ATAS struk (header), jadi
 * baris kandidat dicari dari atas, dan baris yang jelas-jelas bukan nama toko
 * (alamat, NPWP, tanggal, jam, terima kasih, footer) dilewati.
 */
function findMerchant(lines: string[]): string {
  const headerWindow = lines.slice(0, Math.max(8, Math.ceil(lines.length / 2)));

  const isCandidate = (line: string): boolean => {
    if (!line || line.length < 2 || line.length > 40) return false;
    if (!/[a-z]/i.test(line)) return false;
    // Terlalu banyak angka = metadata, bukan nama toko.
    const digits = (line.match(/\d/g) || []).length;
    if (digits > Math.max(2, Math.floor(line.length / 3))) return false;
    if (notMerchantLine.test(line.trim())) return false;
    if (/^(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{1,2}:\d{2})\b/.test(line.trim())) return false;
    return true;
  };

  // Label yang bukan bagian dari nama merchant.
  const metadataLabel =
    /\b(?:total|jumlah|bayar|pembayaran|tagihan|biaya|idpel|nama|periode|pax|table|shift|kasir|cashier|item|subtotal|ppn|pajak|admin|diskon|kembali|change|tunai|cash|debit|credit)\b/i;

  for (const line of headerWindow) {
    const trimmed = line.trim();
    if (!isCandidate(trimmed)) continue;
    // Baris seperti "NAMA: BUDI" bukan merchant.
    if (metadataLabel.test(trimmed) && /[:=]/.test(trimmed)) continue;
    return trimmed;
  }

  return 'Toko/Merchant';
}

export function extractReceiptFromOcrText(text: string): ReceiptExtraction {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  let total = 0;
  let amountSource: 'total' | 'subtotal' | 'item_sum' = 'total';

  /**
   * Label yang menyatakan JUMLAH BARANG, bukan nominal uang.
   * Baris seperti ini sering muncul di bagian bawah struk dan sebelumnya ikut
   * terbaca sebagai total sehingga menghasilkan nominal salah (mis. "Total Qty: 1"
   * dibaca jadi total Rp1).
   */
  const qtyLabel =
    /\b(?:total\s*(?:item|items?|qty|barang|kuantitas|pcs|product)|jumlah\s*(?:item|barang|baris|produk)|item\s*count|qty)\b/i;

  /**
   * Prioritas label nominal, dari yang paling kuat:
   *  1. TOTAL BAYAR / GRAND TOTAL / JUMLAH PEMBAYARAN → nilai final yang dicari
   *  2. metode pembayaran (TUNAI/DEBIT/CREDIT) → uang diserahkan, perlu dikurangi kembalian
   *  3. DPP/amount due → Basis pajak, bukan nominal akhir
   */
  const strongTotalLabel =
    /\b(?:grand\s*total|total(?:\s*(?:akhir|keseluruhan|bayar|pembayaran|transaksi|tagihan|harga|amount|due|price|payment|bill))?|jumlah\s*(?:pembayaran|bayar|belanja|tagihan|akhir|keseluruhan)|(?:amount|balance)\s+due|total\s*due)\b/i;
  const paymentLabel =
    /\b(?:tunai|cash|debit|credit|kartu|transfer|trf|qris|shopeepay|ovo|dana|va)\b/i;
  const changeLabel = /\b(?:kembali|kembalian|change|kembalian\s*uang)\b/i;

  const weakTotalLabel =
    /\b(?:dpp|nett?\b|bayar\b|pembayaran\b|charge|final\s*(?:amount|total|price))\b/i;

  /** Ambil nominal dari sebuah baris, atau dari baris berikutnya bila kosong. */
  const readAmountAt = (index: number): number => {
    let amount = extractAmountFromOcrLine(lines[index]);
    if (!amount && lines[index + 1]) amount = extractAmountFromOcrLine(lines[index + 1]);
    return amount;
  };

  // Cari dari bawah ke atas: pada struk, nominal final berada di bagian bawah.
  const findLastAmountByLabel = (label: RegExp, skipQty: boolean): number => {
    for (let index = lines.length - 1; index >= 0; index--) {
      if (skipQty && qtyLabel.test(lines[index])) continue;
      if (!label.test(lines[index])) continue;
      const amount = readAmountAt(index);
      if (amount > 0) return amount;
    }
    return 0;
  };

  // Prioritas 1: label total eksplisit.
  total = findLastAmountByLabel(strongTotalLabel, true);

  // Prioritas 2: metode pembayaran. Kalau ada baris kembalian, nominal yang
  // dibayar = uang yang diserahkan - kembalian. Tanpa pengurangan ini, struk
  // "TUNAI 50.000 / KEMBALI 25.000" akan tercatat Rp50.000 (harga sebenarnya 25.000).
  if (total <= 0) {
    const tendered = findLastAmountByLabel(paymentLabel, true);
    if (tendered > 0) {
      const change = findLastAmountByLabel(changeLabel, true);
      const derived = change > 0 && change < tendered ? tendered - change : tendered;
      total = derived;
    }
  }

  // Prioritas 3: label lemah (DPP, amount due, bayar).
  if (total <= 0) {
    total = findLastAmountByLabel(weakTotalLabel, true);
  }

  // Prioritas 4: subtotal.
  if (total <= 0) {
    total = findLastAmountByLabel(/\bsub[\s-]?total\b/i, true);
    if (total > 0) amountSource = 'subtotal';
  }

  // OCR tabel kadang memisahkan label Subtotal/Bayar dari nominal di kolom
  // kanan. Bila itu terjadi, jumlahkan nominal rupiah pada rincian produk.
  if (total <= 0) {
    const summaryLabel =
      /\b(?:sub[\s-]?total|(?:grand\s*)?total|bayar|dibayar|payment|debit|credit|cash|kembali|change)\b/i;
    const itemAmounts: number[] = [];

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (summaryLabel.test(line) || !/\b(?:rp\.?|idr)\b/i.test(line)) continue;

      let amount = extractAmountFromOcrLine(line);
      if (!amount && lines[index + 1]) amount = extractAmountFromOcrLine(lines[index + 1]);
      if (amount > 0) itemAmounts.push(amount);
    }

    if (itemAmounts.length > 0) {
      total = itemAmounts.reduce((sum, amount) => sum + amount, 0);
      amountSource = 'item_sum';
    }
  }

  if (total <= 0) {
    throw new Error('OCR.Space tidak menemukan baris total pembayaran pada struk.');
  }

  const merchant = findMerchant(lines);
  const category = getOcrCategory(`${merchant}\n${text}`);

  /**
   * Jumlah nominal pada baris item (mis. "2 Kopi 25.000" → 25.000 per baris,
   * lalu dijumlahkan bila formatnya per-item).
   *
   * Dipakai hanya sebagai pembanding untuk memberi peringatan bila total yang
   * terbaca jauh berbeda dari penjumlahan item — pertanda ada baris yang salah
   * dibaca, bukan untuk menimpa total yang sudah jelas.
   */
  const itemLineTotal = sumItemLineAmounts(lines);

  const mismatchWarning = buildTotalMismatchWarning(total, itemLineTotal);


  // Ekstrak item-item belanja dari baris OCR
  // Item biasanya punya nama + harga di baris yang sama, dan bukan label total/subtotal/tax/dll
  const skipLabels = /\b(?:(?:grand\s*)?total|sub[\s-]?total|jumlah|tax|pajak|ppn|pph|disc|diskon|discount|service|charge|pembulatan|rounding|change|kembalian|tunai|cash|credit|debit|bayar|pembayaran|dpp|nett?)\b/i;
  const itemLines: string[] = [];
  let itemSectionStarted = false;
  for (const line of lines) {
    if (/\b(?:sub[\s-]?total|(?:grand\s*)?total|payment|debit|credit|cash|change|kembalian)\b/i.test(line)) {
      if (itemSectionStarted) break;
      continue;
    }

    // Only accept receipt rows shaped like "1 Product name 11.500".
    // This drops POS identifiers, dates, payment references, and footer text.
    if (!/^\s*\d+\s*(?:[xX×]\s*)?.+?\s+(?:rp\.?\s*)?(?:\d{1,3}(?:[.,]\d{3})+|\d{4,})\s*$/i.test(line)) {
      continue;
    }
    itemSectionStarted = true;

    // Item line: has text + a number, but is not a total/meta label
    if (skipLabels.test(line)) continue;
    if (!/[a-z]/i.test(line)) continue;
    const amount = extractAmountFromOcrLine(line);
    if (amount > 0 && amount < total) {
      // Extract just the name part (strip quantity prefix like "1 x" or "2x")
      const name = line
        .replace(/^\d+\s*[xX×]?\s*/, '')
        .replace(/(?:rp\.?\s*)?[\d][\d.,\s]*/gi, '')
        .replace(/^[\s:]+|[\s:]+$/g, '')
        .trim();
      if (name && name.length >= 2 && name.length <= 60) {
        itemLines.push(name);
      }
    }
  }

  // Some receipt layouts separate columns when OCR reads them. If the strict
  // row pattern finds nothing, use the section before Subtotal/Total and keep
  // only lines that begin with a quantity followed by a product name.
  if (itemLines.length === 0) {
    const endIndex = lines.findIndex((line) => /\b(?:sub[\s-]?total|(?:grand\s*)?total)\b/i.test(line));
    const productLines = lines.slice(0, endIndex >= 0 ? endIndex : lines.length);
    const metadata = /\b(?:pos|check|no\.?|cashier|member|closed|debit|credit|cash|www\.|http|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\d{1,2}:\d{2}/i;
    let fallbackItemCount = 0;

    for (const line of productLines) {
      if (metadata.test(line)) continue;
      const match = line.match(/^\s*\d{1,3}\s*(?:[xX×]\s*)?([a-z][a-z0-9 &'/-]*?)(?:\s+(?:rp\.?\s*)?(?:\d{1,3}(?:[.,]\d{3})+|\d{4,}))?\s*$/i);
      if (!match) continue;

      const name = match[1]
        .replace(/\s+/g, ' ')
        .replace(/\s+(?:rp\.?\s*)?(?:\d{1,3}(?:[.,]\d{3})+|\d{4,})\s*$/i, '')
        .trim();
      if (name.length >= 2 && name.length <= 80 && !itemLines.some((item) => item.toLowerCase() === name.toLowerCase())) {
        itemLines.push(name);
        fallbackItemCount += 1;
      }
      if (fallbackItemCount === 8) break;
    }
  }
  const items = itemLines.length > 0 ? itemLines.join(', ') : undefined;

  // Deteksi kuantitas total (Total Item: 4, Total Qty: 4, atau hitungan baris item)
  let detectedQty: number | undefined;
  for (const line of lines) {
    const qtySummaryMatch = line.match(/\b(?:total\s*(?:item|items?|qty|pcs|barang|kuantitas)|items?|qty|pcs)\s*[:=]?\s*(\d+)\b/i);
    if (qtySummaryMatch) {
      const q = parseInt(qtySummaryMatch[1], 10);
      if (q > 0 && q <= 9999) {
        detectedQty = q;
        break;
      }
    }
  }

  /**
   * Jumlahkan kuantitas dari baris item yang terbaca.
   *
   * Baris item berbentuk "5 Gula 35.000" atau "2 x Susu 12.000". Menjumlahkan
   * angka di depan memberi kuantitas sebenarnya; memakai jumlah baris saja
   * akan salah (baris "5 Gula" akan terhitung 1).
   */
  function sumItemQuantities(): number | undefined {
    let sum = 0;
    let found = false;

    for (const line of lines) {
      const match = line.match(/^\s*(\d{1,4})\s*(?:[xX×]\s*)?[a-z]/i);
      if (!match) continue;
      const q = parseInt(match[1], 10);
      if (q > 0 && q <= 9999) {
        sum += q;
        found = true;
      }
    }

    if (!found) return undefined;
    return Math.min(sum, 9999);
  }

  // Jika tidak ada baris ringkasan kuantitas, hitung dari baris item.
  if (!detectedQty && itemLines.length > 0) {
    detectedQty = sumItemQuantities() ?? itemLines.length;
  }

  return {
    total_amount: total,
    amountSource,
    merchant,
    category,
    items,
    qty: detectedQty,
    warning: mismatchWarning,
    note: items ? `${merchant} - ${items}` : `${merchant} (Scan Struk)`
  };
}

/**
 * Variabel OCR.Space.
 *
 * Engine yang berbeda sering kali membaca hal yang berbeda pada struk yang
 * kurang tajam, jadi beberapa setting dicoba bergiliran sampai nominal
 * ditemukan. Ini menaikkan peluang berhasil tanpa mengubah kode utama.
 */
interface OcrVariant {
  engine: string;
  isTable: string;
  detectOrientation: string;
  scale: string;
}

const OCR_VARIANTS: OcrVariant[] = [
  { engine: '2', isTable: 'false', detectOrientation: 'false', scale: 'true' },
  { engine: '1', isTable: 'true', detectOrientation: 'true', scale: 'true' },
  { engine: '2', isTable: 'true', detectOrientation: 'false', scale: 'false' }
];

async function scanWithOcrSpace(
  imageBuffer: Buffer,
  mimeType: string,
  variant: OcrVariant
): Promise<ReceiptExtraction> {
  const apiKey = process.env.OCR_SPACE_API_KEY;
  if (!apiKey) throw new Error('OCR_SPACE_API_KEY belum diatur.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OCR_SPACE_REQUEST_TIMEOUT_MS);

  try {
    const body = new URLSearchParams({
      apikey: apiKey,
      base64Image: `data:${mimeType};base64,${imageBuffer.toString('base64')}`,
      language: 'eng',
      isOverlayRequired: 'false',
      OCREngine: variant.engine,
      isTable: variant.isTable,
      detectOrientation: variant.detectOrientation,
      scale: variant.scale
    });
    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null) as {
      IsErroredOnProcessing?: boolean;
      ErrorMessage?: string[] | string;
      ParsedResults?: Array<{ ParsedText?: string }>;
    } | null;

    if (!response.ok || payload?.IsErroredOnProcessing) {
      const reason = Array.isArray(payload?.ErrorMessage)
        ? payload.ErrorMessage.join(', ')
        : payload?.ErrorMessage;
      const error = new Error(reason || `OCR.Space gagal (HTTP ${response.status}).`);
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }

    const text = payload?.ParsedResults?.map((result) => result.ParsedText || '').join('\n').trim();
    if (!text) throw new Error('OCR.Space tidak menemukan teks pada gambar struk.');
    return extractReceiptFromOcrText(text);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Coba OCR.Space dengan beberapa konfigurasi engine sampai nominal ditemukan.
 * Kegagalan pada percobaan pertama (mis. baris total tidak terbaca) dicatat,
 * lalu dicoba lagi dengan setting yang berbeda sebelum menyerah.
 */
async function scanWithOcrSpaceVariants(
  imageBuffer: Buffer,
  mimeType: string
): Promise<ReceiptExtraction> {
  let lastError: unknown;

  for (let i = 0; i < OCR_VARIANTS.length; i++) {
    const variant = OCR_VARIANTS[i];
    try {
      const result = await scanWithOcrSpace(imageBuffer, mimeType, variant);
      if (i > 0) {
        console.info(`[ReceiptScanner] Total terbaca pada percobaan OCR.Space ke-${i + 1} (engine ${variant.engine}).`);
      }
      return result;
    } catch (err) {
      lastError = err;
      // Error kredensial/kuota tidak akan membaik dengan mengganti engine,
      // jadi langsung hentikan percobaan.
      const status = getGeminiErrorStatus(err);
      if (status === 401 || status === 403 || status === 429) break;
      console.warn(`[ReceiptScanner] OCR.Space engine ${variant.engine} gagal: ${(err as Error)?.message}`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Bersihkan dan parse output Gemini menjadi struktur struk.
 *
 * Model kadang membungkus JSON dengan markdown fence, menambah koma terakhir,
 * atau menuliskan teks tambahan di sekitarnya. Semua itu dicoba diperbaiki
 * lebih dulu supaya struk tetap terbaca, bukan langsung menyerah.
 *
 * Mengembalikan null bila tetap tidak bisa diparse.
 */
function parseExtractionJson(text: string): ReceiptExtraction | null {
  if (!text) return null;

  let candidate = text.trim();
  if (candidate.startsWith('```')) {
    candidate = candidate.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  // Model sering menambahkan kalimat sebelum/sesudah objek JSON.
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) candidate = candidate.slice(start, end + 1);

  const attempts = [candidate, candidate.replace(/,\s*([}\]])/g, '$1')];

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as ReceiptExtraction;
      const isReceiptShape =
        parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        ['total_amount', 'merchant', 'items', 'note', 'category'].some((key) => key in parsed);
      if (isReceiptShape) return parsed;
    } catch {
      // Coba kandidat perbaikan berikutnya.
    }
  }

  return null;
}

export async function scanReceiptImage(
  imageBuffer: Buffer,
  mimeType: string = 'image/jpeg',
  userId?: string,
  targetDate?: string
): Promise<ScannedReceiptResult> {
  const apiKey = process.env.GEMINI_API_KEY;

  const prompt = `
Kamu adalah asisten keuangan pribadi yang ahli membaca struk belanja, bon kasir, struk ATM, atau invoice di Indonesia.
Analisis gambar struk ini dan ekstrak informasi berikut:
1. total_amount: angka total nominal akhir yang dibayarkan (hanya angka bulat positif, tanpa titik/koma/Rp, contoh: 45000). Jika ada diskon/pajak, ambil nilai FINAL yang dibayar pembeli.
2. qty: total kuantitas/jumlah seluruh item/barang yang dibeli dalam struk (angka bulat positif, contoh: jika beli 4 roti maka 4, jika struk menunjukkan 'Total Items: 4' atau 4 baris item masing-masing 1 pcs maka isi 4). Jika tidak ada info jumlah atau hanya beli 1 item/bensin/parkir, isi minimal 1.
3. merchant: nama toko / merchant / restoran / penyedia layanan (contoh: "Indomaret", "Alfamart", "Kopi Kenangan", "SPBU Pertamina", "Apotek Kimia Farma"). Jika tidak terbaca, gunakan "Toko/Merchant".
4. category: pilih salah satu kategori yang paling cocok dari: Food, Transport, Bills, Entertainment, Shopping, Health, Donation, Lainnya.
5. items: daftar ringkas 1-4 barang yang dibeli (contoh: "Kopi Latte, Roti").
6. note: catatan singkat WAJIB menyertakan nama merchant dan daftar item yang dibeli. Format: "NamaToko - item1, item2, item3" (contoh: "BreadTalk - Bread Butter Pudding, Cream Brulee, Choco Croissant"). Jika item tidak terbaca, cukup nama toko saja.

Wajib balas HANYA dalam format JSON murni tanpa markdown codeblock dan tanpa teks lain:
{
  "total_amount": 45000,
  "qty": 2,
  "merchant": "Indomaret",
  "category": "Shopping",
  "items": "Minyak goreng, Telur",
  "note": "Indomaret - Minyak goreng, Telur"
}
`.trim();

  const candidateModels = [
    'gemini-2.0-flash',
    'gemini-2.5-flash-preview-05-20',
    'gemini-3.5-flash'
  ];

  const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
  const base64Data = imageBuffer.toString('base64');
  let rawJsonText = '';
  let lastError: any = null;
  const modelErrors: Array<{ model: string; status?: number; message: string }> = [];
  let extraction: ReceiptExtraction | undefined;
  let scanProvider = 'Gemini';
  let ocrFailure: unknown;
  let ocrAttempted = false;

  // 1. Prioritaskan Gemini Vision terlebih dahulu (Primary AI Engine)
  if (genAI) {
    for (const modelName of candidateModels) {
      for (let attempt = 1; attempt <= MAX_GEMINI_ATTEMPTS_PER_MODEL; attempt++) {
        try {
          const model = genAI.getGenerativeModel({ model: modelName });
          const result = await Promise.race([
            model.generateContent([
              prompt,
              {
                inlineData: {
                  data: base64Data,
                  mimeType
                }
              }
            ]),
            new Promise<never>((_, reject) => setTimeout(
              () => reject(Object.assign(new Error('Gemini request timed out.'), { status: 504 })),
              GEMINI_REQUEST_TIMEOUT_MS
            ))
          ]);
          rawJsonText = result.response.text().trim();
          if (rawJsonText) {
            scanProvider = 'Gemini';
            break;
          }
        } catch (err: any) {
          const status = getGeminiErrorStatus(err);
          const message = String(err?.message || err || 'Unknown Gemini API error');
          const retryable = status !== undefined && RETRYABLE_GEMINI_STATUSES.has(status);

          console.warn(
            `[ReceiptScanner] Model ${modelName} attempt ${attempt}/${MAX_GEMINI_ATTEMPTS_PER_MODEL} failed ` +
            `(HTTP ${status || 'unknown'}): ${message}`
          );
          modelErrors.push({ model: modelName, status, message });
          lastError = err;

          if (!retryable || attempt === MAX_GEMINI_ATTEMPTS_PER_MODEL) break;

          // Exponential backoff with a small jitter prevents simultaneous retries.
          const delayMs = (1_000 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 300);
          console.info(`[ReceiptScanner] Retrying ${modelName} in ${delayMs}ms after HTTP ${status}.`);
          await wait(delayMs);
        }
      }

      if (rawJsonText) break;
    }
  }

  // 2. Jika Gemini Vision gagal/error atau tidak ada GEMINI_API_KEY, otomatis fallback ke OCR.Space
  if (!rawJsonText && process.env.OCR_SPACE_API_KEY) {
    ocrAttempted = true;
    try {
      console.info('[ReceiptScanner] Gemini Vision tidak tersedia atau gagal; beralih otomatis ke OCR.Space...');
      extraction = await scanWithOcrSpaceVariants(imageBuffer, mimeType);
      scanProvider = 'OCR.Space';
      console.info('[ReceiptScanner] Struk berhasil diproses menggunakan OCR.Space fallback.');
    } catch (ocrError: any) {
      console.error('[ReceiptScanner] OCR.Space fallback gagal:', ocrError);
      ocrFailure = ocrError;
      lastError = ocrError;
    }
  }

  if (!rawJsonText && !extraction) {
    console.error('[ReceiptScanner] Seluruh engine pembaca struk gagal (Gemini Vision & OCR.Space):', modelErrors);

    if (!extraction) {
    const errorText = modelErrors.map((error) => `${error.status || ''} ${error.message}`).join(' ').toLowerCase();
    let failureHelp = 'Layanan AI gagal memproses gambar. Silakan coba lagi beberapa saat.';

    if (/\b429\b|resource_exhausted|quota|rate.?limit/i.test(errorText)) {
      failureHelp = 'Batas kuota atau laju permintaan Gemini tercapai (429). Periksa kuota Gemini API di Google AI Studio atau coba lagi setelah batasnya pulih.';
    } else if (/\b402\b|prepayment|billing|payment required/i.test(errorText)) {
      failureHelp = 'Akun Gemini API memerlukan pemeriksaan billing atau saldo prabayar. Periksa status billing project di Google AI Studio.';
    } else if (/\b401\b|\b403\b|api.?key|permission_denied|unauthenticated/i.test(errorText)) {
      failureHelp = 'Gemini API menolak kredensial. Periksa apakah GEMINI_API_KEY valid dan project memiliki akses ke Gemini API.';
    } else if (/\b404\b|model_not_found|not found/i.test(errorText)) {
      failureHelp = 'Model Gemini yang tersedia untuk project ini tidak ditemukan. Periksa akses model atau nama model pada konfigurasi scanner.';
    } else if (/\b503\b|\b504\b|unavailable|deadline_exceeded|timeout/i.test(errorText)) {
      failureHelp = 'Layanan Gemini sedang sibuk atau melewati batas waktu. Coba kirim foto struk lagi sebentar lagi.';
    }

    const ocrMessage = ocrFailure instanceof Error ? ocrFailure.message : String(ocrFailure || '');
    const ocrStatus = getGeminiErrorStatus(ocrFailure);
    if (ocrFailure) {
      if (/OCR_SPACE_API_KEY belum diatur/i.test(ocrMessage)) {
        failureHelp = 'Gemini gagal dan OCR.Space tidak menemukan OCR_SPACE_API_KEY pada environment deployment. Pastikan key tersedia di Production lalu deploy ulang.';
      } else if (/tidak menemukan baris total pembayaran/i.test(ocrMessage)) {
        failureHelp = 'Gemini gagal dan OCR.Space tidak dapat mengenali total pembayaran pada struk. Pastikan bagian jumlah yang harus dibayar terlihat jelas dan kirim foto yang lebih tajam.';
      } else if (ocrStatus === 401 || ocrStatus === 403) {
        failureHelp = 'Gemini gagal dan OCR.Space menolak API key. Periksa OCR_SPACE_API_KEY dan status akun OCR.Space.';
      } else if (ocrStatus === 429) {
        failureHelp = 'Gemini gagal dan batas kuota atau laju permintaan OCR.Space juga tercapai. Coba lagi setelah kuota pulih.';
      } else {
        failureHelp = `Gemini gagal dan OCR.Space juga tidak berhasil memproses struk${ocrStatus ? ` (HTTP ${ocrStatus})` : ''}. Periksa status OCR.Space dan coba foto yang lebih jelas.`;
      }
    }

    const diagnosticLines = [
      modelErrors.at(-1)?.status ? `Kode Gemini terakhir: ${modelErrors.at(-1)?.status}.` : '',
      ocrFailure
        ? ocrStatus
          ? `Kode OCR.Space: ${ocrStatus}.`
          : `Detail OCR.Space: ${ocrMessage}`
        : ''
    ].filter(Boolean);

    return {
      success: false,
      replyText: `⚠️ *Gagal Menganalisis Struk*\n\n${failureHelp}${diagnosticLines.length ? `\n\n${diagnosticLines.join('\n')}` : ''}`
    };
    }
  }
  if (rawJsonText) console.log('[ReceiptScanner] Gemini Vision Output:', rawJsonText);

  if (!extraction && rawJsonText) {
    extraction = parseExtractionJson(rawJsonText) ?? undefined;
  }

  // Output Gemini bukan JSON valid → jangan langsung menyerah. Coba selamatkan
  // lewat OCR.Space yang membaca teks struk, sehingga struk tetap tercatat.
  if (!extraction && process.env.OCR_SPACE_API_KEY) {
    try {
      extraction = await scanWithOcrSpaceVariants(imageBuffer, mimeType);
      scanProvider = 'OCR.Space';
      ocrAttempted = true;
      ocrFailure = undefined;
      console.info('[ReceiptScanner] Output Gemini bukan JSON valid; memakai hasil OCR.Space sebagai cadangan.');
    } catch (err) {
      ocrAttempted = true;
      ocrFailure = err;
    }
  }

  if (!extraction) {
    console.error('[ReceiptScanner] Failed to parse JSON response:', rawJsonText);
    return {
      success: false,
      replyText: '⚠️ AI berhasil membaca gambar tetapi format struk tidak standar. Silakan catat langsung dengan chat seperti: "makan siang 25rb" atau "beli bensin 50k".'
    };
  }

  try {
    const data = extraction;
    const amount = Number(data.total_amount) || 0;

    if (amount <= 0) {
      return {
        success: false,
        replyText: '⚠️ *Total nominal tidak terbaca dari struk.*\nPastikan bagian total pembayaran atau kasir terlihat jelas.'
      };
    }

    // Determine category
    let category = data.category || detectCategory(data.note || data.merchant);

    const merchant = data.merchant || 'Struk';
    const items = data.items || '';
    // Always include items in note for Google Sheets record
    const note = items
      ? `${merchant} - ${items}`
      : (data.note || `${merchant} (Scan Struk)`);
    const transactionDate = resolveReceiptDate(targetDate);
    const qty = Number(data.qty) > 0 ? Number(data.qty) : (data.items ? 1 : undefined);

    const transaction: Transaction = {
      id: crypto.randomUUID(),
      user_id: userId,
      type: 'expense',
      amount,
      qty,
      category,
      note,
      raw_message: `[Scan Struk] ${merchant} - Rp${amount}`,
      source: 'manual',
      created_at: transactionDate
    };

    // Save to Google Sheets
    await appendTransaction(transaction);

    const transactionDateLabel = new Date(transaction.created_at).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Jakarta'
    });
    const replyText = 
      `🧾 *Struk Berhasil ${scanProvider === 'OCR.Space' ? 'Diproses dengan OCR.Space' : 'Dianalisis AI'}!*\n\n` +
      `🏪 *Toko:* ${merchant}\n` +
      `💰 *Total:* ${formatRp(amount)}\n` +
      (qty ? `📦 *Qty:* ${qty}\n` : '') +
      `🏷️ *Kategori:* ${category}\n` +
      (data.items ? `🛍️ *Item:* ${data.items}\n` : '') +
      (data.amountSource === 'subtotal' ? '⚠️ Total akhir tidak terlihat; nominal dicatat dari subtotal yang terbaca.\n' : '') +
      (data.amountSource === 'item_sum' ? '⚠️ Total dihitung dari nominal pada rincian item karena baris total tidak terbaca utuh.\n' : '') +
      (data.warning ? data.warning + '\n' : '') +
      (ocrFailure && scanProvider === 'Gemini' ? '⚠️ OCR.Space tidak dapat memverifikasi nominal; periksa kembali jumlah transaksi.\n' : '') +
      `📅 *Tanggal transaksi:* ${transactionDateLabel}\n\n` +
      `✅ _Otomatis dicatat ke Google Sheets Anda!_\n_Atur tanggal lewat caption foto, misalnya: 26 September atau 23 Agustus 2025._`;

    return {
      success: true,
      replyText,
      transaction
    };
  } catch (err: any) {
    console.error('[ReceiptScanner] Failed to parse JSON response:', rawJsonText, err);
    return {
      success: false,
      replyText: '⚠️ AI berhasil membaca gambar tetapi format struk tidak standar. Silakan catat langsung dengan chat seperti: "makan siang 25rb" atau "beli bensin 50k".'
    };
  }
}
