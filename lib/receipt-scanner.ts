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

interface ReceiptExtraction {
  total_amount: number;
  amountSource?: 'total' | 'subtotal' | 'item_sum';
  merchant: string;
  category?: string;
  items?: string;
  note?: string;
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

function extractReceiptFromOcrText(text: string): ReceiptExtraction {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  // Pola 1: Label total eksplisit (sangat luas)
  const totalLabel = /\b(?:grand\s*)?total\b|\bjumlah\s*(?:pembayaran|bayar|belanja|tagihan|akhir|keseluruhan)?\b|\b(?:amount|balance)\s+due\b|\bnett?\b|\bbayar\b|\bpembayaran\b|\btunai\b|\bcash\b|\bcredit\b|\bdebit\b|\bcharge\b|\bfinal\s*(?:amount|total|price)\b|\bdpp\b|\btotal\s*(?:harga|belanja|bayar|transaksi|amount|due|price|payment|bill|net|nett)?\b/i;
  let total = 0;
  let amountSource: 'total' | 'subtotal' | 'item_sum' = 'total';

  // Cari dari bawah ke atas untuk menemukan total yang paling relevan
  for (let index = lines.length - 1; index >= 0; index--) {
    if (!totalLabel.test(lines[index])) continue;
    total = extractAmountFromOcrLine(lines[index]);
    if (!total && lines[index + 1]) {
      total = extractAmountFromOcrLine(lines[index + 1]);
    }
    if (total > 0) break;
  }

  // Pola 2: Subtotal fallback
  if (total <= 0) {
    const subtotalLabel = /\bsub[\s-]?total\b/i;
    for (let index = lines.length - 1; index >= 0; index--) {
      if (!subtotalLabel.test(lines[index])) continue;
      total = extractAmountFromOcrLine(lines[index]);
      if (!total && lines[index + 1]) {
        total = extractAmountFromOcrLine(lines[index + 1]);
      }
      if (total > 0) {
        amountSource = 'subtotal';
        break;
      }
    }
  }

  // OCR tabel kadang memisahkan label Subtotal/Bayar dari nominal di kolom
  // kanan. Bila itu terjadi, jumlahkan nominal rupiah pada rincian produk.
  if (total <= 0) {
    const summaryLabel = /\b(?:sub[\s-]?total|(?:grand\s*)?total|bayar|dibayar|payment|debit|credit|cash|kembali|change)\b/i;
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

  const merchant = lines.find((line) =>
    /[a-z]/i.test(line) &&
    !/^(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|struk|receipt|invoice|faktur|cash|tanggal|waktu|shift|no\.?\s*(?:trans|nota)|total|jumlah|bayar|pembayaran|tagihan|biaya|idpel|nama|periode|no\s*reff|pax|table)\b/i.test(line)
  ) || 'Toko/Merchant';
  const category = getOcrCategory(`${merchant}\n${text}`);

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

  return {
    total_amount: total,
    amountSource,
    merchant,
    category,
    items,
    note: items ? `${merchant} - ${items}` : `${merchant} (Scan Struk)`
  };
}

async function scanWithOcrSpace(imageBuffer: Buffer, mimeType: string): Promise<ReceiptExtraction> {
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
      OCREngine: '2',
      scale: 'true'
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
2. merchant: nama toko / merchant / restoran / penyedia layanan (contoh: "Indomaret", "Alfamart", "Kopi Kenangan", "SPBU Pertamina", "Apotek Kimia Farma"). Jika tidak terbaca, gunakan "Toko/Merchant".
3. category: pilih salah satu kategori yang paling cocok dari: Food, Transport, Bills, Entertainment, Shopping, Health, Donation, Lainnya.
4. items: daftar ringkas 1-4 barang yang dibeli (contoh: "Kopi Latte, Roti").
5. note: catatan singkat WAJIB menyertakan nama merchant dan daftar item yang dibeli. Format: "NamaToko - item1, item2, item3" (contoh: "BreadTalk - Bread Butter Pudding, Cream Brulee, Choco Croissant"). Jika item tidak terbaca, cukup nama toko saja.

Wajib balas HANYA dalam format JSON murni tanpa markdown codeblock dan tanpa teks lain:
{
  "total_amount": 45000,
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

  // OCR.Space is fast and deterministic for clear receipts. Gemini remains the
  // fallback for layouts where OCR cannot identify a payable total.
  if (process.env.OCR_SPACE_API_KEY) {
    ocrAttempted = true;
    try {
      extraction = await scanWithOcrSpace(imageBuffer, mimeType);
      scanProvider = 'OCR.Space';
      console.info('[ReceiptScanner] Receipt extracted with OCR.Space.');
    } catch (err) {
      ocrFailure = err;
      lastError = err;
      console.warn('[ReceiptScanner] OCR.Space primary scan failed; trying Gemini:', err);
    }
  }

  for (const modelName of !extraction && genAI ? candidateModels : []) {
    for (let attempt = 1; attempt <= MAX_GEMINI_ATTEMPTS_PER_MODEL; attempt++) {
      try {
        const model = genAI!.getGenerativeModel({ model: modelName });
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
        if (rawJsonText) break;
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

  if (!rawJsonText && !extraction) {
    console.error('[ReceiptScanner] All vision models failed:', modelErrors);
    if (!ocrAttempted) {
      try {
        extraction = await scanWithOcrSpace(imageBuffer, mimeType);
        scanProvider = 'OCR.Space';
        console.info('[ReceiptScanner] Receipt extracted with OCR.Space fallback.');
      } catch (ocrError: any) {
        console.error('[ReceiptScanner] OCR.Space fallback failed:', ocrError);
        ocrFailure = ocrError;
        lastError = ocrError;
      }
    }

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

  try {
    if (!extraction) {
      // Clean potential markdown wrap
      let cleanJson = rawJsonText;
      if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      }
      extraction = JSON.parse(cleanJson) as ReceiptExtraction;
    }

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

    const transaction: Transaction = {
      id: crypto.randomUUID(),
      user_id: userId,
      type: 'expense',
      amount,
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
      `🏷️ *Kategori:* ${category}\n` +
      (data.items ? `🛍️ *Item:* ${data.items}\n` : '') +
      (data.amountSource === 'subtotal' ? '⚠️ Total akhir tidak terlihat; nominal dicatat dari subtotal yang terbaca.\n' : '') +
      (data.amountSource === 'item_sum' ? '⚠️ Total dihitung dari nominal pada rincian item karena baris total tidak terbaca utuh.\n' : '') +
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
