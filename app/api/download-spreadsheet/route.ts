import ExcelJS from 'exceljs';
import { NextRequest, NextResponse } from 'next/server';
import { getAllTransactions, getRecurringExpenses } from '@/lib/sheets';
import { RecurringExpense, Transaction } from '@/types';

const CURRENCY_FORMAT = '"Rp" #,##0;[Red]-"Rp" #,##0';
const CATEGORY_ORDER = ['Food', 'Transport', 'Bills', 'Entertainment', 'Shopping', 'Health', 'Donation', 'Lainnya'];
const COLORS = {
  green: 'FF285943',
  greenLight: 'FFE5F0E9',
  greenPale: 'FFF2F7F3',
  orange: 'FFD96A45',
  orangeLight: 'FFFCEBE5',
  ink: 'FF24352D',
  muted: 'FF64746C',
  white: 'FFFFFFFF',
  grid: 'FFD9E2DC',
  bar: 'FF4A8A61',
  barTrack: 'FFEAF0EC'
};

function applyHeaderStyle(row: ExcelJS.Row): void {
  row.height = 24;
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.green } };
    cell.font = { bold: true, color: { argb: COLORS.white }, size: 10 };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: COLORS.green } } };
  });
}

function safeDate(value: string): Date | string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed;
}

function makeWorkbookTitle(sheet: ExcelJS.Worksheet, title: string, subtitle: string): void {
  sheet.mergeCells('A1:S1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = title;
  titleCell.font = { bold: true, size: 18, color: { argb: COLORS.white } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.green } };
  titleCell.alignment = { vertical: 'middle' };
  sheet.getRow(1).height = 34;

  sheet.mergeCells('A2:S2');
  const subtitleCell = sheet.getCell('A2');
  subtitleCell.value = subtitle;
  subtitleCell.font = { italic: true, size: 10, color: { argb: COLORS.muted } };
  subtitleCell.alignment = { vertical: 'middle' };
  sheet.getRow(2).height = 22;
}

function addKpiCard(
  sheet: ExcelJS.Worksheet,
  labelRange: string,
  valueRange: string,
  label: string,
  value: string | number,
  fillColor: string,
  numberFormat?: string
): void {
  sheet.mergeCells(labelRange);
  sheet.mergeCells(valueRange);
  const labelCell = sheet.getCell(labelRange.split(':')[0]);
  const valueCell = sheet.getCell(valueRange.split(':')[0]);
  labelCell.value = label;
  valueCell.value = value;
  labelCell.font = { bold: true, size: 10, color: { argb: COLORS.muted } };
  valueCell.font = { bold: true, size: 16, color: { argb: COLORS.ink } };
  valueCell.alignment = { vertical: 'middle' };
  if (numberFormat) valueCell.numFmt = numberFormat;

  for (const range of [labelRange, valueRange]) {
    const [start, end] = range.split(':');
    const startCell = sheet.getCell(start);
    const endCell = sheet.getCell(end);
    for (let row = startCell.fullAddress.row; row <= endCell.fullAddress.row; row++) {
      for (let column = startCell.fullAddress.col; column <= endCell.fullAddress.col; column++) {
        const cell = sheet.getCell(row, column);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
        cell.border = {
          top: { style: 'thin', color: { argb: COLORS.grid } },
          bottom: { style: 'thin', color: { argb: COLORS.grid } },
          left: { style: 'thin', color: { argb: COLORS.grid } },
          right: { style: 'thin', color: { argb: COLORS.grid } }
        };
      }
    }
  }
}

export async function buildSpreadsheet(
  allTransactions: Transaction[],
  allRecurring: RecurringExpense[],
  userId: string
): Promise<Buffer> {
  const transactions = allTransactions.filter((transaction) => transaction.user_id === userId);
  const recurring = allRecurring.filter((expense) => expense.user_id === userId);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Catatan Keuangan';
  workbook.subject = 'Laporan transaksi dan langganan pribadi';
  workbook.created = new Date();

  const transactionSheet = workbook.addWorksheet('transactions', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });
  transactionSheet.columns = [
    { header: 'Tanggal', key: 'date', width: 23 },
    { header: 'Jenis', key: 'type', width: 16 },
    { header: 'Kategori', key: 'category', width: 20 },
    { header: 'Catatan', key: 'note', width: 38 },
    { header: 'Nominal', key: 'amount', width: 19 },
    { header: 'Sumber', key: 'source', width: 16 }
  ];
  transactionSheet.addRows(transactions.map((transaction) => ({
    date: safeDate(transaction.created_at),
    type: transaction.type === 'income' ? 'Pemasukan' : 'Pengeluaran',
    category: transaction.category,
    note: transaction.note,
    amount: transaction.amount,
    source: transaction.source === 'recurring' ? 'Rutin' : 'Manual'
  })));
  applyHeaderStyle(transactionSheet.getRow(1));
  transactionSheet.autoFilter = `A1:F${Math.max(1, transactions.length + 1)}`;
  for (let row = 2; row <= transactions.length + 1; row++) {
    const dataRow = transactionSheet.getRow(row);
    dataRow.getCell(1).numFmt = 'dd mmm yyyy hh:mm';
    dataRow.getCell(5).numFmt = CURRENCY_FORMAT;
    dataRow.alignment = { vertical: 'middle' };
    if (row % 2 === 0) {
      dataRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.greenPale } };
      });
    }
  }

  const recurringSheet = workbook.addWorksheet('recurring_expenses', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });
  recurringSheet.columns = [
    { header: 'Nama Langganan', key: 'name', width: 28 },
    { header: 'Nominal per Bulan', key: 'amount', width: 22 },
    { header: 'Kategori', key: 'category', width: 20 },
    { header: 'Tanggal Jatuh Tempo', key: 'dueDate', width: 22 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Terakhir Dicatat', key: 'lastRun', width: 22 },
    { header: 'Dibuat', key: 'createdAt', width: 23 }
  ];
  recurringSheet.addRows(recurring.map((expense) => ({
    name: expense.name,
    amount: expense.amount,
    category: expense.category,
    dueDate: expense.due_date,
    status: expense.active ? 'Aktif' : 'Nonaktif',
    lastRun: expense.last_run_date || '',
    createdAt: expense.created_at ? safeDate(expense.created_at) : ''
  })));
  applyHeaderStyle(recurringSheet.getRow(1));
  recurringSheet.autoFilter = `A1:G${Math.max(1, recurring.length + 1)}`;
  for (let row = 2; row <= recurring.length + 1; row++) {
    recurringSheet.getCell(row, 2).numFmt = CURRENCY_FORMAT;
    recurringSheet.getCell(row, 4).numFmt = '"Tanggal "0';
    recurringSheet.getCell(row, 7).numFmt = 'dd mmm yyyy hh:mm';
    if (recurring[row - 2].active) {
      recurringSheet.getCell(row, 5).font = { bold: true, color: { argb: COLORS.green } };
    }
  }

  const dashboard = workbook.addWorksheet('Dashboard', {
    properties: { defaultRowHeight: 20 },
    views: [{ showGridLines: false }]
  });
  dashboard.getColumn(1).width = 24;
  dashboard.getColumn(2).width = 18;
  dashboard.getColumn(3).width = 13;
  for (let column = 4; column <= 19; column++) dashboard.getColumn(column).width = 2.6;
  makeWorkbookTitle(
    dashboard,
    'DASHBOARD KEUANGAN PRIBADI',
    `Ringkasan transaksi dan langganan untuk akun ${userId} | Dibuat ${new Date().toLocaleDateString('id-ID')}`
  );

  const incomeTotal = transactions.filter((transaction) => transaction.type === 'income')
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const expenses = transactions.filter((transaction) => transaction.type === 'expense');
  const expenseTotal = expenses.reduce((sum, transaction) => sum + transaction.amount, 0);
  const netTotal = incomeTotal - expenseTotal;
  const savingsRate = incomeTotal > 0 ? netTotal / incomeTotal : 0;
  const activeRecurring = recurring.filter((expense) => expense.active);
  const monthlyRecurringTotal = activeRecurring.reduce((sum, expense) => sum + expense.amount, 0);

  addKpiCard(dashboard, 'A4:B4', 'A5:B6', 'Total Pemasukan', incomeTotal, COLORS.greenLight, CURRENCY_FORMAT);
  addKpiCard(dashboard, 'C4:D4', 'C5:D6', 'Total Pengeluaran', expenseTotal, COLORS.orangeLight, CURRENCY_FORMAT);
  addKpiCard(dashboard, 'E4:F4', 'E5:F6', 'Saldo Bersih (Net)', netTotal, COLORS.greenPale, CURRENCY_FORMAT);
  addKpiCard(dashboard, 'G4:H4', 'G5:H6', 'Tingkat Tabungan', savingsRate, COLORS.greenLight, '0.0%');

  dashboard.mergeCells('A8:S8');
  dashboard.getCell('A8').value = 'RINGKASAN PENGELUARAN PER KATEGORI';
  dashboard.getCell('A8').font = { bold: true, color: { argb: COLORS.white } };
  dashboard.getCell('A8').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.green } };
  dashboard.getCell('A9').value = 'Kategori';
  dashboard.getCell('B9').value = 'Nominal';
  dashboard.getCell('C9').value = 'Porsi';
  dashboard.mergeCells('D9:S9');
  dashboard.getCell('D9').value = 'Visual Pengeluaran';
  applyHeaderStyle(dashboard.getRow(9));

  const categoryTotals = new Map<string, number>();
  for (const expense of expenses) {
    categoryTotals.set(expense.category || 'Lainnya', (categoryTotals.get(expense.category || 'Lainnya') || 0) + expense.amount);
  }
  const categories = [...new Set([...CATEGORY_ORDER, ...categoryTotals.keys()])];
  const maxCategoryTotal = Math.max(0, ...categoryTotals.values());
  const categoryStartRow = 10;
  categories.forEach((category, index) => {
    const rowNumber = categoryStartRow + index;
    const amount = categoryTotals.get(category) || 0;
    const row = dashboard.getRow(rowNumber);
    row.getCell(1).value = category;
    row.getCell(2).value = amount;
    row.getCell(2).numFmt = CURRENCY_FORMAT;
    row.getCell(3).value = expenseTotal > 0 ? amount / expenseTotal : 0;
    row.getCell(3).numFmt = '0.0%';
    for (let column = 4; column <= 19; column++) {
      const barCell = row.getCell(column);
      const filledBars = maxCategoryTotal > 0 ? Math.round((amount / maxCategoryTotal) * 16) : 0;
      barCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: column - 4 < filledBars ? COLORS.bar : COLORS.barTrack }
      };
    }
    if (index % 2 === 1) {
      for (let column = 1; column <= 3; column++) {
        row.getCell(column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.greenPale } };
      }
    }
  });

  const recurringSummaryRow = categoryStartRow + categories.length + 2;
  dashboard.mergeCells(`A${recurringSummaryRow}:S${recurringSummaryRow}`);
  dashboard.getCell(`A${recurringSummaryRow}`).value = 'LANGGANAN & PENGELUARAN RUTIN';
  dashboard.getCell(`A${recurringSummaryRow}`).font = { bold: true, color: { argb: COLORS.white } };
  dashboard.getCell(`A${recurringSummaryRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.green } };
  dashboard.getCell(`A${recurringSummaryRow + 1}`).value = 'Langganan aktif';
  dashboard.getCell(`B${recurringSummaryRow + 1}`).value = activeRecurring.length;
  dashboard.getCell(`C${recurringSummaryRow + 1}`).value = 'Estimasi per bulan';
  dashboard.getCell(`D${recurringSummaryRow + 1}`).value = monthlyRecurringTotal;
  dashboard.getCell(`D${recurringSummaryRow + 1}`).numFmt = CURRENCY_FORMAT;
  dashboard.getCell(`A${recurringSummaryRow + 1}`).font = { bold: true, color: { argb: COLORS.ink } };
  dashboard.getCell(`C${recurringSummaryRow + 1}`).font = { bold: true, color: { argb: COLORS.ink } };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId')?.trim();

  if (!userId) {
    return NextResponse.json(
      { error: 'Parameter userId wajib diisi untuk mengunduh data akun ini.' },
      { status: 400 }
    );
  }

  const [transactions, recurring] = await Promise.all([
    getAllTransactions(userId),
    getRecurringExpenses(userId)
  ]);
  const file = await buildSpreadsheet(transactions, recurring, userId);
  const date = new Date().toISOString().slice(0, 10);

  return new NextResponse(Uint8Array.from(file), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="laporan-keuangan-${date}.xlsx"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Privacy-Mode': 'user-id-filtered',
      'X-Export-Template': 'finance-dashboard-multi-sheet-v1'
    }
  });
}