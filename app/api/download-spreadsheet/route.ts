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

  // ===== SECTION: RINGKASAN PENGELUARAN PER KATEGORI =====
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

  // "Total Pengeluaran Kategori" summary row at the end
  const totalCatRow = categoryStartRow + categories.length;
  categories.forEach((category, index) => {
    const rowNumber = categoryStartRow + index;
    const amount = categoryTotals.get(category) || 0;
    const row = dashboard.getRow(rowNumber);
    row.getCell(1).value = category;
    row.getCell(1).font = { size: 10, color: { argb: COLORS.ink } };
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

  // Total row
  dashboard.getCell(`A${totalCatRow}`).value = 'Total Pengeluaran Kategori';
  dashboard.getCell(`A${totalCatRow}`).font = { bold: true, size: 10, color: { argb: COLORS.ink } };
  dashboard.getCell(`B${totalCatRow}`).value = expenseTotal;
  dashboard.getCell(`B${totalCatRow}`).numFmt = CURRENCY_FORMAT;
  dashboard.getCell(`B${totalCatRow}`).font = { bold: true, color: { argb: COLORS.ink } };
  dashboard.getCell(`C${totalCatRow}`).value = expenseTotal > 0 ? 1 : 0;
  dashboard.getCell(`C${totalCatRow}`).numFmt = '0.0%';
  dashboard.getCell(`C${totalCatRow}`).font = { bold: true, color: { argb: COLORS.ink } };
  for (let column = 1; column <= 19; column++) {
    dashboard.getCell(totalCatRow, column).border = {
      top: { style: 'medium', color: { argb: COLORS.green } },
      bottom: { style: 'medium', color: { argb: COLORS.green } }
    };
  }

  // ===== SECTION: GRAFIK PERBANDINGAN PEMASUKAN VS PENGELUARAN (Vertical Bar) =====
  const chartStartRow = totalCatRow + 2;
  const CHART_BAR_COLS = 16; // columns D through S
  const chartMaxVal = Math.max(incomeTotal, expenseTotal, 1);
  const chartBarHeight = 12; // number of rows for chart area

  // Section header
  dashboard.mergeCells(`A${chartStartRow}:S${chartStartRow}`);
  dashboard.getCell(`A${chartStartRow}`).value = 'GRAFIK PERBANDINGAN PEMASUKAN VS PENGELUARAN';
  dashboard.getCell(`A${chartStartRow}`).font = { bold: true, color: { argb: COLORS.white } };
  dashboard.getCell(`A${chartStartRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.green } };

  // Y-axis labels and chart grid
  const chartDataRow = chartStartRow + 1;
  for (let r = 0; r < chartBarHeight; r++) {
    const currentRow = chartDataRow + r;
    const rowValue = chartMaxVal - (chartMaxVal / chartBarHeight) * r;
    // Y-axis label (column A)
    if (r % 3 === 0) {
      dashboard.getCell(`A${currentRow}`).value = rowValue;
      dashboard.getCell(`A${currentRow}`).numFmt = '"Rp"#,##0';
      dashboard.getCell(`A${currentRow}`).font = { size: 8, color: { argb: COLORS.muted } };
      dashboard.getCell(`A${currentRow}`).alignment = { horizontal: 'right', vertical: 'top' };
    }

    // Calculate bar fill threshold for this row
    const threshold = chartMaxVal - (chartMaxVal / chartBarHeight) * (r + 1);
    // Income bar: columns B-C (2 cols wide)
    const incFilled = incomeTotal > threshold;
    for (const col of [2, 3]) {
      dashboard.getCell(currentRow, col).fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: incFilled ? COLORS.bar : COLORS.barTrack }
      };
    }
    // Spacer column D
    dashboard.getCell(currentRow, 4).fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.white }
    };
    // Expense bar: columns E-F (2 cols wide)
    const expFilled = expenseTotal > threshold;
    for (const col of [5, 6]) {
      dashboard.getCell(currentRow, col).fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: expFilled ? COLORS.orange : COLORS.barTrack }
      };
    }
  }

  // X-axis labels
  const xAxisRow = chartDataRow + chartBarHeight;
  dashboard.getCell(`B${xAxisRow}`).value = 'Pemasukan';
  dashboard.getCell(`B${xAxisRow}`).font = { bold: true, size: 9, color: { argb: COLORS.green } };
  dashboard.getCell(`B${xAxisRow}`).alignment = { horizontal: 'center' };
  dashboard.mergeCells(`B${xAxisRow}:C${xAxisRow}`);
  dashboard.getCell(`E${xAxisRow}`).value = 'Pengeluaran';
  dashboard.getCell(`E${xAxisRow}`).font = { bold: true, size: 9, color: { argb: COLORS.orange } };
  dashboard.getCell(`E${xAxisRow}`).alignment = { horizontal: 'center' };
  dashboard.mergeCells(`E${xAxisRow}:F${xAxisRow}`);

  // Value labels below bars
  const valRow = xAxisRow + 1;
  dashboard.getCell(`B${valRow}`).value = incomeTotal;
  dashboard.getCell(`B${valRow}`).numFmt = CURRENCY_FORMAT;
  dashboard.getCell(`B${valRow}`).font = { bold: true, size: 10, color: { argb: COLORS.green } };
  dashboard.getCell(`B${valRow}`).alignment = { horizontal: 'center' };
  dashboard.mergeCells(`B${valRow}:C${valRow}`);
  dashboard.getCell(`E${valRow}`).value = expenseTotal;
  dashboard.getCell(`E${valRow}`).numFmt = CURRENCY_FORMAT;
  dashboard.getCell(`E${valRow}`).font = { bold: true, size: 10, color: { argb: COLORS.orange } };
  dashboard.getCell(`E${valRow}`).alignment = { horizontal: 'center' };
  dashboard.mergeCells(`E${valRow}:F${valRow}`);

  // ===== SECTION: RINCIAN PENGELUARAN PER KATEGORI (Horizontal Bar Chart) =====
  const hBarStartRow = valRow + 2;
  dashboard.mergeCells(`A${hBarStartRow}:S${hBarStartRow}`);
  dashboard.getCell(`A${hBarStartRow}`).value = 'RINCIAN PENGELUARAN PER KATEGORI';
  dashboard.getCell(`A${hBarStartRow}`).font = { bold: true, color: { argb: COLORS.white } };
  dashboard.getCell(`A${hBarStartRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.green } };

  // Category colors for variety
  const catColors = [
    'FF66BB6A', // green
    'FFFF7043', // deep orange
    'FF42A5F5', // blue
    'FFFFCA28', // amber
    'FFAB47BC', // purple
    'FF26C6DA', // cyan
    'FFEF5350', // red
    'FF8D6E63', // brown
    'FF78909C', // blue grey
  ];

  const hBarDataRow = hBarStartRow + 1;
  // Filter to only categories with amounts > 0
  const filledCategories = categories.filter(c => (categoryTotals.get(c) || 0) > 0);

  filledCategories.forEach((category, index) => {
    const rowNumber = hBarDataRow + index;
    const amount = categoryTotals.get(category) || 0;
    const barColor = catColors[index % catColors.length];
    const filledCols = maxCategoryTotal > 0 ? Math.round((amount / maxCategoryTotal) * CHART_BAR_COLS) : 0;

    // Category label
    dashboard.getCell(rowNumber, 1).value = category;
    dashboard.getCell(rowNumber, 1).font = { size: 10, color: { argb: COLORS.ink } };
    dashboard.getCell(rowNumber, 1).alignment = { horizontal: 'right', vertical: 'middle' };
    dashboard.getRow(rowNumber).height = 22;

    // Horizontal bar
    for (let column = 2; column <= 2 + CHART_BAR_COLS; column++) {
      const cell = dashboard.getCell(rowNumber, column);
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: (column - 2) < filledCols ? barColor : COLORS.barTrack }
      };
    }

    // Value label after bar
    const labelCol = 2 + CHART_BAR_COLS + 1;
    dashboard.getCell(rowNumber, labelCol).value = amount;
    dashboard.getCell(rowNumber, labelCol).numFmt = CURRENCY_FORMAT;
    dashboard.getCell(rowNumber, labelCol).font = { size: 9, color: { argb: COLORS.muted } };
  });

  // ===== SECTION: TOP 5 TRANSAKSI TERBESAR =====
  const top5StartRow = hBarDataRow + Math.max(filledCategories.length, 1) + 2;
  dashboard.mergeCells(`A${top5StartRow}:S${top5StartRow}`);
  dashboard.getCell(`A${top5StartRow}`).value = 'TOP 5 TRANSAKSI TERBESAR';
  dashboard.getCell(`A${top5StartRow}`).font = { bold: true, color: { argb: COLORS.white } };
  dashboard.getCell(`A${top5StartRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.green } };

  // Header row
  const top5HeaderRow = top5StartRow + 1;
  const top5Headers = ['No', 'Tanggal', 'Jenis', 'Catatan', 'Kategori', 'Nominal'];
  const top5Cols = [1, 2, 3, 4, 7, 8]; // columns A, B, C, D-F (merged), G, H
  top5Headers.forEach((header, i) => {
    dashboard.getCell(top5HeaderRow, top5Cols[i]).value = header;
    dashboard.getCell(top5HeaderRow, top5Cols[i]).font = { bold: true, size: 9, color: { argb: COLORS.white } };
    dashboard.getCell(top5HeaderRow, top5Cols[i]).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.bar } };
    dashboard.getCell(top5HeaderRow, top5Cols[i]).alignment = { vertical: 'middle' };
  });
  // Merge D-F for "Catatan"
  dashboard.mergeCells(`D${top5HeaderRow}:F${top5HeaderRow}`);

  // Top 5 data
  const sortedByAmount = [...transactions].sort((a, b) => b.amount - a.amount).slice(0, 5);
  sortedByAmount.forEach((tx, index) => {
    const rowNum = top5HeaderRow + 1 + index;
    const isExpense = tx.type === 'expense';
    dashboard.getCell(rowNum, 1).value = index + 1;
    dashboard.getCell(rowNum, 1).alignment = { horizontal: 'center' };

    const txDate = new Date(tx.created_at);
    dashboard.getCell(rowNum, 2).value = Number.isNaN(txDate.getTime()) ? tx.created_at : txDate;
    dashboard.getCell(rowNum, 2).numFmt = 'dd mmm yyyy';
    dashboard.getCell(rowNum, 2).font = { size: 9, color: { argb: COLORS.muted } };

    dashboard.getCell(rowNum, 3).value = isExpense ? '🔴 Pengeluaran' : '🟢 Pemasukan';
    dashboard.getCell(rowNum, 3).font = { size: 9, color: { argb: isExpense ? COLORS.orange : COLORS.green } };

    dashboard.mergeCells(`D${rowNum}:F${rowNum}`);
    dashboard.getCell(rowNum, 4).value = tx.note || tx.category;
    dashboard.getCell(rowNum, 4).font = { size: 9, color: { argb: COLORS.ink } };

    dashboard.getCell(rowNum, 7).value = tx.category;
    dashboard.getCell(rowNum, 7).font = { size: 9, color: { argb: COLORS.muted } };

    dashboard.getCell(rowNum, 8).value = tx.amount;
    dashboard.getCell(rowNum, 8).numFmt = CURRENCY_FORMAT;
    dashboard.getCell(rowNum, 8).font = { bold: true, size: 10, color: { argb: isExpense ? COLORS.orange : COLORS.green } };

    // Alternating row background
    if (index % 2 === 0) {
      for (let col = 1; col <= 8; col++) {
        const c = dashboard.getCell(rowNum, col);
        if (!c.fill || (c.fill as ExcelJS.FillPattern).pattern !== 'solid') {
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.greenPale } };
        }
      }
    }
  });

  // ===== SECTION: LANGGANAN & PENGELUARAN RUTIN =====
  const recurringSummaryRow = top5HeaderRow + 1 + Math.max(sortedByAmount.length, 1) + 2;
  dashboard.mergeCells(`A${recurringSummaryRow}:S${recurringSummaryRow}`);
  dashboard.getCell(`A${recurringSummaryRow}`).value = 'LANGGANAN & PENGELUARAN RUTIN';
  dashboard.getCell(`A${recurringSummaryRow}`).font = { bold: true, color: { argb: COLORS.white } };
  dashboard.getCell(`A${recurringSummaryRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.green } };

  // Summary stats
  const recInfoRow = recurringSummaryRow + 1;
  dashboard.getCell(`A${recInfoRow}`).value = 'Langganan aktif';
  dashboard.getCell(`A${recInfoRow}`).font = { bold: true, color: { argb: COLORS.ink } };
  dashboard.getCell(`B${recInfoRow}`).value = activeRecurring.length;
  dashboard.getCell(`B${recInfoRow}`).font = { bold: true, size: 14, color: { argb: COLORS.green } };
  dashboard.getCell(`C${recInfoRow}`).value = 'Estimasi per bulan';
  dashboard.getCell(`C${recInfoRow}`).font = { bold: true, color: { argb: COLORS.ink } };
  dashboard.mergeCells(`D${recInfoRow}:E${recInfoRow}`);
  dashboard.getCell(`D${recInfoRow}`).value = monthlyRecurringTotal;
  dashboard.getCell(`D${recInfoRow}`).numFmt = CURRENCY_FORMAT;
  dashboard.getCell(`D${recInfoRow}`).font = { bold: true, size: 14, color: { argb: COLORS.orange } };

  // Recurring items with visual bars
  if (activeRecurring.length > 0) {
    const recListRow = recInfoRow + 2;
    const recHeaders = ['Nama', 'Nominal', 'Kategori', 'Jatuh Tempo'];
    recHeaders.forEach((h, i) => {
      dashboard.getCell(recListRow, i + 1).value = h;
      dashboard.getCell(recListRow, i + 1).font = { bold: true, size: 9, color: { argb: COLORS.white } };
      dashboard.getCell(recListRow, i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.bar } };
    });
    // Visual column header
    dashboard.mergeCells(`E${recListRow}:S${recListRow}`);
    dashboard.getCell(`E${recListRow}`).value = 'Proporsi';
    dashboard.getCell(`E${recListRow}`).font = { bold: true, size: 9, color: { argb: COLORS.white } };
    dashboard.getCell(`E${recListRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.bar } };

    const maxRecAmount = Math.max(...activeRecurring.map(r => r.amount), 1);
    activeRecurring.forEach((rec, index) => {
      const rowNum = recListRow + 1 + index;
      dashboard.getCell(rowNum, 1).value = rec.name;
      dashboard.getCell(rowNum, 1).font = { size: 10, color: { argb: COLORS.ink } };
      dashboard.getCell(rowNum, 2).value = rec.amount;
      dashboard.getCell(rowNum, 2).numFmt = CURRENCY_FORMAT;
      dashboard.getCell(rowNum, 3).value = rec.category;
      dashboard.getCell(rowNum, 3).font = { size: 9, color: { argb: COLORS.muted } };
      dashboard.getCell(rowNum, 4).value = `Tgl ${rec.due_date}`;
      dashboard.getCell(rowNum, 4).font = { size: 9, color: { argb: COLORS.muted } };

      // Proportional bar
      const filled = Math.round((rec.amount / maxRecAmount) * 15);
      for (let col = 5; col <= 19; col++) {
        dashboard.getCell(rowNum, col).fill = {
          type: 'pattern', pattern: 'solid',
          fgColor: { argb: (col - 5) < filled ? catColors[index % catColors.length] : COLORS.barTrack }
        };
      }

      if (index % 2 === 0) {
        for (let col = 1; col <= 4; col++) {
          dashboard.getCell(rowNum, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.greenPale } };
        }
      }
    });
  }

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