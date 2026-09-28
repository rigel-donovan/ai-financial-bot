import { NextRequest, NextResponse } from 'next/server';
import { getAllTransactions, getRecurringExpenses } from '@/lib/sheets';

function csvEscape(value: string | number | boolean | null | undefined): string {
  const raw = String(value ?? '');
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n') || raw.includes('\r')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function buildCsv(rows: Array<Array<string | number | boolean | null | undefined>>): string {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');

  if (!userId) {
    return NextResponse.json(
      { error: 'Parameter userId wajib diisi untuk download file spreadsheet privat.' },
      { status: 400 }
    );
  }

  const [transactions, recurring] = await Promise.all([
    getAllTransactions(userId),
    getRecurringExpenses(userId)
  ]);

  const transactionRows = [
    ['sheet', 'user_id', 'id', 'type', 'amount', 'category', 'note', 'source', 'created_at'],
    ...transactions.map((tx) => [
      'transactions',
      tx.user_id || userId,
      tx.id,
      tx.type,
      tx.amount,
      tx.category,
      tx.note,
      tx.source,
      tx.created_at
    ])
  ];

  const recurringRows = [
    ['sheet', 'user_id', 'id', 'name', 'amount', 'category', 'due_date', 'active', 'created_at'],
    ...recurring.map((item) => [
      'recurring_expenses',
      item.user_id || userId,
      item.id,
      item.name,
      item.amount,
      item.category,
      item.due_date,
      item.active,
      item.created_at
    ])
  ];

  const csv = [
    'transactions',
    buildCsv(transactionRows),
    '',
    'recurring_expenses',
    buildCsv(recurringRows)
  ].join('\n');

  const fileName = `expense-bot-user-${encodeURIComponent(userId)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Data-Owner': userId,
      'X-Privacy-Mode': 'user-scoped-only'
    }
  });
}
