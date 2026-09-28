import { NextRequest, NextResponse } from 'next/server';
import { getAllTransactions, getRecurringExpenses } from '@/lib/sheets';

type Cell = string | number;

function csvEscape(value: Cell): string {
  let raw = String(value ?? '');
  // Prevent spreadsheet formula execution in user-defined category names.
  if (/^[=+@\-\t\r]/.test(raw)) raw = `'${raw}`;
  if (raw.includes(',') || raw.includes('"') || raw.includes('\n') || raw.includes('\r')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function buildCsv(rows: Cell[][]): string {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
}

function monthKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Tanggal tidak diketahui';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit'
  }).format(date);
}

function formatMonth(key: string): string {
  if (!/^\d{4}-\d{2}$/.test(key)) return key;
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('id-ID', {
    month: 'long', year: 'numeric'
  });
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');

  if (!userId) {
    return NextResponse.json(
      { error: 'Parameter userId wajib diisi untuk download laporan pribadi.' },
      { status: 400 }
    );
  }

  const [transactions, recurring] = await Promise.all([
    getAllTransactions(userId),
    getRecurringExpenses(userId)
  ]);

  const incomes = transactions.filter((tx) => tx.type === 'income');
  const expenses = transactions.filter((tx) => tx.type === 'expense');
  const totalIncome = incomes.reduce((sum, tx) => sum + tx.amount, 0);
  const totalExpense = expenses.reduce((sum, tx) => sum + tx.amount, 0);
  const activeRecurring = recurring.filter((item) => item.active);

  const monthly = new Map<string, { income: number; expense: number; count: number }>();
  const categories = new Map<string, { amount: number; count: number }>();
  for (const tx of transactions) {
    const key = monthKey(tx.created_at);
    const month = monthly.get(key) || { income: 0, expense: 0, count: 0 };
    month[tx.type] += tx.amount;
    month.count += 1;
    monthly.set(key, month);

    if (tx.type === 'expense') {
      const category = tx.category || 'Lainnya';
      const total = categories.get(category) || { amount: 0, count: 0 };
      total.amount += tx.amount;
      total.count += 1;
      categories.set(category, total);
    }
  }

  const now = new Date();
  const exportDate = now.toLocaleDateString('id-ID', {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta'
  });
  const reportRows: Cell[][] = [
    ['LAPORAN KEUANGAN'],
    ['Dibuat pada', exportDate],
    [],
    ['RINGKASAN KESELURUHAN'],
    ['Metrik', 'Jumlah', 'Transaksi'],
    ['Total pemasukan', totalIncome, incomes.length],
    ['Total pengeluaran', totalExpense, expenses.length],
    ['Laba bersih', totalIncome - totalExpense, transactions.length],
    ['Pengeluaran rutin aktif', activeRecurring.reduce((sum, item) => sum + item.amount, 0), activeRecurring.length],
    [],
    ['REKAP BULANAN'],
    ['Bulan', 'Pemasukan', 'Pengeluaran', 'Laba bersih', 'Jumlah transaksi'],
    ...[...monthly.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, values]) => [formatMonth(key), values.income, values.expense, values.income - values.expense, values.count]),
    [],
    ['PENGELUARAN PER KATEGORI'],
    ['Kategori', 'Total pengeluaran', 'Jumlah transaksi', 'Persentase pengeluaran'],
    ...[...categories.entries()]
      .sort(([, a], [, b]) => b.amount - a.amount)
      .map(([category, values]) => [category, values.amount, values.count, totalExpense ? values.amount / totalExpense : 0]),
    [],
    ['PENGELUARAN RUTIN'],
    ['Status', 'Jumlah langganan aktif', 'Total nominal rutin aktif'],
    ['Aktif', activeRecurring.length, activeRecurring.reduce((sum, item) => sum + item.amount, 0)]
  ];

  const csv = `\uFEFF${buildCsv(reportRows)}`;
  const fileName = `laporan-keuangan-${now.toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Privacy-Mode': 'aggregated-report-only',
      'X-Export-Template': 'financial-summary-v2'
    }
  });
}
