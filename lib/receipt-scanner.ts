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

export async function scanReceiptImage(
  imageBuffer: Buffer,
  mimeType: string = 'image/jpeg',
  userId?: string,
  targetDate?: string
): Promise<ScannedReceiptResult> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      success: false,
      replyText: '⚠️ *Gemini API Key belum diatur.*\nFitur scan struk membutuhkan `GEMINI_API_KEY` aktif di `.env.local`.'
    };
  }

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
    'gemini-flash-latest',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.8-flash'
  ];

  const genAI = new GoogleGenerativeAI(apiKey);
  const base64Data = imageBuffer.toString('base64');
  let rawJsonText = '';
  let lastError: any = null;

  for (const modelName of candidateModels) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent([
        prompt,
        {
          inlineData: {
            data: base64Data,
            mimeType
          }
        }
      ]);
      rawJsonText = result.response.text().trim();
      if (rawJsonText) break;
    } catch (err: any) {
      console.warn(`[ReceiptScanner] Model ${modelName} failed:`, err.message);
      lastError = err;
    }
  }

  if (!rawJsonText) {
    console.error('[ReceiptScanner] All vision models failed:', lastError);
    return {
      success: false,
      replyText:
        '⚠️ *Gagal Menganalisis Struk*\n\n' +
        (lastError?.message?.includes('402') || lastError?.message?.includes('prepayment')
          ? 'Quota Gemini AI memerlukan API key gratis tanpa batasan saldo. Silakan periksa kredensial Gemini Anda di Google AI Studio.'
          : 'Foto struk tidak jelas atau sistem AI sedang sibuk. Pastikan foto struk memiliki pencahayaan cukup dan nominal total terlihat jelas.')
    };
  }

  console.log('[ReceiptScanner] Gemini Vision Output:', rawJsonText);

  try {
    // Clean potential markdown wrap
    let cleanJson = rawJsonText;
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }

    const data = JSON.parse(cleanJson);
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
