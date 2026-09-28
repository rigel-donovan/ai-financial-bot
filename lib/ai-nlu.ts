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

  const prompt = `Kamu adalah AI parser cerdas untuk bot catatan keuangan Indonesia.
Tujuanmu adalah membaca maksud pengguna dengan sangat fleksibel, akurat, dan natural, tanpa terpaku pada pola yang terlalu kaku. Fokus utamanya adalah konteks transaksi keuangan: pemasukan, pengeluaran, laporan, saldo, langganan, dan koreksi transaksi.

Aturan utama:
1. Jika pesan berhubungan dengan keuangan atau catatan transaksi, inferensikan maksudnya secara luas dan akurat.
2. Jika pesan tidak berhubungan sama sekali dengan transaksi keuangan, catatan keuangan, tagihan, pemasukan, pengeluaran, atau laporan finansial, kembalikan "other".
3. Jangan memaksa mengubah pesan yang jelas-jelas adalah query, laporan, ringkasan, atau list menjadi transaksi baru.
4. Gunakan konteks tanggal seperti hari ini, kemarin, minggu ini, bulan ini, tanggal tertentu, rentang tanggal, atau tahun sebagai parameter waktu bila relevan.
5. Jika ada angka, nominal, tanggal, nama merchant, atau kata kunci keuangan, pertimbangkan sebagai bukti kuat bahwa ini adalah konteks finansial.
6. Jangan terlalu membatasi diri pada contoh; pahami variasi bahasa Indonesia casual, singkat, atau tidak formal.
7. Kembalikan JSON saja tanpa penjelasan, tanpa markdown, tanpa backtick.

Klasifikasi yang mungkin:
- "list_all": permintaan gabungan pemasukan dan pengeluaran sekaligus
- "list_expenses": permintaan daftar atau rincian pengeluaran
- "list_incomes": permintaan daftar atau rincian pemasukan
- "list_recurring": daftar atau cek langganan / tagihan rutin / pengeluaran tetap
- "add_recurring": tambah langganan atau tagihan rutin baru
- "delete_recurring": hapus, stop, atau nonaktifkan langganan / tagihan rutin
- "help_recurring": tanya cara atau bantuan terkait langganan
- "summary": rekap, laporan, ringkasan, saldo, atau total transaksi per periode
- "expense": mencatat pengeluaran baru
- "income": mencatat pemasukan baru
- "advice": minta saran atau insight keuangan
- "menu": minta bantuan fitur atau daftar menu
- "delete": hapus atau batalkan transaksi
- "other": di luar konteks transaksi catatan keuangan

PENTING:
- "list", "daftar", "rincian", "rekap", "laporan", "ringkasan", "cek saldo", "berapa", dan variasi sejenis TIDAK boleh dipahami sebagai "expense" atau "income" bila tujuannya adalah query/reporting.
- Jika user hanya bertanya umum di luar keuangan, jangan dibuat keuangan; langsung pilih "other".
- Nilai tanggal dan rentang tanggal serta periode hari/minggu/bulan bila ada.

Pesan pengguna: "${trimmed}"
Tanggal hari ini: ${todayStr}

Kategori umum yang harus dipakai bila relevan: Food, Transport, Shopping, Bills, Entertainment, Health, Education, Lainnya.

Format output JSON valid:
{
  "type": "list_all" | "list_expenses" | "list_incomes" | "list_recurring" | "add_recurring" | "delete_recurring" | "help_recurring" | "summary" | "expense" | "income" | "advice" | "menu" | "delete" | "other",
  "amount": number,
  "note": "keterangan singkat transaksi atau nama langganan",
  "category": "kategori yang paling sesuai",
  "period": "day" | "week" | "month",
  "target_date": "YYYY-MM-DD",
  "display_date": "string tanggal yang mudah dibaca",
  "due_date": number
}

Contoh yang valid:
- "list pengeluaran hari ini" => {"type":"list_expenses","period":"day","target_date":"2026-09-28","display_date":"Hari Ini"}
- "gaji 5jt" => {"type":"income","amount":5000000,"note":"gaji","category":"Income"}
- "beli kopi 25rb" => {"type":"expense","amount":25000,"note":"kopi","category":"Food"}
- "halo apa kabar" => {"type":"other"}
`;

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

      if (parsed.type === 'list_all') {
        let period: 'day' | 'week' | 'month' = 'day';
        if (parsed.period === 'week') period = 'week';
        else if (parsed.period === 'month') period = 'month';
        return {
          intent: 'LIST_ALL',
          period,
          targetDate: parsed.target_date || undefined,
          displayDate: parsed.display_date || undefined,
          rawMessage: trimmed
        };
      }

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

      if (parsed.type === 'list_recurring') {
        return {
          intent: 'LIST_RECURRING',
          rawMessage: trimmed
        };
      }

      if (parsed.type === 'help_recurring') {
        return {
          intent: 'HELP_RECURRING',
          rawMessage: trimmed
        };
      }

      if (parsed.type === 'delete_recurring') {
        return {
          intent: 'DELETE_RECURRING',
          name: (parsed.note || '').trim(),
          rawMessage: trimmed
        };
      }

      if (parsed.type === 'add_recurring') {
        const amount = Number(parsed.amount) || 0;
        const dueDate = Number(parsed.due_date) || 1;
        const name = (parsed.note || 'Langganan').trim();
        const category = parsed.category || detectCategory(name, undefined, customCategoryMap);
        return {
          intent: 'ADD_RECURRING',
          amount,
          name,
          dueDate,
          category,
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
