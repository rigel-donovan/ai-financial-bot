import crypto from 'crypto';
import {
  Transaction,
  RecurringExpense,
  ParsedIntent,
  ExecutionResult
} from '@/types';
import { parseMessage, detectCategory } from './parser';
import { parseNaturalLanguageWithAI } from './ai-nlu';
import {
  appendTransaction,
  getAllTransactions,
  deleteTransaction,
  deleteLatestTransaction,
  editTransaction,
  editLatestTransactionAmount,
  getRecurringExpenses,
  addRecurringExpense,
  toggleRecurringExpense,
  getCategoryMappings
} from './sheets';
import { generateFinancialAdvice } from './ai-advisor';

/**
 * Format number to Indonesian Rupiah currency string
 */
export function formatRp(amount: number): string {
  return `Rp${amount.toLocaleString('id-ID')}`;
}

/**
 * Format ISO date string to readable Indonesian date
 */
export function formatDate(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Jakarta'
    });
  } catch {
    return isoStr;
  }
}

function formatDateLabel(date?: string): string {
  if (!date) return 'Tanggal tidak ditentukan';
  try {
    const d = new Date(date);
    return d.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Asia/Jakarta'
    });
  } catch {
    return date;
  }
}

function formatDateRangeLabel(startDate?: string, endDate?: string, fallback?: string): string {
  if (startDate && endDate && startDate !== endDate) {
    return `${formatDateLabel(startDate)} - ${formatDateLabel(endDate)}`;
  }
  if (startDate) return formatDateLabel(startDate);
  if (endDate) return formatDateLabel(endDate);
  return fallback || 'periode ini';
}

function buildDateLine(targetDate?: string, startDate?: string, endDate?: string): string {
  const label = formatDateRangeLabel(startDate, endDate, targetDate);
  return label ? `📅 *Tanggal:* ${label}\n` : '';
}

function buildSuccessTemplate(title: string, lines: string[], footer?: string): string {
  const body = lines.join('\n');
  const footerText = footer ? `\n${footer}` : '';
  return `${title}\n\n${body}${footerText}`;
}

const responseTemplates = {
  recordExpense: (ctx: { amount: number; category: string; note: string; date?: string; time: string; }) =>
    buildSuccessTemplate('✅ *Pengeluaran Dicatat!*', [
      `💰 *Jumlah:* ${formatRp(ctx.amount)}`,
      `🏷️ *Kategori:* ${ctx.category}`,
      `📝 *Catatan:* ${ctx.note}`,
      ctx.date ? `📅 *Tanggal:* ${ctx.date}` : '',
      `🕒 *Waktu:* ${ctx.time}`
    ].filter(Boolean)),

  recordIncome: (ctx: { amount: number; category: string; note: string; date?: string; time: string; }) =>
    buildSuccessTemplate('✅ *Pemasukan Dicatat!*', [
      `💵 *Jumlah:* ${formatRp(ctx.amount)}`,
      `🏷️ *Kategori:* ${ctx.category}`,
      `📝 *Catatan:* ${ctx.note}`,
      ctx.date ? `📅 *Tanggal:* ${ctx.date}` : '',
      `🕒 *Waktu:* ${ctx.time}`
    ].filter(Boolean)),

  deleteTransaction: (ctx: { type: 'expense' | 'income'; amount: number; note: string; category: string; date?: string; }) =>
    buildSuccessTemplate('🗑️ *Transaksi Berhasil Dibatalkan/Dihapus!*', [
      `• Jenis: ${ctx.type === 'expense' ? 'Pengeluaran' : 'Pemasukan'}`,
      `• Jumlah: ${formatRp(ctx.amount)}`,
      `• Keterangan: ${ctx.note || ctx.category}`,
      `• Kategori: ${ctx.category}`,
      ctx.date ? `📅 *Tanggal:* ${ctx.date}` : '',
      '• Status: _Dihapus dari Google Sheets_'
    ].filter(Boolean)),

  editTransaction: (ctx: { previousLabel: string; updatedLabel: string; date?: string; }) =>
    buildSuccessTemplate('✏️ *Transaksi Berhasil Diperbarui!*', [
      ctx.previousLabel,
      ctx.updatedLabel,
      ctx.date ? `📅 *Tanggal:* ${ctx.date}` : '',
      '_Perubahan telah disimpan ke Google Sheets._'
    ].filter(Boolean)),

  addRecurring: (ctx: { name: string; amount: number; category: string; dueDate: number }) =>
    buildSuccessTemplate('🔁 *Pengeluaran Rutin & Langganan Tersimpan!*', [
      `• Nama: *${ctx.name}*`,
      `• Jumlah: *${formatRp(ctx.amount)}*`,
      `• Kategori: ${ctx.category}`,
      `• Jatuh tempo: *tiap tanggal ${ctx.dueDate}*`,
      '• Status: *Aktif* ✅',
      '_Bot akan otomatis mencatat dan mengingat tagihan ini setiap bulan._'
    ]),

  disableRecurring: (ctx: { name: string }) =>
    buildSuccessTemplate('✅ *Langganan / Pengeluaran Rutin Berhasil Dinonaktifkan!*', [
      `• Nama: *${ctx.name}*`,
      '• Status: *Nonaktif* ⏸️',
      '_Jika ingin aktifkan kembali, cukup tambah ulang dengan nama yang sama._'
    ]),

  menu: (ctx: { userId?: string }) => {
    const userTag = ctx.userId ? `\n👤 *ID Akun:* \`${ctx.userId}\` _(Data terpisah & aman)_` : '';
    const body = [
      `Pilih perintah cepat atau ketik santai di chat (bebas format):${userTag}`,
      '',
      '*Catat Transaksi Santai:*',
      '• `beli kopi 25rb` / `kopi 20k`',
      '• `beli bensin 50k` / `bensin 50rb`',
      '• `makan siang nasi padang 25.000`',
      '• `bayar listrik 150 ribu`',
      '• `dapet gaji 5jt` / `transferan 500rb`',
      '',
      '*Laporan & Saldo:*',
      '• `pengeluaran hari ini` / `rekap hari`',
      '• `rekap minggu ini`',
      '• `saldo sekarang` / `laporan bulan ini`',
      '',
      '*Koreksi:*',
      '• `hapus terakhir` / `batal`',
      '• `edit terakhir <jumlah>`',
      '',
      '*AI & Foto Struk:*',
      '• `saran` (AI Financial Advisor)',
      '• Kirim langsung *foto struk belanja* 📷',
      '• `list langganan` / `tambah langganan`'
    ].join('\n');

    return buildSuccessTemplate('🤖 Expense Bot Menu', [body]);
  },

  help: (ctx: { isRecurring?: boolean; rawText?: string }) => {
    if (ctx.isRecurring) {
      return buildSuccessTemplate('🔁 *Panduan Langganan & Pengeluaran Rutin Bulanan*', [
        'Sistem bisa mencatat tagihan atau langganan tetap seperti Netflix, Spotify, WiFi, listrik, kos, gym, iCloud, dan lain-lain.',
        '',
        '*Format yang didukung:*',
        '• `langganan <nama> <nominal> tgl <tanggal>`',
        '• `tambah langganan <nama> <nominal> tgl <tanggal>`',
        '• `rutin <nama> <nominal> tgl <tanggal>`',
        '',
        '*Contoh:*',
        '• `langganan netflix 186k tgl 5`',
        '• `langganan spotify 55rb tiap tgl 25`',
        '• `tambah langganan wifi indihome 350k tgl 20`',
        '• `rutin gym 150k tiap bulan tgl 1`',
        '• `tambah rutin kost 1.5jt tgl 1`',
        '',
        '*Perintah terkait:*',
        '• `list langganan` / `cek langganan` / `langganan apa aja` — cek daftar aktif',
        '• `stop langganan <nama>` / `hapus rutin <nama>` — nonaktifkan langganan',
        '',
        '_Sistem akan mencatatnya secara otomatis setiap bulan ke Google Sheets sesuai tanggal jatuh tempo._'
      ]);
    }

    const helpText = [
      'Bot ini mendukung pencatatan dan pengecekan keuangan dengan bahasa sehari-hari. Anda bisa mengirim pesan santai tanpa format kaku.',
      '',
      '*Contoh Catat Pengeluaran:*',
      '• `beli kopi 25rb` / `kopi 20k`',
      '• `bensin 50k` / `beli bensin 50.000`',
      '• `makan siang nasi padang 25rb`',
      '• `bayar listrik 150 ribu`',
      '• `parkir motor 2000`',
      '',
      '*Contoh Catat Pemasukan:*',
      '• `gajian 5.000.000`',
      '• `dapat transferan 500rb`',
      '• `bonus 250k`',
      '',
      '*Cek Rekap & Saldo:*',
      '• `pengeluaran hari ini` / `rekap minggu ini`',
      '• `saldo sekarang` / `laporan bulan ini`',
      '• `list pemasukan dan pengeluaran 27 - 28 september`',
      '',
      '*Koreksi Transaksi:*',
      '• `hapus terakhir` / `batal`',
      '• `edit terakhir 30000` / `edit jadi 35k`',
      '• `hapus transaksi 27 september 2026`',
      '',
      '*Scan Struk:*',
      'Kirim foto struk belanja langsung ke bot ini untuk diproses lebih lanjut.',
      'Untuk tanggal tertentu, tulis tanggal di caption foto, misalnya `26 September` atau `23 Agustus 2025`.',
      '',
      'Ketik `menu` untuk melihat semua opsi cepat.'
    ];

    return buildSuccessTemplate('👋 *Panduan Penggunaan Bot Keuangan*', helpText);
  },
};

/**
 * Main coordinator to handle incoming user chat message
 */
export async function handleUserMessage(
  rawText: string,
  userId?: string
): Promise<ExecutionResult> {
  const categoryMap = await getCategoryMappings();
  let parsed: ParsedIntent = parseMessage(rawText, categoryMap);

  // Fallback ke Gemini AI Natural Language Understanding jika regex belum mengenali
  if ((parsed.intent === 'UNKNOWN' || parsed.intent === 'EDIT_LAST') && process.env.GEMINI_API_KEY) {
    try {
      const aiParsed = await parseNaturalLanguageWithAI(rawText, categoryMap);
      if (aiParsed && aiParsed.intent !== 'UNKNOWN') {
        parsed = aiParsed;
      }
    } catch (err: any) {
      console.warn('[handleUserMessage] AI NLU fallback warning:', err?.message || err);
    }
  }

  switch (parsed.intent) {
    case 'RECORD_EXPENSE':
      return await handleRecordExpense(parsed, userId);

    case 'RECORD_INCOME':
      return await handleRecordIncome(parsed, userId);

    case 'SUMMARY_DAY':
    case 'SUMMARY_WEEK':
    case 'SUMMARY_MONTH':
    case 'SUMMARY_PROFIT':
      return await handleSummary(parsed.period || 'month', parsed.targetDate, parsed.displayDate, userId, parsed.startDate, parsed.endDate, parsed.category, parsed.intent === 'SUMMARY_PROFIT');

    case 'LIST_EXPENSES':
      return await handleListTransactions('expense', parsed.period || 'day', parsed.targetDate, parsed.displayDate, userId, parsed.startDate, parsed.endDate, parsed.category);

    case 'LIST_INCOMES':
      return await handleListTransactions('income', parsed.period || 'day', parsed.targetDate, parsed.displayDate, userId, parsed.startDate, parsed.endDate, parsed.category);

    case 'LIST_ALL':
      return await handleListAllTransactions(parsed.period || 'day', parsed.targetDate, parsed.displayDate, userId, parsed.startDate, parsed.endDate);

    case 'DELETE_LAST':
      return await handleDeleteLast(parsed, userId);

    case 'EDIT_LAST':
      return await handleEditLast(parsed, userId);

    case 'MENU':
      return handleMenu(userId);

    case 'DOWNLOAD_SPREADSHEET':
      return await handleDownloadSpreadsheet(userId);

    case 'AI_ADVICE':
      return await handleAiAdvice(userId);

    case 'ADD_RECURRING':
      return await handleAddRecurring(parsed, userId);

    case 'LIST_RECURRING':
      return await handleListRecurring(userId);

    case 'DELETE_RECURRING':
      return await handleDeleteRecurring(parsed.name || '', userId);

    case 'HELP_RECURRING':
      return handleHelpRecurring();

    case 'HELP':
    case 'UNKNOWN':
    default:
      return handleHelp(rawText);
  }
}

/**
 * Handle expense recording
 */
async function handleRecordExpense(parsed: ParsedIntent, userId?: string): Promise<ExecutionResult> {
  if (!parsed.amount) {
    return {
      success: false,
      replyText: '⚠️ Jumlah pengeluaran tidak terbaca. Contoh: `kopi 25rb` atau `beli bensin 50k`'
    };
  }

  const tx: Transaction = {
    id: crypto.randomUUID(),
    user_id: userId,
    type: 'expense',
    amount: parsed.amount,
    category: parsed.category || 'Lainnya',
    note: parsed.note || 'Pengeluaran',
    raw_message: parsed.rawMessage,
    source: 'manual',
    created_at: resolveTransactionCreatedAt(parsed.targetDate)
  };

  await appendTransaction(tx);

  const replyText = responseTemplates.recordExpense({
    amount: tx.amount,
    category: tx.category,
    note: tx.note,
    date: parsed.targetDate ? formatDateLabel(parsed.targetDate) : undefined,
    time: formatDate(tx.created_at)
  });

  return { success: true, replyText };
}

/**
 * Handle income recording
 */
async function handleRecordIncome(parsed: ParsedIntent, userId?: string): Promise<ExecutionResult> {
  if (!parsed.amount) {
    return {
      success: false,
      replyText: '⚠️ Jumlah pemasukan tidak valid. Contoh: `masuk 5000000 gaji bulanan`'
    };
  }

  const tx: Transaction = {
    id: crypto.randomUUID(),
    user_id: userId,
    type: 'income',
    amount: parsed.amount,
    category: parsed.category || 'Income',
    note: parsed.note || 'Pemasukan',
    raw_message: parsed.rawMessage,
    source: 'manual',
    created_at: resolveTransactionCreatedAt(parsed.targetDate)
  };

  await appendTransaction(tx);

  const replyText = responseTemplates.recordIncome({
    amount: tx.amount,
    category: tx.category,
    note: tx.note,
    date: parsed.targetDate ? formatDateLabel(parsed.targetDate) : undefined,
    time: formatDate(tx.created_at)
  });

  return { success: true, replyText };
}

/**
 * Check if an ISO date string matches a target date string (YYYY-MM-DD) in Asia/Jakarta timezone
 */
function matchesTargetDate(isoStr: string, targetDate: string): boolean {
  if (!isoStr || !targetDate) return false;
  if (isoStr.startsWith(targetDate)) return true;
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return false;
    const jakartaDate = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    return jakartaDate === targetDate;
  } catch {
    return false;
  }
}

function matchesDateRange(isoStr: string, startDate?: string, endDate?: string): boolean {
  if (!isoStr || !startDate || !endDate) return false;
  try {
    const txDate = new Date(isoStr);
    if (isNaN(txDate.getTime())) return false;
    const txMs = txDate.getTime();
    const startMs = new Date(`${startDate}T00:00:00+07:00`).getTime();
    const endMs = new Date(`${endDate}T23:59:59+07:00`).getTime();
    return txMs >= startMs && txMs <= endMs;
  } catch {
    return false;
  }
}

function resolveTransactionCreatedAt(targetDate?: string): string {
  if (!targetDate) return new Date().toISOString();
  const [year, month, day] = targetDate.split('-').map(Number);
  if (!year || !month || !day) return new Date().toISOString();
  return new Date(`${targetDate}T12:00:00+07:00`).toISOString();
}

/**
 * Handle summary reports (day, week, month) or specific target date
 */
async function handleSummary(
  period: 'day' | 'week' | 'month' | 'year',
  targetDate?: string,
  displayDate?: string,
  userId?: string,
  startDate?: string,
  endDate?: string,
  category?: string,
  forceProfitSummary = false
): Promise<ExecutionResult> {
  const transactions = await getAllTransactions(userId);
  const now = new Date();

  let filtered: Transaction[];
  let titlePeriod = '';

  if (targetDate) {
    titlePeriod = displayDate || formatDateLabel(targetDate);
    filtered = transactions.filter((t) => matchesTargetDate(t.created_at, targetDate));
  } else if (startDate && endDate) {
    titlePeriod = displayDate || formatDateRangeLabel(startDate, endDate, `${startDate} - ${endDate}`);
    filtered = transactions.filter((t) => matchesDateRange(t.created_at, startDate, endDate));
  } else {
    let computedStart: Date;

    if (period === 'day') {
      computedStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      titlePeriod = displayDate || `Hari Ini (${now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })})`;
    } else if (period === 'week') {
      const day = now.getDay() || 7;
      computedStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1, 0, 0, 0);
      titlePeriod = displayDate || `Minggu Ini (${computedStart.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} - ${now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })})`;
    } else if (period === 'year') {
      computedStart = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
      titlePeriod = displayDate || `Tahun Ini (${now.getFullYear()})`;
    } else {
      computedStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      titlePeriod = displayDate || `Bulan Ini (${now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })})`;
    }

    filtered = transactions.filter((t) => {
      try {
        const txDate = new Date(t.created_at);
        return txDate >= computedStart && txDate <= now;
      } catch {
        return false;
      }
    });
  }

  if (category) {
    filtered = filtered.filter((t) => t.category.toLowerCase() === category.toLowerCase());
  }

  const expenses = filtered.filter((t) => t.type === 'expense');
  const incomes = filtered.filter((t) => t.type === 'income');

  const totalExpense = expenses.reduce((sum, t) => sum + t.amount, 0);
  const totalIncome = incomes.reduce((sum, t) => sum + t.amount, 0);
  const netSavings = totalIncome - totalExpense;
  const isProfitSummary = forceProfitSummary || /laba|profit|keuntungan|untung|saldo\s+bersih/i.test(titlePeriod) || period === 'year';

  const categoryTotals: Record<string, number> = {};
  for (const t of expenses) {
    categoryTotals[t.category] = (categoryTotals[t.category] || 0) + t.amount;
  }

  const categoryLines = Object.entries(categoryTotals)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, amt]) => {
      const pct = totalExpense > 0 ? Math.round((amt / totalExpense) * 100) : 0;
      return `• *${cat}:* ${formatRp(amt)} (${pct}%)`;
    })
    .join('\n');

  const itemsList = targetDate ? filtered : filtered.slice(-3).reverse();
  const recentLines = itemsList
    .map((t, idx) => {
      let timeStr = '';
      try {
        const d = new Date(t.created_at);
        timeStr = d.toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Jakarta'
        });
      } catch {
        timeStr = '';
      }
      const timeTag = timeStr ? ` (${timeStr})` : '';
      const prefix = targetDate ? `${idx + 1}. ` : '• ';
      return `${prefix}${t.type === 'expense' ? '🔴' : '🟢'} ${formatRp(t.amount)} — ${t.note || t.category}${timeTag}`;
    })
    .join('\n');

  let replyText =
    `📊 *Ringkasan ${isProfitSummary ? 'Laba / Keuntungan' : 'Transaksi'} — ${titlePeriod}*\n\n` +
    `🔴 Total Pengeluaran: *${formatRp(totalExpense)}* (${expenses.length})\n` +
    `🟢 Total Pemasukan: *${formatRp(totalIncome)}* (${incomes.length})\n` +
    `📈 ${isProfitSummary ? 'Laba Bersih' : 'Tabungan Bersih'}: *${formatRp(netSavings)}*\n` +
    `📝 Total Transaksi: *${filtered.length}*\n\n`;

  if (categoryLines) {
    replyText += `*Rincian Pengeluaran Per Kategori:*\n${categoryLines}\n\n`;
  }

  if (recentLines) {
    replyText += targetDate ? `*Daftar Transaksi:*\n${recentLines}` : `*Transaksi Terkini:*\n${recentLines}`;
  } else {
    replyText += `_Belum ada transaksi di periode ini._`;
  }

  return { success: true, replyText };
}

/**
 * Handle dedicated full transaction list for expenses or incomes
 */
async function handleListTransactions(
  type: 'expense' | 'income',
  period: 'day' | 'week' | 'month' | 'year',
  targetDate?: string,
  displayDate?: string,
  userId?: string,
  startDate?: string,
  endDate?: string,
  category?: string
): Promise<ExecutionResult> {
  const transactions = await getAllTransactions(userId);
  const now = new Date();

  let titlePeriod = '';
  let inRange: Transaction[];

  if (targetDate) {
    titlePeriod = displayDate || targetDate;
    inRange = transactions.filter(t => matchesTargetDate(t.created_at, targetDate));
  } else if (startDate && endDate) {
    titlePeriod = displayDate || `${startDate} - ${endDate}`;
    inRange = transactions.filter(t => matchesDateRange(t.created_at, startDate, endDate));
  } else {
    let computedStart: Date;
    if (period === 'day') {
      computedStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      titlePeriod = displayDate || `Hari Ini (${now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })})`;
    } else if (period === 'week') {
      const day = now.getDay() || 7;
      computedStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1, 0, 0, 0);
      titlePeriod = displayDate || `Minggu Ini (${computedStart.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} - ${now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })})`;
    } else if (period === 'year') {
      computedStart = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
      titlePeriod = displayDate || `Tahun Ini (${now.getFullYear()})`;
    } else {
      computedStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      titlePeriod = displayDate || `Bulan Ini (${now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })})`;
    }

    inRange = transactions.filter((t) => {
      try {
        const txDate = new Date(t.created_at);
        return txDate >= computedStart && txDate <= now;
      } catch {
        return false;
      }
    });
  }

  // Filter exclusively by transaction type
  let list = inRange.filter((t) => t.type === type);
  if (category) {
    list = list.filter((t) => t.category.toLowerCase() === category.toLowerCase());
  }
  const isExpense = type === 'expense';
  const typeLabel = isExpense ? 'Pengeluaran' : 'Pemasukan';
  const emoji = isExpense ? '🔴' : '🟢';

  if (list.length === 0) {
    const emptyReply =
      `📋 *Daftar Lengkap ${typeLabel} — ${titlePeriod}*\n\n` +
      `_Belum ada catatan ${typeLabel.toLowerCase()} di periode ini._\n\n` +
      `💡 Ketik pesan santai seperti \`${isExpense ? 'beli kopi 25rb' : 'dapat transferan 500rb'}\` untuk mencatat transaksi baru.`;
    return { success: true, replyText: emptyReply };
  }

  const totalAmount = list.reduce((sum, t) => sum + t.amount, 0);

  // Group by category for subtotal
  const categoryTotals: Record<string, number> = {};
  for (const t of list) {
    categoryTotals[t.category] = (categoryTotals[t.category] || 0) + t.amount;
  }

  // Format each line
  const itemsText = list
    .map((t, idx) => {
      let timeStr = '';
      try {
        const d = new Date(t.created_at);
        timeStr = d.toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Jakarta'
        });
      } catch {
        timeStr = '';
      }
      const timeTag = timeStr ? ` (${timeStr})` : '';
      const noteStr = t.note || t.category;
      return `${idx + 1}. ${emoji} *${formatRp(t.amount)}* — ${noteStr} _[${t.category}]_${timeTag}`;
    })
    .join('\n');

  // Breakdown lines
  const catLines = Object.entries(categoryTotals)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, amt]) => `• ${cat}: *${formatRp(amt)}*`)
    .join('\n');

  let replyText =
    `📋 *Daftar Lengkap ${typeLabel} — ${titlePeriod}*\n\n` +
    itemsText +
    `\n\n━━━━━━━━━━━━━━━━━━\n` +
    `💰 *Total ${typeLabel}:* *${formatRp(totalAmount)}* (${list.length} transaksi)\n`;

  if (Object.keys(categoryTotals).length > 1) {
    replyText += `\n🏷️ *Rincian Kategori:*\n${catLines}`;
  }

  return { success: true, replyText };
}

/**
 * Handle combined full transaction list for both expenses and incomes
 */
async function handleListAllTransactions(
  period: 'day' | 'week' | 'month' | 'year',
  targetDate?: string,
  displayDate?: string,
  userId?: string,
  startDate?: string,
  endDate?: string
): Promise<ExecutionResult> {
  const transactions = await getAllTransactions(userId);
  const now = new Date();

  let titlePeriod = '';
  let inRange: Transaction[];

  if (targetDate) {
    titlePeriod = displayDate || targetDate;
    inRange = transactions.filter(t => matchesTargetDate(t.created_at, targetDate));
  } else if (startDate && endDate) {
    titlePeriod = displayDate || `${startDate} - ${endDate}`;
    inRange = transactions.filter(t => matchesDateRange(t.created_at, startDate, endDate));
  } else {
    let computedStart: Date;
    if (period === 'day') {
      computedStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      titlePeriod = displayDate || `Hari Ini (${now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })})`;
    } else if (period === 'week') {
      const day = now.getDay() || 7;
      computedStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1, 0, 0, 0);
      titlePeriod = displayDate || `Minggu Ini (${computedStart.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} - ${now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })})`;
    } else if (period === 'year') {
      computedStart = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
      titlePeriod = displayDate || `Tahun Ini (${now.getFullYear()})`;
    } else {
      computedStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      titlePeriod = displayDate || `Bulan Ini (${now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })})`;
    }

    inRange = transactions.filter((t) => {
      try {
        const txDate = new Date(t.created_at);
        return txDate >= computedStart && txDate <= now;
      } catch {
        return false;
      }
    });
  }

  const expenses = inRange.filter(t => t.type === 'expense');
  const incomes = inRange.filter(t => t.type === 'income');

  const totalExpense = expenses.reduce((sum, t) => sum + t.amount, 0);
  const totalIncome = incomes.reduce((sum, t) => sum + t.amount, 0);
  const netSavings = totalIncome - totalExpense;

  if (inRange.length === 0) {
    return {
      success: true,
      replyText:
        `📋 *Daftar Lengkap Transaksi — ${titlePeriod}*\n\n` +
        `_Belum ada catatan transaksi (pemasukan maupun pengeluaran) di periode ini._\n\n` +
        `💡 Ketik pesan santai seperti \`beli kopi 25rb\` atau \`dapat transferan 500rb\` untuk mulai mencatat.`
    };
  }

  const formatItem = (t: Transaction, idx: number, emoji: string) => {
    let timeStr = '';
    try {
      const d = new Date(t.created_at);
      timeStr = d.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Jakarta'
      });
    } catch {
      timeStr = '';
    }
    const timeTag = timeStr ? ` (${timeStr})` : '';
    const noteStr = t.note || t.category;
    return `${idx + 1}. ${emoji} *${formatRp(t.amount)}* — ${noteStr} _[${t.category}]_${timeTag}`;
  };

  const sections: string[] = [];

  // Incomes Section
  if (incomes.length > 0) {
    const incomeItems = incomes.map((t, idx) => formatItem(t, idx, '🟢')).join('\n');
    sections.push(
      `🟢 *PEMASUKAN (${incomes.length} transaksi):*\n` +
      incomeItems +
      `\n💰 *Total Pemasukan:* *${formatRp(totalIncome)}*`
    );
  } else {
    sections.push(`🟢 *PEMASUKAN:* _(Belum ada pemasukan di periode ini)_`);
  }

  // Expenses Section
  if (expenses.length > 0) {
    const expenseItems = expenses.map((t, idx) => formatItem(t, idx, '🔴')).join('\n');
    sections.push(
      `🔴 *PENGELUARAN (${expenses.length} transaksi):*\n` +
      expenseItems +
      `\n💰 *Total Pengeluaran:* *${formatRp(totalExpense)}*`
    );
  } else {
    sections.push(`🔴 *PENGELUARAN:* _(Belum ada pengeluaran di periode ini)_`);
  }

  const replyText =
    `📋 *Daftar Lengkap Transaksi — ${titlePeriod}*\n\n` +
    sections.join('\n\n') +
    `\n\n━━━━━━━━━━━━━━━━━━\n` +
    `💵 *Total Pemasukan:* *${formatRp(totalIncome)}*\n` +
    `💳 *Total Pengeluaran:* *${formatRp(totalExpense)}*\n` +
    `📈 *Tabungan Bersih:* *${formatRp(netSavings)}* (${inRange.length} total transaksi)`;

  return { success: true, replyText };
}

/**
 * Handle delete last transaction
 */
async function handleDeleteLast(parsed?: ParsedIntent, userId?: string): Promise<ExecutionResult> {
  const criteria = {
    amount: parsed?.amount,
    query: parsed?.note,
    userId
  };

  const deleted = await deleteTransaction({
    ...criteria,
    targetDate: parsed?.targetDate
  });
  if (!deleted) {
    const dateInfo = parsed?.targetDate || parsed?.startDate ? ` pada ${formatDateRangeLabel(parsed?.startDate, parsed?.endDate, parsed?.targetDate)}` : '';
    return {
      success: false,
      replyText: `⚠️ Tidak ada transaksi yang sesuai atau dapat dihapus${dateInfo}.`
    };
  }

  const replyText = responseTemplates.deleteTransaction({
    type: deleted.type,
    amount: deleted.amount,
    note: deleted.note || deleted.category,
    category: deleted.category,
    date: deleted.created_at ? formatDateLabel(deleted.created_at) : undefined
  });

  return { success: true, replyText };
}

/**
 * Handle edit last transaction amount
 */
async function handleEditLast(parsed: ParsedIntent, userId?: string): Promise<ExecutionResult> {
  const newAmount = parsed.amount;
  const newNote = parsed.note;
  const targetQuery = parsed.name;

  if ((!newAmount || newAmount <= 0) && !newNote && !parsed.category) {
    return {
      success: false,
      replyText: 'Sebutkan perubahan yang diinginkan. Contoh: ubah kategori bensin jadi Transport, ganti catatan transaksi terakhir menjadi bensin pertalite, atau ubah kopi jadi 35rb kategori Food.'
    };
  }

  const categoryMap = await getCategoryMappings();
  const detected = newNote ? detectCategory(newNote, undefined, categoryMap) : undefined;
  const newCategory = parsed.category || (detected && detected !== 'Lainnya' ? detected : undefined);

  const result = await editTransaction({
    criteria: targetQuery ? { query: targetQuery, userId, targetDate: parsed.targetDate } : { userId, targetDate: parsed.targetDate },
    newAmount: newAmount && newAmount > 0 ? newAmount : undefined,
    newNote,
    newCategory,
    userId,
    targetDate: parsed.targetDate
  });

  if (!result) {
    const dateInfo = parsed.targetDate || parsed.startDate ? ` pada ${formatDateRangeLabel(parsed.startDate, parsed.endDate, parsed.targetDate)}` : '';
    return {
      success: false,
      replyText: targetQuery
        ? `⚠️ Tidak ditemukan transaksi yang cocok dengan "${targetQuery}"${dateInfo}.`
        : `⚠️ Tidak ada transaksi yang dapat diubah${dateInfo}.`
    };
  }

  let changesText = '';
  if (result.previous.amount !== result.updated.amount) {
    changesText += `• Jumlah: ${formatRp(result.previous.amount)} ➔ *${formatRp(result.updated.amount)}* 🎯\n`;
  } else {
    changesText += `• Jumlah: *${formatRp(result.updated.amount)}*\n`;
  }

  if (result.previous.note !== result.updated.note) {
    changesText += `• Keterangan: "${result.previous.note}" ➔ *"${result.updated.note}"*\n`;
  } else {
    changesText += `• Keterangan: *${result.updated.note || result.updated.category}*\n`;
  }

  changesText += `• Kategori: ${result.updated.category}\n`;

  const replyText = responseTemplates.editTransaction({
    previousLabel: changesText.trim(),
    updatedLabel: '_Perubahan telah disimpan ke Google Sheets._',
    date: result.updated.created_at ? formatDateLabel(result.updated.created_at) : undefined
  });

  return { success: true, replyText };
}

/**
 * Handle interactive menu
 */
function handleMenu(userId?: string): ExecutionResult {
  const headerText = '🤖 Expense Bot Menu';
  const bodyText = responseTemplates.menu({ userId }).replace(/^.*\n\n/, '');

  const sections = [
    {
      title: '📊 Ringkasan Keuangan',
      rows: [
        { id: 'ringkasan hari', title: 'Ringkasan Hari Ini', description: 'Lihat pengeluaran hari ini' },
        { id: 'ringkasan minggu', title: 'Ringkasan Minggu Ini', description: 'Lihat pengeluaran 7 hari ini' },
        { id: 'ringkasan bulan', title: 'Ringkasan Bulan Ini', description: 'Lihat rekapitulasi bulanan' },
      ]
    },
    {
      title: '🤖 Fitur Pintar',
      rows: [
        { id: 'saran', title: 'Saran AI Finansial', description: 'Dapatkan insight hemat dari Gemini AI' },
        { id: 'list langganan', title: 'Langganan & Tagihan Rutin', description: 'Lihat tagihan & langganan aktif' }
      ]
    },
    {
      title: '✏️ Koreksi Cepat',
      rows: [
        { id: 'hapus terakhir', title: 'Hapus Terakhir', description: 'Batalkan transaksi paling baru' }
      ]
    }
  ];

  return {
    success: true,
    replyText: responseTemplates.menu({ userId }),
    interactiveType: 'list',
    interactiveData: {
      header: headerText,
      body: bodyText,
      button: 'Lihat Pilihan Menu',
      sections
    }
  };
}

/**
 * Handle AI financial advice
 */
async function handleAiAdvice(userId?: string): Promise<ExecutionResult> {
  const transactions = await getAllTransactions(userId);
  // Filter last 30 days
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const recent = transactions.filter(t => {
    try {
      return new Date(t.created_at) >= thirtyDaysAgo;
    } catch {
      return true;
    }
  });

  const replyText = await generateFinancialAdvice(recent, '30 Hari Terakhir');
  return { success: true, replyText };
}

async function handleDownloadSpreadsheet(userId?: string): Promise<ExecutionResult> {
  if (!userId) {
    return {
      success: false,
      replyText: '⚠️ Fitur unduh spreadsheet membutuhkan identitas pengguna aktif. Silakan coba lagi dari chat yang terautentikasi.'
    };
  }

  const userBaseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://wa-bot-tau.vercel.app';
  const exportUrl = `${userBaseUrl.replace(/\/$/, '')}/api/download-spreadsheet?userId=${encodeURIComponent(userId)}`;

  return {
    success: true,
    replyText: `📤 *Download Spreadsheet Pribadi*

Data yang akan diunduh hanya mencakup transaksi milik user ini saja, dan tidak akan menampilkan data user lain.

🔐 *Privasi aktif:* data user lain akan dibuang dari file export.

👉 Klik tautan berikut untuk mengunduh:
${exportUrl}
`
  };
}

/**
 * Handle adding a recurring expense
 */
async function handleAddRecurring(parsed: ParsedIntent, userId?: string): Promise<ExecutionResult> {
  if (!parsed.name || !parsed.amount || !parsed.dueDate) {
    return {
      success: false,
      replyText: '⚠️ Format belum lengkap. Contoh: `langganan netflix 186k tgl 5` atau `tambah rutin spotify 55rb tgl 20`'
    };
  }

  const formattedName = parsed.name.charAt(0).toUpperCase() + parsed.name.slice(1);

  const item: RecurringExpense = {
    id: crypto.randomUUID(),
    user_id: userId,
    name: formattedName,
    amount: parsed.amount,
    category: parsed.category || 'Bills',
    due_date: parsed.dueDate,
    active: true,
    created_at: new Date().toISOString()
  };

  await addRecurringExpense(item);

  const replyText = responseTemplates.addRecurring({
    name: item.name,
    amount: item.amount,
    category: item.category,
    dueDate: item.due_date
  });

  return { success: true, replyText };
}

/**
 * Handle listing active recurring expenses
 */
async function handleListRecurring(userId?: string): Promise<ExecutionResult> {
  const list = await getRecurringExpenses(userId);
  const activeList = list.filter(r => r.active);

  if (activeList.length === 0) {
    return {
      success: true,
      replyText:
        `📋 *Pengeluaran Rutin & Langganan Kosong*\n\n` +
        `Anda belum memiliki daftar langganan atau pengeluaran rutin yang aktif.\n\n` +
        `💡 *Cara Menambahkan (Bebas & Fleksibel):*\n` +
        `• \`langganan netflix 186k tgl 5\`\n` +
        `• \`langganan spotify 55rb tiap tgl 25\`\n` +
        `• \`tambah langganan wifi indihome 350k tgl 20\`\n` +
        `• \`rutin gym 150k tgl 1\``
    };
  }

  const totalMonthly = activeList.reduce((sum, r) => sum + r.amount, 0);
  const itemsText = activeList
    .map((r, i) => `${i + 1}. *${r.name}* — ${formatRp(r.amount)} — Jatuh tempo tiap ${r.due_date} [${r.category}]`)
    .join('\n');

  const replyText =
    `📋 *Daftar Pengeluaran Rutin & Langganan Aktif*\n\n` +
    `${itemsText}\n\n` +
    `💰 *Total Rutin Bulanan:* *${formatRp(totalMonthly)}*\n` +
    `🔢 *Jumlah Aktif:* *${activeList.length}* item\n\n` +
    `_Stop: \`stop langganan <nama>\`_\n` +
    `_Tambah: \`langganan <nama> <nominal> tgl <hari>\`_`;

  return { success: true, replyText };
}

/**
 * Handle disabling a recurring expense
 */
async function handleDeleteRecurring(name: string, userId?: string): Promise<ExecutionResult> {
  if (!name) {
    return {
      success: false,
      replyText: '⚠️ Mohon sebutkan nama langganan / rutin. Contoh: `stop langganan netflix` atau `hapus rutin spotify`'
    };
  }

  const displayName = name.charAt(0).toUpperCase() + name.slice(1);
  const ok = await toggleRecurringExpense(name, false, userId);
  if (!ok) {
    return {
      success: false,
      replyText: `⚠️ Langganan / pengeluaran rutin dengan nama *${displayName}* tidak ditemukan.`
    };
  }

  const replyText = responseTemplates.disableRecurring({ name: displayName });
  return { success: true, replyText };
}

/**
 * Handle recurring help / tutorial message
 */
function handleHelpRecurring(): ExecutionResult {
  const replyText = responseTemplates.help({ isRecurring: true });
  return { success: true, replyText };
}

/**
 * Handle unknown / help message
 */
function handleHelp(rawText: string): ExecutionResult {
  const lower = (rawText || '').toLowerCase();
  if (/\b(?:rutin|langganan|subscription|subs)\b/i.test(lower)) {
    return handleHelpRecurring();
  }

  return { success: true, replyText: responseTemplates.help({ rawText }) };
}
