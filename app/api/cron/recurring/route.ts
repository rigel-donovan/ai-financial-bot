import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import {
  getRecurringExpenses,
  appendTransaction,
  updateRecurringLastRun
} from '@/lib/sheets';
import { sendWhatsAppTextMessage } from '@/lib/whatsapp';
import { formatRp, formatDate } from '@/lib/transactions';
import { Transaction } from '@/types';

import { sendTelegramTextMessage } from '@/lib/telegram';

/**
 * Endpoint called by Vercel Cron daily to process due recurring expenses
 */
export async function GET(req: NextRequest) {
  // 1. Authenticate cron trigger
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  const querySecret = req.nextUrl.searchParams.get('secret');

  if (cronSecret) {
    const isHeaderValid = authHeader === `Bearer ${cronSecret}`;
    const isQueryValid = querySecret === cronSecret;
    if (!isHeaderValid && !isQueryValid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const now = new Date();
  // Use Jakarta timezone date
  const jakartaDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }); // YYYY-MM-DD
  const currentDayOfMonth = parseInt(
    now.toLocaleDateString('id-ID', { day: 'numeric', timeZone: 'Asia/Jakarta' }),
    10
  );

  // Determine last day of the current month (for February, April, etc.)
  const year = now.getFullYear();
  const month = now.getMonth();
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();

  try {
    const allRecurring = await getRecurringExpenses();
    const activeList = allRecurring.filter(r => r.active);

    const processedItems: { userId?: string; name: string; amount: number; category: string }[] = [];

    for (const item of activeList) {
      // Check if already run today
      if (item.last_run_date === jakartaDateStr) {
        continue;
      }

      // Check due date match (or if due date > last day of month, trigger on last day)
      const effectiveDueDay = Math.min(item.due_date, lastDayOfMonth);

      if (currentDayOfMonth === effectiveDueDay) {
        const tx: Transaction = {
          id: crypto.randomUUID(),
          user_id: item.user_id,
          type: 'expense',
          amount: item.amount,
          category: item.category || 'Bills',
          note: item.name,
          raw_message: `Otomatis rutin: ${item.name}`,
          source: 'recurring',
          created_at: new Date().toISOString()
        };

        // Insert into transactions
        await appendTransaction(tx);

        // Update last run date to prevent duplicates
        await updateRecurringLastRun(item.id, jakartaDateStr);

        processedItems.push({
          userId: item.user_id,
          name: item.name,
          amount: item.amount,
          category: item.category
        });
      }
    }

    // Group by user and send notification
    const userGroups = new Map<string, typeof processedItems>();
    for (const p of processedItems) {
      const u = p.userId || 'default';
      if (!userGroups.has(u)) userGroups.set(u, []);
      userGroups.get(u)!.push(p);
    }

    for (const [uid, items] of userGroups.entries()) {
      const summaryList = items
        .map(p => `• *${p.name}:* ${formatRp(p.amount)} (${p.category})`)
        .join('\n');

      const totalAmount = items.reduce((s, p) => s + p.amount, 0);

      const message =
        `🔁 *Pengeluaran Rutin Otomatis Tercatat*\n\n` +
        `Berikut pengeluaran rutin yang jatuh tempo hari ini (${formatDate(now.toISOString())}):\n\n` +
        `${summaryList}\n\n` +
        `💰 *Total:* ${formatRp(totalAmount)}\n\n` +
        `_Data telah otomatis disimpan ke Google Sheets._`;

      if (uid !== 'default') {
        if (/^\d{8,11}$/.test(uid)) {
          // Telegram Chat ID
          await sendTelegramTextMessage({ chatId: uid, text: message }).catch(() => {});
        } else if (/^\d{10,16}$/.test(uid)) {
          // WhatsApp phone
          await sendWhatsAppTextMessage({ to: uid, body: message }).catch(() => {});
        }
      } else {
        const recipientPhone = process.env.ALLOWED_PHONE_NUMBER || process.env.ADMIN_PHONE_NUMBER;
        if (recipientPhone) {
          await sendWhatsAppTextMessage({ to: recipientPhone, body: message }).catch(() => {});
        }
      }
    }

    return NextResponse.json({
      status: 'ok',
      date: jakartaDateStr,
      dayOfMonth: currentDayOfMonth,
      processedCount: processedItems.length,
      processed: processedItems
    });
  } catch (err: any) {
    console.error('Error running recurring expense cron:', err);
    return NextResponse.json(
      { error: 'Internal Server Error', message: err.message },
      { status: 500 }
    );
  }
}
