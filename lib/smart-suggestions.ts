import { getRecurringExpenses, getAllTransactions } from './sheets';
import { suggestAmount } from './user-preferences';

/**
 * Check upcoming recurring expenses dalam 3 hari ke depan
 */
export async function checkUpcomingRecurring(userId: string): Promise<string | null> {
  try {
    const recurring = await getRecurringExpenses(userId);
    const activeRecurring = recurring.filter((r) => r.active);

    if (activeRecurring.length === 0) return null;

    const now = new Date();
    const today = now.getDate();
    const upcomingList: string[] = [];

    for (const r of activeRecurring) {
      const daysUntilDue = r.due_date - today;

      // Jatuh tempo dalam 3 hari ke depan (atau sudah lewat hari ini)
      if (daysUntilDue >= 0 && daysUntilDue <= 3) {
        const dueLabel =
          daysUntilDue === 0
            ? 'hari ini'
            : daysUntilDue === 1
            ? 'besok'
            : `${daysUntilDue} hari lagi`;
        upcomingList.push(
          `• *${r.name}* - Rp${r.amount.toLocaleString('id-ID')} (jatuh tempo ${dueLabel})`
        );
      }
    }

    if (upcomingList.length === 0) return null;

    return `\n\n📅 *Reminder Tagihan Rutin:*\n${upcomingList.join('\n')}`;
  } catch (err) {
    console.error('[checkUpcomingRecurring] Error:', err);
    return null;
  }
}

/**
 * Detect spending anomaly: bandingkan dengan rata-rata historis 3 bulan terakhir
 */
export async function detectSpendingAnomaly(
  userId: string,
  category: string,
  amount: number
): Promise<string | null> {
  try {
    const transactions = await getAllTransactions(userId);
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    // Filter: expense, kategori sama, 3 bulan terakhir
    const relevantTxs = transactions.filter(
      (tx) =>
        tx.type === 'expense' &&
        tx.category === category &&
        new Date(tx.created_at) >= threeMonthsAgo
    );

    if (relevantTxs.length < 3) return null; // Butuh minimal 3 transaksi untuk deteksi

    const totalAmount = relevantTxs.reduce((sum, tx) => sum + tx.amount, 0);
    const avgAmount = totalAmount / relevantTxs.length;

    // Anomali jika amount > 2.5x rata-rata
    if (amount > avgAmount * 2.5) {
      const diffPercent = Math.round(((amount - avgAmount) / avgAmount) * 100);
      return `\n\n⚠️ *Peringatan:* Pengeluaran ${category} ini ${diffPercent}% lebih tinggi dari rata-rata biasanya (Rp${Math.round(avgAmount).toLocaleString('id-ID')}).`;
    }

    return null;
  } catch (err) {
    console.error('[detectSpendingAnomaly] Error:', err);
    return null;
  }
}

/**
 * Suggest transaction template berdasarkan merchant yang dikenal
 */
export async function suggestTransactionTemplate(
  userId: string,
  text: string
): Promise<{ note: string; amount: number; category: string } | null> {
  try {
    // Extract merchant hint dari text (kata pertama yang bukan command)
    const cleanText = text
      .toLowerCase()
      .replace(/^(?:beli|catat|keluar|pengeluaran|order)\s+/i, '')
      .trim();

    const merchantHint = cleanText.split(/\s+/)[0];
    if (!merchantHint || merchantHint.length < 3) return null;

    const suggestedAmount = await suggestAmount(userId, merchantHint);
    if (!suggestedAmount) return null;

    // Return template suggestion
    return {
      note: merchantHint,
      amount: suggestedAmount,
      category: 'Lainnya' // Will be refined by suggestCategory
    };
  } catch (err) {
    console.error('[suggestTransactionTemplate] Error:', err);
    return null;
  }
}
