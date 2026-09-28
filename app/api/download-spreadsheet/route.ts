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

function formatDateForExport(iso?: string): string {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('id-ID', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Asia/Jakarta'
    });
  } catch {
    return iso;
  }
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

  const totalIncome = transactions
    .filter((tx) => tx.type === 'income')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalExpense = transactions
    .filter((tx) => tx.type === 'expense')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const netProfit = totalIncome - totalExpense;

  const summaryRows = [
    ['template', 'finance_export'],
    ['owner_user_id', userId],
    ['total_pemasukan', totalIncome],
    ['total_pengeluaran', totalExpense],
    ['laba_bersih', netProfit],
    ['jumlah_transaksi', transactions.length],
    ['jumlah_langganan_aktif', recurring.filter((item) => item.active).length],
    ['tanggal_export', new Date().toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jakarta' })]
  ];

  const transactionRows = [
    ['tanggal', 'jenis', 'kategori', 'jumlah', 'keterangan', 'sumber'],
    ...transactions.map((tx) => [
      formatDateForExport(tx.created_at),
      tx.type === 'income' ? 'Pemasukan' : 'Pengeluaran',
      tx.category,
      tx.amount,
      tx.note,
      tx.source
    ])
  ];

  const recurringRows = [
    ['nama_langganan', 'kategori', 'nominal', 'tanggal_jatuh_tempo', 'status', 'terakhir_berjalan'],
    ...recurring.map((item) => [
      item.name,
      item.category,
      item.amount,
      item.due_date,
      item.active ? 'Aktif' : 'Nonaktif',
      item.last_run_date || '-'
    ])
  ];

  const csv = [
    '[summary]',
    buildCsv(summaryRows),
    '',
    '[transactions]',
    buildCsv(transactionRows),
    '',
    '[recurring_expenses]',
    buildCsv(recurringRows)
  ].join('\n');

  const fileName = `laporan-keuangan-user-${encodeURIComponent(userId)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Data-Owner': userId,
      'X-Privacy-Mode': 'user-scoped-only',
      'X-Export-Template': 'finance-template-v1'
    }
  });
}
