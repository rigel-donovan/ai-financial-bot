import { NextRequest, NextResponse } from 'next/server';
import { getAllTransactions } from '@/lib/sheets';

type Cell = string | number;

function csvEscape(value: Cell): string {
  let raw = String(value ?? '');
  // Keep user-entered text from being evaluated as a spreadsheet formula.
  if (/^[=+@\-\t\r]/.test(raw)) raw = `'${raw}`;
  if (raw.includes(';') || raw.includes('"') || raw.includes('\n') || raw.includes('\r')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function buildCsv(rows: Cell[][]): string {
  return rows.map((row) => row.map(csvEscape).join(';')).join('\r\n');
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId')?.trim();

  if (!userId) {
    return NextResponse.json(
      { error: 'Parameter userId wajib diisi untuk mengunduh transaksi akun ini.' },
      { status: 400 }
    );
  }

  // getAllTransactions applies an exact user_id filter before export.
  const transactions = await getAllTransactions(userId);
  const rows: Cell[][] = [
    ['id', 'user_id', 'type', 'amount', 'category', 'note', 'raw_message', 'source', 'created_at'],
    ...transactions.map((tx) => [
      tx.id,
      tx.user_id || userId,
      tx.type,
      tx.amount,
      tx.category,
      tx.note,
      tx.raw_message,
      tx.source,
      tx.created_at
    ])
  ];

  const csv = `\uFEFFsep=;\r\n${buildCsv(rows)}`;
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="transactions-${date}.csv"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Privacy-Mode': 'user-id-filtered',
      'X-Export-Template': 'transactions-sheet-v1'
    }
  });
}
