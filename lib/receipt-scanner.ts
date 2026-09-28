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

const RETRYABLE_GEMINI_STATUSES = new Set([429, 503]);
const MAX_GEMINI_ATTEMPTS_PER_MODEL = 2;
const GEMINI_REQUEST_TIMEOUT_MS = 12_000;
const OCR_SPACE_REQUEST_TIMEOUT_MS = 15_000;

interface ReceiptExtraction {
  total_amount: number;
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
  return detectCategory(text);
}

function extractAmountFromOcrLine(line: string): number {
  const values = line.match(/(?:rp\.?\s*)?[\d][\d.,\s]*/gi) || [];
  const value = values.at(-1);
  if (!value) return 0;
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

function extractReceiptFromOcrText(text: string): ReceiptExtraction {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const totalLabel = /\b(?:grand\s*)?total\b|\bjumlah\s*(?:pembayaran|bayar|belanja|tagihan|akhir|keseluruhan)\b|\b(?:amount|balance)\s+due\b/i;
  let total = 0;
  for (let index = lines.length - 1; index >= 0; index--) {
    if (!totalLabel.test(lines[index])) continue;
    total = extractAmountFromOcrLine(lines[index]);
    if (!total && lines[index + 1]) {
      total = extractAmountFromOcrLine(lines[index + 1]);
    }
    if (total > 0) break;
  }

  if (total <= 0) {
    throw new Error('OCR.Space tidak menemukan baris total pembayaran pada struk.');
  }

  const merchant = lines.find((line) =>
    !/^(?:struk|receipt|invoice|cash|tanggal|waktu|shift|no\.?\s*(?:trans|nota)|total)/i.test(line) &&
    /[a-z]/i.test(line)
  ) || 'Toko/Merchant';
  const category = getOcrCategory(`${merchant}\n${text}`);

  return {
    total_amount: total,
    merchant,
    category,
    note: `${merchant} (Scan Struk)`
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
5. note: catatan singkat untuk deskripsi transaksi (contoh: "Indomaret - Minyak goreng, Telur").

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
    'gemini-3.8-flash',
    'gemini-3.5-flash'
  ];

  const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
  const base64Data = imageBuffer.toString('base64');
  let rawJsonText = '';
  let lastError: any = null;
  const modelErrors: Array<{ model: string; status?: number; message: string }> = [];

  for (const modelName of genAI ? candidateModels : []) {
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

  let extraction: ReceiptExtraction | undefined;
  let scanProvider = 'Gemini';
  let ocrFailure: unknown;

  if (!rawJsonText) {
    console.error('[ReceiptScanner] All vision models failed:', modelErrors);
    try {
      extraction = await scanWithOcrSpace(imageBuffer, mimeType);
      scanProvider = 'OCR.Space';
      console.info('[ReceiptScanner] Receipt extracted with OCR.Space fallback.');
    } catch (ocrError: any) {
      console.error('[ReceiptScanner] OCR.Space fallback failed:', ocrError);
      ocrFailure = ocrError;
      lastError = ocrError;
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
    const note = data.note || `${merchant} (Scan Struk)`;
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
      `🧾 *Struk Berhasil Dianalisis AI!*\n\n` +
      `🏪 *Toko:* ${merchant}\n` +
      `💰 *Total:* ${formatRp(amount)}\n` +
      `🏷️ *Kategori:* ${category}\n` +
      (data.items ? `🛍️ *Item:* ${data.items}\n` : '') +
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
