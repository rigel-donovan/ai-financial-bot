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

/**
 * Main coordinator to handle incoming user chat message
 */
export async function handleUserMessage(
  rawText: string,
  _senderPhone?: string
): Promise<ExecutionResult> {
  const categoryMap = await getCategoryMappings();
  let parsed: ParsedIntent = parseMessage(rawText, categoryMap);

  // Fallback ke Gemini AI Natural Language Understanding jika regex belum mengenali
  if (parsed.intent === 'UNKNOWN' && process.env.GEMINI_API_KEY) {
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
      return await handleRecordExpense(parsed);

    case 'RECORD_INCOME':
      return await handleRecordIncome(parsed);

    case 'SUMMARY_DAY':
    case 'SUMMARY_WEEK':
    case 'SUMMARY_MONTH':
      return await handleSummary(parsed.period || 'month', parsed.targetDate, parsed.displayDate);

    case 'LIST_EXPENSES':
      return await handleListTransactions('expense', parsed.period || 'day', parsed.targetDate, parsed.displayDate);

    case 'LIST_INCOMES':
      return await handleListTransactions('income', parsed.period || 'day', parsed.targetDate, parsed.displayDate);

    case 'LIST_ALL':
      return await handleListAllTransactions(parsed.period || 'day', parsed.targetDate, parsed.displayDate);

    case 'DELETE_LAST':
      return await handleDeleteLast(parsed);

    case 'EDIT_LAST':
      return await handleEditLast(parsed);

    case 'MENU':
      return handleMenu();

    case 'AI_ADVICE':
      return await handleAiAdvice();

    case 'ADD_RECURRING':
      return await handleAddRecurring(parsed);

    case 'LIST_RECURRING':
      return await handleListRecurring();

    case 'DELETE_RECURRING':
      return await handleDeleteRecurring(parsed.name || '');

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
async function handleRecordExpense(parsed: ParsedIntent): Promise<ExecutionResult> {
  if (!parsed.amount) {
    return {
      success: false,
      replyText: '⚠️ Jumlah pengeluaran tidak terbaca. Contoh: `kopi 25rb` atau `beli bensin 50k`'
    };
  }

  const tx: Transaction = {
    id: crypto.randomUUID(),
    type: 'expense',
    amount: parsed.amount,
    category: parsed.category || 'Lainnya',
    note: parsed.note || 'Pengeluaran',
    raw_message: parsed.rawMessage,
    source: 'manual',
    created_at: new Date().toISOString()
  };

  await appendTransaction(tx);

  const replyText =
    `✅ *Pengeluaran Dicatat!*\n\n` +
    `💰 *Jumlah:* ${formatRp(tx.amount)}\n` +
    `🏷️ *Kategori:* ${tx.category}\n` +
    `📝 *Catatan:* ${tx.note}\n` +
    `📅 *Waktu:* ${formatDate(tx.created_at)}`;

  return { success: true, replyText };
}

/**
 * Handle income recording
 */
async function handleRecordIncome(parsed: ParsedIntent): Promise<ExecutionResult> {
  if (!parsed.amount) {
    return {
      success: false,
      replyText: '⚠️ Jumlah pemasukan tidak valid. Contoh: `masuk 5000000 gaji bulanan`'
    };
  }

  const tx: Transaction = {
    id: crypto.randomUUID(),
    type: 'income',
    amount: parsed.amount,
    category: parsed.category || 'Income',
    note: parsed.note || 'Pemasukan',
    raw_message: parsed.rawMessage,
    source: 'manual',
    created_at: new Date().toISOString()
  };

  await appendTransaction(tx);

  const replyText =
    `✅ *Pemasukan Dicatat!*\n\n` +
    `💵 *Jumlah:* ${formatRp(tx.amount)}\n` +
    `🏷️ *Kategori:* ${tx.category}\n` +
    `📝 *Catatan:* ${tx.note}\n` +
    `📅 *Waktu:* ${formatDate(tx.created_at)}`;

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

/**
 * Handle summary reports (day, week, month) or specific target date
 */
async function handleSummary(
  period: 'day' | 'week' | 'month',
  targetDate?: string,
  displayDate?: string
): Promise<ExecutionResult> {
  const transactions = await getAllTransactions();
  const now = new Date();

  let filtered: Transaction[];
  let titlePeriod = '';

  if (targetDate) {
    titlePeriod = displayDate || targetDate;
    filtered = transactions.filter(t => matchesTargetDate(t.created_at, targetDate));
  } else {
    let startDate: Date;
    if (period === 'day') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      titlePeriod = displayDate || `Hari Ini (${now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })})`;
    } else if (period === 'week') {
      // Start of week (Monday)
      const day = now.getDay() || 7;
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1, 0, 0, 0);
      titlePeriod = displayDate || `Minggu Ini (${startDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} - ${now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })})`;
    } else {
      // Month
      startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      titlePeriod = displayDate || `Bulan Ini (${now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })})`;
    }

    filtered = transactions.filter(t => {
      try {
        const txDate = new Date(t.created_at);
        return txDate >= startDate && txDate <= now;
      } catch {
        return false;
      }
    });
  }

  const expenses = filtered.filter(t => t.type === 'expense');
  const incomes = filtered.filter(t => t.type === 'income');

  const totalExpense = expenses.reduce((sum, t) => sum + t.amount, 0);
  const totalIncome = incomes.reduce((sum, t) => sum + t.amount, 0);
  const netSavings = totalIncome - totalExpense;

  // Breakdown by category
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

  // Transactions list
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
    `📊 *Ringkasan Transaksi — ${titlePeriod}*\n\n` +
    `🔴 Total Pengeluaran: *${formatRp(totalExpense)}* (${expenses.length})\n` +
    `🟢 Total Pemasukan: *${formatRp(totalIncome)}* (${incomes.length})\n` +
    `📈 Tabungan Bersih: *${formatRp(netSavings)}*\n` +
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
  period: 'day' | 'week' | 'month',
  targetDate?: string,
  displayDate?: string
): Promise<ExecutionResult> {
  const transactions = await getAllTransactions();
  const now = new Date();

  let titlePeriod = '';
  let inRange: Transaction[];

  if (targetDate) {
    titlePeriod = displayDate || targetDate;
    inRange = transactions.filter(t => matchesTargetDate(t.created_at, targetDate));
  } else {
    let startDate: Date;
    if (period === 'day') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      titlePeriod = displayDate || `Hari Ini (${now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })})`;
    } else if (period === 'week') {
      const day = now.getDay() || 7;
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1, 0, 0, 0);
      titlePeriod = displayDate || `Minggu Ini (${startDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} - ${now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })})`;
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      titlePeriod = displayDate || `Bulan Ini (${now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })})`;
    }

    inRange = transactions.filter((t) => {
      try {
        const txDate = new Date(t.created_at);
        return txDate >= startDate && txDate <= now;
      } catch {
        return false;
      }
    });
  }

  // Filter exclusively by transaction type
  const list = inRange.filter((t) => t.type === type);
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
  period: 'day' | 'week' | 'month',
  targetDate?: string,
  displayDate?: string
): Promise<ExecutionResult> {
  const transactions = await getAllTransactions();
  const now = new Date();

  let titlePeriod = '';
  let inRange: Transaction[];

  if (targetDate) {
    titlePeriod = displayDate || targetDate;
    inRange = transactions.filter(t => matchesTargetDate(t.created_at, targetDate));
  } else {
    let startDate: Date;
    if (period === 'day') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      titlePeriod = displayDate || `Hari Ini (${now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })})`;
    } else if (period === 'week') {
      const day = now.getDay() || 7;
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day + 1, 0, 0, 0);
      titlePeriod = displayDate || `Minggu Ini (${startDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} - ${now.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })})`;
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
      titlePeriod = displayDate || `Bulan Ini (${now.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })})`;
    }

    inRange = transactions.filter((t) => {
      try {
        const txDate = new Date(t.created_at);
        return txDate >= startDate && txDate <= now;
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
async function handleDeleteLast(parsed?: ParsedIntent): Promise<ExecutionResult> {
  const criteria = parsed
    ? {
        amount: parsed.amount,
        query: parsed.note
      }
    : undefined;

  const deleted = await deleteTransaction(criteria);
  if (!deleted) {
    return {
      success: false,
      replyText: '⚠️ Tidak ada transaksi yang sesuai atau dapat dihapus.'
    };
  }

  const replyText =
    `🗑️ *Transaksi Berhasil Dibatalkan/Dihapus!*\n\n` +
    `• Jenis: ${deleted.type === 'expense' ? 'Pengeluaran' : 'Pemasukan'}\n` +
    `• Jumlah: ${formatRp(deleted.amount)}\n` +
    `• Keterangan: ${deleted.note || deleted.category}\n` +
    `• Kategori: ${deleted.category}\n\n` +
    `_Data telah dihapus dari Google Sheets._`;

  return { success: true, replyText };
}

/**
 * Handle edit last transaction amount
 */
async function handleEditLast(parsed: ParsedIntent): Promise<ExecutionResult> {
  const newAmount = parsed.amount;
  const newNote = parsed.note;
  const targetQuery = parsed.name;

  if ((!newAmount || newAmount <= 0) && !newNote) {
    return {
      success: false,
      replyText: '⚠️ Berikan nominal atau keterangan baru. Contoh: `edit jadi 35k` atau `edit bensin jadi 40k`'
    };
  }

  const categoryMap = await getCategoryMappings();
  const detected = newNote ? detectCategory(newNote, undefined, categoryMap) : undefined;
  const newCategory = detected && detected !== 'Lainnya' ? detected : undefined;

  const result = await editTransaction({
    criteria: targetQuery ? { query: targetQuery } : undefined,
    newAmount: newAmount && newAmount > 0 ? newAmount : undefined,
    newNote,
    newCategory
  });

  if (!result) {
    return {
      success: false,
      replyText: targetQuery
        ? `⚠️ Tidak ditemukan transaksi yang cocok dengan "${targetQuery}".`
        : '⚠️ Tidak ada transaksi yang dapat diubah.'
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

  const replyText =
    `✏️ *Transaksi Berhasil Diperbarui!*\n\n` +
    changesText +
    `\n_Perubahan telah disimpan ke Google Sheets._`;

  return { success: true, replyText };
}

/**
 * Handle interactive menu
 */
function handleMenu(): ExecutionResult {
  const headerText = '🤖 Expense Bot Menu';
  const bodyText =
    `Pilih perintah cepat atau ketik santai di chat (bebas format):\n\n` +
    `*Catat Transaksi Santai:*\n` +
    `• \`beli kopi 25rb\` / \`kopi 20k\`\n` +
    `• \`beli bensin 50k\` / \`bensin 50rb\`\n` +
    `• \`makan siang nasi padang 25.000\`\n` +
    `• \`bayar listrik 150 ribu\`\n` +
    `• \`dapet gaji 5jt\` / \`transferan 500rb\`\n\n` +
    `*Laporan & Saldo:*\n` +
    `• \`pengeluaran hari ini\` / \`rekap hari\`\n` +
    `• \`rekap minggu ini\`\n` +
    `• \`saldo sekarang\` / \`laporan bulan ini\`\n\n` +
    `*Koreksi:*\n` +
    `• \`hapus terakhir\` / \`batal\`\n` +
    `• \`edit terakhir <jumlah>\`\n\n` +
    `*AI & Foto Struk:*\n` +
    `• \`saran\` (AI Financial Advisor)\n` +
    `• Kirim langsung *foto struk belanja* 📷\n` +
    `• \`list langganan\` / \`tambah langganan\``;

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
    replyText: `${headerText}\n\n${bodyText}`,
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
async function handleAiAdvice(): Promise<ExecutionResult> {
  const transactions = await getAllTransactions();
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

/**
 * Handle adding a recurring expense
 */
async function handleAddRecurring(parsed: ParsedIntent): Promise<ExecutionResult> {
  if (!parsed.name || !parsed.amount || !parsed.dueDate) {
    return {
      success: false,
      replyText: '⚠️ Format belum lengkap. Contoh: `langganan netflix 186k tgl 5` atau `tambah rutin spotify 55rb tgl 20`'
    };
  }

  const formattedName = parsed.name.charAt(0).toUpperCase() + parsed.name.slice(1);

  const item: RecurringExpense = {
    id: crypto.randomUUID(),
    name: formattedName,
    amount: parsed.amount,
    category: parsed.category || 'Bills',
    due_date: parsed.dueDate,
    active: true,
    created_at: new Date().toISOString()
  };

  await addRecurringExpense(item);

  const replyText =
    `🔁 *Pengeluaran Rutin & Langganan Tersimpan!*\n\n` +
    `• Nama: *${item.name}*\n` +
    `• Jumlah: *${formatRp(item.amount)}*\n` +
    `• Kategori: ${item.category}\n` +
    `• Tanggal Jatuh Tempo: *Tiap tanggal ${item.due_date}*\n` +
    `• Status: *Aktif* ✅\n\n` +
    `_Bot akan otomatis mencatatnya ke Google Sheets setiap bulan dan mengirim notifikasi._`;

  return { success: true, replyText };
}

/**
 * Handle listing active recurring expenses
 */
async function handleListRecurring(): Promise<ExecutionResult> {
  const list = await getRecurringExpenses();
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
    .map((r, i) => `${i + 1}. *${r.name}* — ${formatRp(r.amount)} (Tgl ${r.due_date}) [${r.category}]`)
    .join('\n');

  const replyText =
    `📋 *Daftar Pengeluaran Rutin & Langganan Aktif:*\n\n` +
    `${itemsText}\n\n` +
    `💰 *Total Rutin:* *${formatRp(totalMonthly)}* / bulan\n\n` +
    `_• Untuk stop/hapus: ketik \`stop langganan <nama>\` atau \`hapus rutin <nama>\`_\n` +
    `_• Untuk tambah: ketik \`langganan <nama> <nominal> tgl <hari>\`_`;

  return { success: true, replyText };
}

/**
 * Handle disabling a recurring expense
 */
async function handleDeleteRecurring(name: string): Promise<ExecutionResult> {
  if (!name) {
    return {
      success: false,
      replyText: '⚠️ Mohon sebutkan nama langganan / rutin. Contoh: `stop langganan netflix` atau `hapus rutin spotify`'
    };
  }

  const displayName = name.charAt(0).toUpperCase() + name.slice(1);
  const ok = await toggleRecurringExpense(name, false);
  if (!ok) {
    return {
      success: false,
      replyText: `⚠️ Langganan / pengeluaran rutin dengan nama *${displayName}* tidak ditemukan.`
    };
  }

  const replyText = `✅ Langganan / pengeluaran rutin *${displayName}* berhasil dinonaktifkan.`;
  return { success: true, replyText };
}

/**
 * Handle recurring help / tutorial message
 */
function handleHelpRecurring(): ExecutionResult {
  const replyText =
    `🔁 *Panduan Langganan & Pengeluaran Rutin Bulanan*\n\n` +
    `Jadwalkan tagihan atau langganan rutin (seperti Netflix, Spotify, WiFi, Listrik, Kos, Gym, iCloud) agar dicatat otomatis setiap bulan sesuai tanggal jatuh tempo.\n\n` +
    `📌 *Format Perintah Cepat & Fleksibel:*\n` +
    `• \`langganan <nama> <nominal> tgl <tanggal>\`\n` +
    `• \`tambah langganan <nama> <nominal> tgl <tanggal>\`\n` +
    `• \`rutin <nama> <nominal> tgl <tanggal>\`\n\n` +
    `💡 *Contoh Menambah:*\n` +
    `• \`langganan netflix 186k tgl 5\`\n` +
    `• \`langganan spotify 55rb tiap tgl 25\`\n` +
    `• \`tambah langganan wifi indihome 350k tgl 20\`\n` +
    `• \`rutin gym 150k tiap bulan tgl 1\`\n` +
    `• \`tambah rutin kost 1.5jt tgl 1\`\n\n` +
    `📋 *Perintah Terkait:*\n` +
    `• \`list langganan\` / \`cek langganan\` / \`langganan apa aja\` — Cek daftar aktif\n` +
    `• \`stop langganan <nama>\` / \`hapus rutin <nama>\` — Menonaktifkan langganan\n\n` +
    `_Sistem akan otomatis mencatatnya tiap bulan ke Google Sheets dan mengirimkan notifikasi ke Anda._`;

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

  const replyText =
    `👋 *Format Pesan Bebas & Santai (Tanpa Format Kaku)*\n\n` +
    `Anda bisa langsung mencatat pengeluaran atau pemasukan dengan bahasa sehari-hari:\n\n` +
    `💡 *Contoh Catat Pengeluaran:*\n` +
    `• \`beli kopi 25rb\` atau \`kopi 20k\`\n` +
    `• \`bensin 50k\` atau \`beli bensin 50.000\`\n` +
    `• \`makan siang nasi padang 25rb\`\n` +
    `• \`bayar listrik 150 ribu\`\n` +
    `• \`parkir motor 2000\`\n\n` +
    `💰 *Contoh Catat Pemasukan:*\n` +
    `• \`gajian 5.000.000\`\n` +
    `• \`dapat transferan 500rb\`\n` +
    `• \`bonus 250k\`\n\n` +
    `📊 *Cek Rekap & Saldo:*\n` +
    `• \`pengeluaran hari ini\` atau \`rekap minggu ini\`\n` +
    `• \`saldo sekarang\` atau \`laporan bulan ini\`\n\n` +
    `📷 *Scan Struk:*\n` +
    `Langsung kirim foto struk belanja Anda ke bot ini!\n\n` +
    `Ketik \`menu\` untuk melihat opsi lainnya.`;

  return { success: false, replyText };
}
