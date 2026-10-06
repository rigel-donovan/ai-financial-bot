import { GoogleGenerativeAI } from '@google/generative-ai';
import { Transaction } from '@/types';

// Rate limiter tracking: dateString -> count
const dailyUsageTracker: Record<string, number> = {};
const MAX_DAILY_ADVICE_REQUESTS = 5;

/**
 * Check if daily rate limit is exceeded
 */
function isRateLimitExceeded(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const count = dailyUsageTracker[today] || 0;
  return count >= MAX_DAILY_ADVICE_REQUESTS;
}

function incrementRateLimit(): void {
  const today = new Date().toISOString().slice(0, 10);
  dailyUsageTracker[today] = (dailyUsageTracker[today] || 0) + 1;
}

/**
 * Generate AI financial insight using Google Gemini Free Tier
 */
export async function generateFinancialAdvice(
  transactions: Transaction[],
  periodLabel: string = '30 Hari Terakhir',
  question?: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return (
      '⚠️ *Gemini API Key belum diset.*\n\n' +
      'Untuk mengaktifkan fitur AI Advisor gratis:\n' +
      '1. Buka https://aistudio.google.com/app/apikey (100% Free)\n' +
      '2. Buat API key baru\n' +
      '3. Pasang di Environment Variable: `GEMINI_API_KEY`'
    );
  }

  if (isRateLimitExceeded()) {
    return (
      '⏳ *Batas harian AI tercapai.*\n' +
      `Fitur analisa AI dibatasi maksimal ${MAX_DAILY_ADVICE_REQUESTS}x sehari untuk menjaga kuota gratis Anda. Silakan coba lagi besok!`
    );
  }

  // Filter expenses and incomes
  const expenses = transactions.filter(t => t.type === 'expense');
  const incomes = transactions.filter(t => t.type === 'income');

  if (expenses.length === 0 && incomes.length === 0) {
    return 'Belum ada data transaksi yang tercatat. Catat pengeluaran Anda dulu dengan format: `keluar 25000 makan siang`.';
  }

  const totalExpense = expenses.reduce((sum, t) => sum + t.amount, 0);
  const totalIncome = incomes.reduce((sum, t) => sum + t.amount, 0);

  // Group by category
  const categoryTotals: Record<string, number> = {};
  for (const t of expenses) {
    categoryTotals[t.category] = (categoryTotals[t.category] || 0) + t.amount;
  }

  // Sort top 5 expenses
  const sortedExpenses = [...expenses].sort((a, b) => b.amount - a.amount).slice(0, 5);

  const categoryBreakdownText = Object.entries(categoryTotals)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, amt]) => `- ${cat}: Rp${amt.toLocaleString('id-ID')} (${totalExpense > 0 ? Math.round((amt / totalExpense) * 100) : 0}%)`)
    .join('\n');

  const topItemsText = sortedExpenses
    .map(t => `- Rp${t.amount.toLocaleString('id-ID')} (${t.note || t.category})`)
    .join('\n');

  const prompt = `
Kamu adalah penasihat keuangan pribadi (AI Expense Advisor) yang ramah, santun, cerdas, dan to-the-point dalam Bahasa Indonesia.
Berikut adalah data ringkasan keuangan pengguna selama ${periodLabel}:

- Total Pemasukan: Rp${totalIncome.toLocaleString('id-ID')}
- Total Pengeluaran: Rp${totalExpense.toLocaleString('id-ID')}
- Selisih / Tabungan: Rp${(totalIncome - totalExpense).toLocaleString('id-ID')}
- Jumlah Transaksi: ${transactions.length}
- Pembagian Kategori:
${categoryBreakdownText}

- Pengeluaran Terbesar:
${topItemsText}

${question ? `PERMINTAAN PENGGUNA:
"${question.replace(/"/g, "'")}"

Tugasmu:
1. Jawab pertanyaan pengguna secara LANGSUNG dengan memakai ANGKA dari data di atas.
2. Kalau pertanyaannya soal rata-rata, hitung dari data: total pengeluaran / jumlah transaksi, atau total / jumlah hari sesuai makna kalimatnya.
3. Kalau pertanyaannya soal "terbesar"/"terbanyak", sebutkan pos dan kategorinya beserta angkanya.
4. Kalau pertanyaannya berupa perbandingan antar periode, jelaskan perbandingannya dan sebutkan bahwa data periode lain tidak tersedia bila memang tidak ada.
5. Kalau datanya tidak cukup untuk menjawab, katakan terus terang apa yang tidak tersedia, lalu tanyakan periode atau kategori yang perlu diperjelas.
6. Gunakan format WhatsApp (*bold* untuk penekanan, bullet point, tanpa tabel markdown). Maksimal 180 kata agar nyaman dibaca di chat HP.
` : `Tugasmu:
1. Berikan evaluasi singkat mengenai kondisi keuangan pengguna (1-2 kalimat).
2. Sorot 1 atau 2 pos pengeluaran yang paling perlu diwaspadai / dihemat.
3. Berikan 2 tips praktis yang bisa langsung diterapkan besok.
4. Gunakan format WhatsApp (gunakan *bold* untuk penekanan dan bullet point, tanpa markdown tabel). Maksimal 150-200 kata agar nyaman dibaca di chat HP.
`}
`.trim();

  const candidateModels = [
    'gemini-flash-latest',
    'gemini-3.5-flash',
    'gemini-3.8-flash'
  ];

  const genAI = new GoogleGenerativeAI(apiKey);
  let lastError: any = null;

  for (const modelName of candidateModels) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const text = result.response.text();

      incrementRateLimit();
      return `🤖 *Analisa & Saran Finansial AI*\n\n${text.trim()}`;
    } catch (err: any) {
      console.warn(`[Gemini] Model ${modelName} unavailable, trying next candidate:`, err.message);
      lastError = err;
    }
  }

  console.error('All Gemini model candidates failed:', lastError);
  return (
    'Maaf, layanan AI Gemini sedang sibuk atau mengalami kendala jaringan. ' +
    'Silakan cek kembali beberapa saat lagi.'
  );
}
