import { GoogleGenerativeAI } from '@google/generative-ai';
import { ParsedIntent } from '@/types';
import { detectCategory } from './parser';

const candidateModels = [
  'gemini-flash-latest',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash'
];

/**
 * Natural language understanding via Gemini AI
 * Extracts intent, amount, note, and category from freeform conversational Indonesian
 */
export async function parseNaturalLanguageWithAI(
  rawText: string,
  customCategoryMap?: Record<string, string[]>
): Promise<ParsedIntent | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const trimmed = (rawText || '').trim();
  if (!trimmed || trimmed.length < 2) return null;

  const now = new Date();
  const todayStr = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  const prompt = `Kamu adalah AI parser pesan transaksi keuangan untuk bot pengelola keuangan di Indonesia.
Analisis pesan berikut dan klasifikasikan maksudnya ke dalam salah satu tipe:
- "list_expenses": minta daftar / list / rincian pengeluaran (misal: "list pengeluaran hari ini", "daftar pengeluaran kemarin", "rincian pengeluaran tanggal 27 september 2026")
- "list_incomes": minta daftar / list / rincian pemasukan (misal: "list pemasukan hari ini", "daftar uang masuk kemarin", "rincian pemasukan tanggal 27 september 2026")
- "summary": minta cek rekap, ringkasan, laporan, saldo, atau list semua transaksi pada tanggal/periode tertentu (misal: "rekap tanggal 27 september 2026", "buatin list tanggal 27 september 2026", "laporan hari ini", "cek saldo", "hari ini habis berapa")
- "expense": mencatat transaksi pengeluaran uang baru (misal: "tadi jajan bakso 15rb", "beli bensin 50k", "abis servis motor 120rb")
- "income": mencatat uang masuk / pendapatan baru (misal: "dapat transferan 500rb", "gajian 5jt", "dapet arisan 1jt")
- "advice": minta tips hemat atau analisa keuangan (misal: "keuangan gue gimana ya", "minta saran hemat")
- "menu": minta panduan fitur / menu / bantuan
- "delete": membatalkan atau menghapus catatan transaksi (misal: "hapus transaksi tadi", "batalin yang 30rb", "hapus catatan pengeluaran sebelumnya")
- "other": obrolan umum di luar keuangan

PENTING: JANGAN PERNAH mengklasifikasikan pesan yang meminta 'list', 'daftar', 'rincian', 'rekap', 'laporan', 'ringkasan' sebagai 'expense' atau 'income' meskipun terdapat angka tanggal atau tahun (seperti 2026)!

Pesan pengguna: "${trimmed}"
Tanggal hari ini: ${todayStr}

Kategori transaksi umum: Food, Transport, Shopping, Bills, Entertainment, Health, Education, Lainnya.

Keluarkan HANYA format JSON valid tanpa tanda backtick atau markdown, dengan struktur:
{
  "type": "list_expenses" | "list_incomes" | "summary" | "expense" | "income" | "advice" | "menu" | "delete" | "other",
  "amount": number, // Nominal angka bulat dalam Rupiah (0 jika bukan transaksi baru)
  "note": "keterangan singkat transaksi (tanpa nominal)",
  "category": "kategori yang paling sesuai",
  "period": "day" | "week" | "month", // diisi untuk summary / list_expenses / list_incomes
  "target_date": "YYYY-MM-DD", // diisi jika user menanyakan tanggal spesifik / kemarin / kemarin lusa, misal "2026-09-27"
  "display_date": "string tanggal yang mudah dibaca" // cth: "27 September 2026", "Kemarin"
}`;

  const genAI = new GoogleGenerativeAI(apiKey);

  for (const modelName of candidateModels) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      let rawJson = result.response.text().trim();

      if (rawJson.startsWith('```')) {
        rawJson = rawJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      }

      const parsed = JSON.parse(rawJson);

      if (parsed.type === 'list_expenses') {
        let period: 'day' | 'week' | 'month' = 'day';
        if (parsed.period === 'week') period = 'week';
        else if (parsed.period === 'month') period = 'month';
        return {
          intent: 'LIST_EXPENSES',
          period,
          targetDate: parsed.target_date || undefined,
          displayDate: parsed.display_date || undefined,
          rawMessage: trimmed
        };
      }

      if (parsed.type === 'list_incomes') {
        let period: 'day' | 'week' | 'month' = 'day';
        if (parsed.period === 'week') period = 'week';
        else if (parsed.period === 'month') period = 'month';
        return {
          intent: 'LIST_INCOMES',
          period,
          targetDate: parsed.target_date || undefined,
          displayDate: parsed.display_date || undefined,
          rawMessage: trimmed
        };
      }

      if (parsed.type === 'summary') {
        let period: 'day' | 'week' | 'month' = 'month';
        if (parsed.period === 'day' || parsed.target_date) period = 'day';
        else if (parsed.period === 'week') period = 'week';
        else period = 'month';

        const map: Record<string, 'SUMMARY_DAY' | 'SUMMARY_WEEK' | 'SUMMARY_MONTH'> = {
          day: 'SUMMARY_DAY',
          week: 'SUMMARY_WEEK',
          month: 'SUMMARY_MONTH'
        };
        return {
          intent: map[period],
          period,
          targetDate: parsed.target_date || undefined,
          displayDate: parsed.display_date || undefined,
          rawMessage: trimmed
        };
      }

      if (parsed.type === 'expense') {
        const amount = Number(parsed.amount) || 0;
        if (amount > 0) {
          const note = (parsed.note || 'Pengeluaran').trim();
          const category = parsed.category || detectCategory(note, undefined, customCategoryMap);
          return {
            intent: 'RECORD_EXPENSE',
            amount,
            note,
            category,
            rawMessage: trimmed
          };
        }
      }

      if (parsed.type === 'income') {
        const amount = Number(parsed.amount) || 0;
        if (amount > 0) {
          const note = (parsed.note || 'Pemasukan').trim();
          const category = parsed.category || detectCategory(note, 'Income', customCategoryMap);
          return {
            intent: 'RECORD_INCOME',
            amount,
            note,
            category,
            rawMessage: trimmed
          };
        }
      }

      if (parsed.type === 'advice') {
        return {
          intent: 'AI_ADVICE',
          rawMessage: trimmed
        };
      }

      if (parsed.type === 'menu') {
        return {
          intent: 'MENU',
          rawMessage: trimmed
        };
      }

      if (parsed.type === 'delete') {
        const amount = Number(parsed.amount) || undefined;
        const note = (parsed.note || '').trim() || undefined;
        return {
          intent: 'DELETE_LAST',
          amount,
          note,
          rawMessage: trimmed
        };
      }

      // If 'other', return null to let normal handling proceed
      return null;
    } catch (err: any) {
      console.warn(`[AI NLU] Model ${modelName} error:`, err?.message || err);
    }
  }

  return null;
}
