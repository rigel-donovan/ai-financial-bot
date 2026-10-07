import { parseMessage, parseAmount, detectCategory, parseQueryDate, isAnalysisRequest } from '../lib/parser';
import { handleUserMessage } from '../lib/transactions';
import { scanReceiptImage, extractReceiptFromOcrText } from '../lib/receipt-scanner';
import { GoogleGenerativeAI } from '@google/generative-ai';
import ExcelJS from 'exceljs';
import { buildSpreadsheet } from '../app/api/download-spreadsheet/route';

const assertionFailures = [];
const originalAssert = console.assert.bind(console);
console.assert = (condition, ...args) => {
  if (!condition) assertionFailures.push(args.map(String).join(' '));
  originalAssert(condition, ...args);
};

async function runTests() {
  console.log('--- 1. Testing Amount Parsing ---');
  console.assert(parseAmount('25000') === 25000, '25000 failed');
  console.assert(parseAmount('25.000') === 25000, '25.000 failed');
  console.assert(parseAmount('25k') === 25000, '25k failed');
  console.assert(parseAmount('1.5jt') === 1500000, '1.5jt failed');
  console.log('✓ parseAmount passed!');

  console.log('--- 2. Testing Category Detection ---');
  console.assert(detectCategory('kopi susu kenangan') === 'Food', 'kopi should be Food');
  console.assert(detectCategory('bensin pertamax') === 'Transport', 'bensin should be Transport');
  console.assert(detectCategory('nonton bioskop') === 'Entertainment', 'bioskop should be Entertainment');
  console.assert(detectCategory('bayar tagihan listrik') === 'Bills', 'listrik should be Bills');
  console.log('✓ detectCategory passed!');

  console.log('--- 3. Testing Message Parsing Intents ---');
  const p1 = parseMessage('keluar 25000 makan siang');
  console.assert(p1.intent === 'RECORD_EXPENSE' && p1.amount === 25000, 'p1 failed');

  const p2 = parseMessage('masuk 5000000 gaji');
  console.assert(p2.intent === 'RECORD_INCOME' && p2.amount === 5000000, 'p2 failed');

  const p3 = parseMessage('ringkasan bulan');
  console.assert(p3.intent === 'SUMMARY_MONTH', 'p3 failed');

  const p4 = parseMessage('hapus terakhir');
  console.assert(p4.intent === 'DELETE_LAST', 'p4 failed');

  const p4b = parseMessage('hapus transaksi 27 september 2026');
  console.assert(p4b.intent === 'DELETE_LAST' && p4b.targetDate === '2026-09-27' && !p4b.amount && !p4b.note, 'p4b failed: ' + JSON.stringify(p4b));

  const deleteSpecificApprox = parseMessage('hapus pengeluaran first media sebesar 450k tanggal 28 september');
  console.assert(deleteSpecificApprox.intent === 'DELETE_LAST' && deleteSpecificApprox.note === 'first media' && deleteSpecificApprox.amount === 450000 && deleteSpecificApprox.targetDate === '2026-09-28', 'deleteSpecificApprox failed: ' + JSON.stringify(deleteSpecificApprox));

  const deleteSpecificExact = parseMessage('hapus pengeluaran first media sebesar 450.660 tanggal 28 september 2026');
  console.assert(deleteSpecificExact.intent === 'DELETE_LAST' && deleteSpecificExact.note === 'first media' && deleteSpecificExact.amount === 450660 && deleteSpecificExact.targetDate === '2026-09-28', 'deleteSpecificExact failed: ' + JSON.stringify(deleteSpecificExact));

  const p5 = parseMessage('edit terakhir 30000');
  console.assert(p5.intent === 'EDIT_LAST' && p5.amount === 30000, 'p5 failed');

  const p6 = parseMessage('tambah rutin 150000 netflix tgl 5');
  console.assert(p6.intent === 'ADD_RECURRING' && p6.dueDate === 5 && p6.amount === 150000, 'p6 failed');

  const p7 = parseMessage('list rutin');
  console.assert(p7.intent === 'LIST_RECURRING', 'p7 failed');

  const p8 = parseMessage('menu');
  console.assert(p8.intent === 'MENU', 'p8 failed');

  const p8b = parseMessage('bantuan');
  console.assert(p8b.intent === 'HELP', 'p8b failed: ' + JSON.stringify(p8b));

  // Test Date-filtered queries
  const p9 = parseMessage('list pemasukan tanggal 27 september 2026');
  console.assert(p9.intent === 'LIST_INCOMES' && p9.targetDate === '2026-09-27', 'p9 failed: ' + JSON.stringify(p9));

  const p10 = parseMessage('buatin list tanggal 27 september 2026');
  console.assert(p10.intent === 'SUMMARY_DAY' && p10.targetDate === '2026-09-27', 'p10 failed: ' + JSON.stringify(p10));

  const p11 = parseMessage('list pengeluaran kemarin');
  console.assert(p11.intent === 'LIST_EXPENSES' && p11.targetDate, 'p11 failed: ' + JSON.stringify(p11));

  const p12 = parseMessage('27 september 2026 beli tiket 500rb');
  console.assert(p12.intent === 'RECORD_EXPENSE' && p12.amount === 500000, 'p12 failed: ' + JSON.stringify(p12));

  const p13 = parseMessage('list pemasukan dan pengeluaran hari ini');
  console.assert(p13.intent === 'LIST_ALL', 'p13 failed: ' + JSON.stringify(p13));

  const p14 = parseMessage('list pengeluaran dan pemasukan kemarin');
  console.assert(p14.intent === 'LIST_ALL', 'p14 failed: ' + JSON.stringify(p14));

  const p14b = parseMessage('list pemasukan dan pengeluaran 27 - 28 september');
  console.assert(p14b.intent === 'LIST_ALL' && p14b.startDate === '2026-09-27' && p14b.endDate === '2026-09-28', 'p14b failed: ' + JSON.stringify(p14b));

  const p14c = parseMessage('list pemasukan dan pengeluaran bulan ini');
  console.assert(p14c.intent === 'LIST_ALL' && p14c.period === 'month' && p14c.startDate && p14c.endDate, 'p14c failed: ' + JSON.stringify(p14c));

  const p14d = parseMessage('list penyusutan minggu ini');
  console.assert(p14d.intent === 'SUMMARY_WEEK' || p14d.intent === 'LIST_EXPENSES', 'p14d failed: ' + JSON.stringify(p14d));

  const p14e = parseMessage('rekap laba bulan september 2026');
  console.assert(p14e.intent === 'SUMMARY_PROFIT' && p14e.period === 'month' && p14e.startDate && p14e.endDate, 'p14e failed: ' + JSON.stringify(p14e));

  const p14f = parseMessage('list pemasukan dan pengeluaran tahun 2025');
  console.assert(p14f.intent === 'LIST_ALL' && p14f.period === 'year' && p14f.startDate && p14f.endDate, 'p14f failed: ' + JSON.stringify(p14f));

  const p14g = parseMessage('list pengeluaran kategori transport');
  console.assert(p14g.intent === 'LIST_EXPENSES' && p14g.category === 'Transport', 'p14g failed: ' + JSON.stringify(p14g));

  // Flexible Subscription & Recurring Parsing Tests
  const p15 = parseMessage('list langganan');
  console.assert(p15.intent === 'LIST_RECURRING', 'p15 failed: ' + JSON.stringify(p15));

  const p16 = parseMessage('daftar langganan');
  console.assert(p16.intent === 'LIST_RECURRING', 'p16 failed: ' + JSON.stringify(p16));

  const p17 = parseMessage('cek langganan');
  console.assert(p17.intent === 'LIST_RECURRING', 'p17 failed: ' + JSON.stringify(p17));

  const p18 = parseMessage('langganan apa aja');
  console.assert(p18.intent === 'LIST_RECURRING', 'p18 failed: ' + JSON.stringify(p18));

  const p19 = parseMessage('langganan aktif');
  console.assert(p19.intent === 'LIST_RECURRING', 'p19 failed: ' + JSON.stringify(p19));

  const p20 = parseMessage('tolong cek langganan');
  console.assert(p20.intent === 'LIST_RECURRING', 'p20 failed: ' + JSON.stringify(p20));

  const p21 = parseMessage('buatin list langganan');
  console.assert(p21.intent === 'LIST_RECURRING', 'p21 failed: ' + JSON.stringify(p21));

  const p22 = parseMessage('langganan netflix 186k tgl 5');
  console.assert(p22.intent === 'ADD_RECURRING' && p22.amount === 186000 && p22.dueDate === 5 && p22.name === 'netflix', 'p22 failed: ' + JSON.stringify(p22));

  const p23 = parseMessage('langganan spotify 55rb tiap tgl 25');
  console.assert(p23.intent === 'ADD_RECURRING' && p23.amount === 55000 && p23.dueDate === 25 && p23.name === 'spotify', 'p23 failed: ' + JSON.stringify(p23));

  const p24 = parseMessage('tambah langganan wifi indihome 350k tgl 20');
  console.assert(p24.intent === 'ADD_RECURRING' && p24.amount === 350000 && p24.dueDate === 20 && p24.name === 'wifi indihome', 'p24 failed: ' + JSON.stringify(p24));

  const p25 = parseMessage('rutin gym 150k tiap bulan tgl 1');
  console.assert(p25.intent === 'ADD_RECURRING' && p25.amount === 150000 && p25.dueDate === 1 && p25.name === 'gym', 'p25 failed: ' + JSON.stringify(p25));

  const p26 = parseMessage('stop langganan netflix');
  console.assert(p26.intent === 'DELETE_RECURRING' && p26.name === 'netflix', 'p26 failed: ' + JSON.stringify(p26));

  const p27 = parseMessage('hapus langganan spotify');
  console.assert(p27.intent === 'DELETE_RECURRING' && p27.name === 'spotify', 'p27 failed: ' + JSON.stringify(p27));

  const p28 = parseMessage('berhenti langganan youtube');
  console.assert(p28.intent === 'DELETE_RECURRING' && p28.name === 'youtube', 'p28 failed: ' + JSON.stringify(p28));

  const p29 = parseMessage('cara langganan');
  console.assert(p29.intent === 'HELP_RECURRING', 'p29 failed: ' + JSON.stringify(p29));

  const p30 = parseMessage('download spreadsheet');
  console.assert(p30.intent === 'DOWNLOAD_SPREADSHEET', 'p30 failed: ' + JSON.stringify(p30));

  const p31 = parseMessage('unduh spreadsheet excel');
  console.assert(p31.intent === 'DOWNLOAD_SPREADSHEET', 'p31 failed: ' + JSON.stringify(p31));

  const p32 = parseMessage('edit 27 september 2026 jadi 250000');
  console.assert(p32.intent === 'EDIT_LAST' && p32.targetDate === '2026-09-27', 'p32 failed: ' + JSON.stringify(p32));

  const p33 = parseMessage('edit pengeluaran PERTAMINA ke tanggal 27 september 2026');
  console.assert(p33.intent === 'EDIT_LAST' && p33.name === 'PERTAMINA' && p33.newDate === '2026-09-27' && !p33.amount && !p33.note, 'p33 failed: ' + JSON.stringify(p33));

  // Broad natural-language edit/report coverage: old target, new value, and date must stay separate.
  const editNatural1 = parseMessage('edit pengeluaran beli nasi padang hari ini jadi beli udang keju + nasi 16k');
  console.assert(editNatural1.intent === 'EDIT_LAST' && editNatural1.name === 'nasi padang' && editNatural1.note === 'udang keju + nasi' && editNatural1.amount === 16000 && editNatural1.targetDate, 'editNatural1 failed: ' + JSON.stringify(editNatural1));

  const editNatural2 = parseMessage('edit pengeluaran beli udang keju + nasi hari ini jadi beli nasi ayam geprek 19k');
  console.assert(editNatural2.intent === 'EDIT_LAST' && editNatural2.name === 'udang keju nasi' && editNatural2.note === 'nasi ayam geprek' && editNatural2.amount === 19000 && editNatural2.targetDate, 'editNatural2 failed: ' + JSON.stringify(editNatural2));

  const editNatural3 = parseMessage('ubah pengeluaran nasi padang tanggal 7 oktober 2026 jadi nasi ayam geprek 19rb');
  console.assert(editNatural3.intent === 'EDIT_LAST' && editNatural3.name === 'nasi padang' && editNatural3.note === 'nasi ayam geprek' && editNatural3.amount === 19000 && editNatural3.targetDate === '2026-10-07', 'editNatural3 failed: ' + JSON.stringify(editNatural3));

  const editNatural4 = parseMessage('ganti catatan kopi kemarin menjadi latte');
  console.assert(editNatural4.intent === 'EDIT_LAST' && editNatural4.name === 'kopi' && editNatural4.note === 'latte' && editNatural4.targetDate, 'editNatural4 failed: ' + JSON.stringify(editNatural4));

  const editNatural5 = parseMessage('edit kategori pengeluaran bensin kemarin jadi Bills');
  console.assert(editNatural5.intent === 'EDIT_LAST' && editNatural5.name === 'bensin' && editNatural5.category === 'Bills' && editNatural5.targetDate, 'editNatural5 failed: ' + JSON.stringify(editNatural5));

  const monthOnlyExpenses = parseMessage('pengeluaran bulan september');
  console.assert(monthOnlyExpenses.intent === 'LIST_EXPENSES' && monthOnlyExpenses.period === 'month' && monthOnlyExpenses.startDate, 'monthOnlyExpenses failed: ' + JSON.stringify(monthOnlyExpenses));

  const terseYearIncome = parseMessage('pemasukan 2025');
  console.assert(terseYearIncome.intent === 'LIST_INCOMES' && terseYearIncome.period === 'year' && terseYearIncome.startDate, 'terseYearIncome failed: ' + JSON.stringify(terseYearIncome));

  const allTransactionsYear = parseMessage('semua transaksi 2026');
  console.assert(allTransactionsYear.intent === 'LIST_ALL' && allTransactionsYear.period === 'year' && allTransactionsYear.startDate, 'allTransactionsYear failed: ' + JSON.stringify(allTransactionsYear));

  const datedBuy = parseMessage('7 oktober 2026 beli nasi padang 25rb');
  console.assert(datedBuy.intent === 'RECORD_EXPENSE' && datedBuy.note === 'nasi padang' && datedBuy.targetDate === '2026-10-07', 'datedBuy failed: ' + JSON.stringify(datedBuy));

  const p34 = parseQueryDate('struk tanggal 27 september 2026');
  console.assert(p34 && p34.targetDate === '2026-09-27', 'p34 failed: ' + JSON.stringify(p34));

  const p35 = parseMessage('penjualan pulsa sebesar 150k buat 28 agustus 2026');
  console.assert(p35.intent === 'RECORD_INCOME' && p35.amount === 150000 && p35.note === 'penjualan pulsa' && p35.targetDate === '2026-08-28', 'p35 failed: ' + JSON.stringify(p35));

  const p36 = parseMessage('masuk 150k penjualan pulsa buat 28 agustus 2026');
  console.assert(p36.intent === 'RECORD_INCOME' && p36.note === 'penjualan pulsa' && p36.targetDate === '2026-08-28', 'p36 failed: ' + JSON.stringify(p36));

  const p37 = parseMessage('keluar 50rb bensin tanggal 28 agustus 2026');
  console.assert(p37.intent === 'RECORD_EXPENSE' && p37.note === 'bensin' && p37.targetDate === '2026-08-28', 'p37 failed: ' + JSON.stringify(p37));

  const p38 = parseMessage('50rb bensin buat 28 agustus 2026');
  console.assert(p38.intent === 'RECORD_EXPENSE' && p38.note === 'bensin' && p38.targetDate === '2026-08-28', 'p38 failed: ' + JSON.stringify(p38));

  const previousOcrKey = process.env.OCR_SPACE_API_KEY;
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  let ocrParsedText = '20/12/2019 17:40:37 (CU)\nSTRUK PEMBAYARAN TAGIHAN\nPDAM\nIDPEL : 13802\nNAMA : WINA HARTIKA\nTAGIHAN : RP. 85.100,00\nBIAYA ADM : RP. 2.500,00\nTOTAL BAYAR : RP. 87.600,00';
  process.env.OCR_SPACE_API_KEY = 'test-ocr-key';
  delete process.env.GEMINI_API_KEY;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      IsErroredOnProcessing: false,
      ParsedResults: [{ ParsedText: ocrParsedText }]
    })
  });
  try {
    const ocrResult = await scanReceiptImage(Buffer.from('test-image'), 'image/jpeg', 'user_ocr_fallback');
    console.assert(ocrResult.success && ocrResult.transaction?.amount === 87600, 'OCR localized amount parsing failed: ' + ocrResult.replyText);
    console.assert(ocrResult.transaction?.category === 'Bills', 'OCR category detection failed: ' + JSON.stringify(ocrResult.transaction));
    console.assert(ocrResult.transaction?.note.startsWith('PDAM'), 'OCR merchant detection failed: ' + JSON.stringify(ocrResult.transaction));

    const { createRequire } = await import('module');
    const cjsGenAI = createRequire(import.meta.url)('@google/generative-ai');
    const prevEsmModel = GoogleGenerativeAI.prototype.getGenerativeModel;
    const prevCjsModel = cjsGenAI.GoogleGenerativeAI.prototype.getGenerativeModel;

    const setMockGenerativeModel = (fn) => {
      GoogleGenerativeAI.prototype.getGenerativeModel = fn;
      cjsGenAI.GoogleGenerativeAI.prototype.getGenerativeModel = fn;
    };
    const restoreMockGenerativeModel = () => {
      GoogleGenerativeAI.prototype.getGenerativeModel = prevEsmModel;
      cjsGenAI.GoogleGenerativeAI.prototype.getGenerativeModel = prevCjsModel;
    };

    // Test 1: Gemini Vision Prioritized First (Primary Engine)
    setMockGenerativeModel(() => ({
      generateContent: async () => ({
        response: {
          text: () => JSON.stringify({
            total_amount: 99000,
            merchant: 'Gemini Primary Cafe',
            category: 'Food',
            items: 'Latte, Croissant',
            qty: 2,
            note: 'Gemini Primary Cafe - Latte, Croissant'
          })
        }
      })
    }));
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    try {
      const geminiPriorityResult = await scanReceiptImage(Buffer.from('test-image'), 'image/jpeg', 'user_gemini_priority');
      console.assert(geminiPriorityResult.success && geminiPriorityResult.transaction?.amount === 99000 && geminiPriorityResult.replyText.includes('Dianalisis AI'), 'Gemini Vision should be prioritized first: ' + geminiPriorityResult.replyText);
    } finally {
      restoreMockGenerativeModel();
      delete process.env.GEMINI_API_KEY;
    }

    // Test 2: Fallback to OCR.Space when Gemini Vision fails/errors
    setMockGenerativeModel(() => {
      throw new Error('Gemini Vision simulated outage / quota limit.');
    });
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    try {
      const ocrFallbackResult = await scanReceiptImage(Buffer.from('test-image'), 'image/jpeg', 'user_ocr_priority');
      console.assert(ocrFallbackResult.success && ocrFallbackResult.transaction?.amount === 87600 && ocrFallbackResult.replyText.includes('OCR.Space'), 'OCR should automatically take over when Gemini fails: ' + ocrFallbackResult.replyText);
    } finally {
      restoreMockGenerativeModel();
      delete process.env.GEMINI_API_KEY;
    }

    ocrParsedText = 'BESALI CAFE\nSUBTOTAL 277,000';
    const subtotalResult = await scanReceiptImage(Buffer.from('test-image'), 'image/jpeg', 'user_ocr_subtotal');
    console.assert(subtotalResult.success && subtotalResult.transaction?.amount === 277000, 'Subtotal fallback failed: ' + subtotalResult.replyText);
    console.assert(subtotalResult.replyText.includes('nominal dicatat dari subtotal'), 'Subtotal fallback warning missing: ' + subtotalResult.replyText);
    ocrParsedText = 'Gramedia Bookstore\n1 Buku Tulis 15.000\n1 Pulpen Gel 10.000\nTOTAL ITEMS : 2\nTOTAL BAYAR : 25.000';
    const ocrQtyReceipt = await scanReceiptImage(Buffer.from('test-image'), 'image/jpeg', 'user_ocr_items_qty');
    console.assert(ocrQtyReceipt.success && ocrQtyReceipt.transaction?.amount === 25000 && ocrQtyReceipt.transaction?.qty === 2, 'Receipt qty extraction failed: ' + ocrQtyReceipt.replyText);
    console.assert(ocrQtyReceipt.replyText.includes('Qty:* 2'), 'Receipt reply missing qty line: ' + ocrQtyReceipt.replyText);

    ocrParsedText = 'SPBU PERTAMINA\nBENSIN 100.000';
    const unreadableTotal = await scanReceiptImage(Buffer.from('test-image'), 'image/jpeg', 'user_ocr_error');
    console.assert(!unreadableTotal.success && unreadableTotal.replyText.includes('OCR.Space tidak dapat mengenali total pembayaran'), 'OCR fallback error detail missing: ' + unreadableTotal.replyText);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousOcrKey === undefined) delete process.env.OCR_SPACE_API_KEY;
    else process.env.OCR_SPACE_API_KEY = previousOcrKey;
    if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGeminiKey;
  }

  const exportedWorkbookBuffer = await buildSpreadsheet([
    { id: 'tx-private-1', user_id: 'user_export_test', type: 'income', amount: 500000, category: 'Income', note: 'Gaji', raw_message: '', source: 'manual', created_at: '2026-09-01T12:00:00.000Z' },
    { id: 'tx-private-2', user_id: 'user_export_test', type: 'expense', amount: 125000, category: 'Food', note: 'Makan', raw_message: '', source: 'manual', created_at: '2026-09-02T12:00:00.000Z' },
    { id: 'tx-other-user', user_id: 'user_other_export_test', type: 'expense', amount: 900000, category: 'Transport', note: 'PRIVATE OTHER USER', raw_message: '', source: 'manual', created_at: '2026-09-02T12:00:00.000Z' }
  ], [
    { id: 'rec-private', user_id: 'user_export_test', name: 'Internet', amount: 80000, category: 'Bills', due_date: 10, active: true, last_run_date: '2026-09-10', created_at: '2026-08-01T12:00:00.000Z' },
    { id: 'rec-other-user', user_id: 'user_other_export_test', name: 'Private Subscription', amount: 700000, category: 'Bills', due_date: 15, active: true, created_at: '2026-08-01T12:00:00.000Z' }
  ], 'user_export_test');
  const exportedWorkbook = new ExcelJS.Workbook();
  await exportedWorkbook.xlsx.load(exportedWorkbookBuffer);
  const exportedTransactions = exportedWorkbook.getWorksheet('transactions');
  const exportedRecurring = exportedWorkbook.getWorksheet('recurring_expenses');
  const exportedDashboard = exportedWorkbook.getWorksheet('Dashboard');
  const exportedSheetValues = JSON.stringify([
    exportedTransactions?.getSheetValues(),
    exportedRecurring?.getSheetValues()
  ]);
  console.assert(exportedWorkbook.worksheets.length === 3, 'Spreadsheet must contain exactly three sheets.');
  console.assert(Boolean(exportedTransactions && exportedRecurring && exportedDashboard), 'Spreadsheet sheet names are incorrect.');
  console.assert(exportedTransactions?.rowCount === 3 && !exportedSheetValues.includes('PRIVATE OTHER USER'), 'Transaction export leaked another user or has unexpected rows.');
  console.assert(exportedRecurring?.rowCount === 2 && !exportedSheetValues.includes('Private Subscription'), 'Recurring export leaked another user or has unexpected rows.');
  let hasRecurringTotal = false;
  exportedDashboard?.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.value === 80000) hasRecurringTotal = true;
    });
  });
  console.assert(hasRecurringTotal, 'Dashboard recurring monthly total is incorrect.');

  // Tests for Qty & Clean Note
  console.log('--- Testing Qty & Clean Note ---');
  const q1 = parseMessage('penjualan es teh manis 30 pcs sebesar 250k');
  console.assert(q1.intent === 'RECORD_INCOME' && q1.amount === 250000 && q1.qty === 30 && q1.note === 'penjualan es teh manis', 'q1 failed: ' + JSON.stringify(q1));

  const q2 = parseMessage('beli ayam geprek 5 porsi seharga 75000');
  console.assert(q2.intent === 'RECORD_EXPENSE' && q2.amount === 75000 && q2.qty === 5 && q2.note === 'ayam geprek', 'q2 failed: ' + JSON.stringify(q2));

  const q3 = parseMessage('order kopi susu 3 cup total 45k');
  console.assert(q3.intent === 'RECORD_EXPENSE' && q3.amount === 45000 && q3.qty === 3 && q3.note === 'kopi susu', 'q3 failed: ' + JSON.stringify(q3));

  const q4 = parseMessage('penjualan 100 pcs kaos polos senilai 3.5jt');
  console.assert(q4.intent === 'RECORD_INCOME' && q4.amount === 3500000 && q4.qty === 100 && q4.note === 'penjualan kaos polos', 'q4 failed: ' + JSON.stringify(q4));

  const q5 = parseMessage('keluar 50rb 2 bungkus rokok');
  console.assert(q5.intent === 'RECORD_EXPENSE' && q5.amount === 50000 && q5.qty === 2 && q5.note === 'rokok', 'q5 failed: ' + JSON.stringify(q5));

  const q6 = parseMessage('masuk 250k hasil jual baju 5 pcs');
  console.assert(q6.intent === 'RECORD_INCOME' && q6.amount === 250000 && q6.qty === 5 && q6.note === 'hasil jual baju', 'q6 failed: ' + JSON.stringify(q6));

  const q7 = parseMessage('10k es teh 2 cup');
  console.assert(q7.intent === 'RECORD_EXPENSE' && q7.amount === 10000 && q7.qty === 2 && q7.note === 'es teh', 'q7 failed: ' + JSON.stringify(q7));

  const q8 = parseMessage('catat pengeluaran 50rb 2 bungkus rokok');
  console.assert(q8.intent === 'RECORD_EXPENSE' && q8.amount === 50000 && q8.qty === 2 && q8.note === 'rokok', 'q8 failed: ' + JSON.stringify(q8));

  const q9 = parseMessage('pengeluaran 250k es teh manis 30 pcs');
  console.assert(q9.intent === 'RECORD_EXPENSE' && q9.amount === 250000 && q9.qty === 30 && q9.note === 'es teh manis', 'q9 failed: ' + JSON.stringify(q9));

  const q10 = parseMessage('beli es teh manis 30 pcs sebesar 250k');
  console.assert(q10.intent === 'RECORD_EXPENSE' && q10.amount === 250000 && q10.qty === 30 && q10.note === 'es teh manis', 'q10 failed: ' + JSON.stringify(q10));

  const q11 = parseMessage('catat pengeluaran 250k buat es teh manis 30 pcs');
  console.assert(q11.intent === 'RECORD_EXPENSE' && q11.amount === 250000 && q11.qty === 30 && q11.note === 'es teh manis', 'q11 failed: ' + JSON.stringify(q11));
  console.log('✓ Qty and clean note tests passed!');

  console.log('✓ parseMessage passed!');

  console.log('--- 3b. Testing Natural-Language Normalization (slang/typo/word numbers) ---');
  const n1 = parseMessage('keluar 25rb gopud makan siang');
  console.assert(n1.intent === 'RECORD_EXPENSE' && n1.amount === 25000 && n1.note === 'gopud makan siang', 'n1 failed: ' + JSON.stringify(n1));

  const n2 = parseMessage('beliin kopi susu 15 ribu');
  console.assert(n2.intent === 'RECORD_EXPENSE' && n2.amount === 15000 && n2.note === 'kopi susu', 'n2 failed: ' + JSON.stringify(n2));

  const n3 = parseMessage('masuk seratus lima puluh ribu hasil jualan baju');
  console.assert(n3.intent === 'RECORD_INCOME' && n3.amount === 150000, 'n3 failed (word numbers): ' + JSON.stringify(n3));

  const n4 = parseMessage('keluar dua belas ribu buat parkir');
  console.assert(n4.intent === 'RECORD_EXPENSE' && n4.amount === 12000, 'n4 failed (dua belas ribu): ' + JSON.stringify(n4));

  const n5 = parseMessage('catat pengeluarann 50rb beli sabun');
  console.assert(n5.intent === 'RECORD_EXPENSE' && n5.amount === 50000, 'n5 failed (typo pengeluarann): ' + JSON.stringify(n5));

  const n6 = parseMessage('makan siang 45rb dan kopi susu 18rb');
  console.assert(n6.intent === 'RECORD_EXPENSE', 'n6 multi-transaction should be handled upstream; here parsed as: ' + JSON.stringify(n6));
  console.log('✓ Normalization tests passed!');

  console.log('--- 3c. Testing Analysis Request Detection ---');
  console.assert(isAnalysisRequest('rata-rata pengeluaran bulan ini'), 'analysis avg should be true');
  console.assert(isAnalysisRequest('pengeluaran terbesar minggu ini'), 'analysis biggest should be true');
  console.assert(isAnalysisRequest('bandingin pemasukan bulan ini sama bulan lalu'), 'analysis compare should be true');
  console.assert(isAnalysisRequest('rekap bulan ini') === false, 'plain rekap should NOT be analysis');
  console.log('✓ Analysis request detection passed!');

  console.log('--- 3d. Testing OCR Receipt Text Extraction ---');
  {
    const ocrExtract = (text) => {
      try { return extractReceiptFromOcrText(text); } catch { return { total_amount: 0 }; }
    };

    // Kasus lama: total eksplisit, subtotal, qty.
    const pdam = ocrExtract('20/12/2019 17:40:37 (CU)\nSTRUK PEMBAYARAN TAGIHAN\nPDAM\nIDPEL : 13802\nNAMA : WINA HARTIKA\nTAGIHAN : RP. 85.100,00\nBIAYA ADM : RP. 2.500,00\nTOTAL BAYAR : RP. 87.600,00');
    console.assert(pdam.total_amount === 87600 && pdam.merchant === 'PDAM', 'OCR PDAM failed: ' + JSON.stringify(pdam));

    const gramedia = ocrExtract('Gramedia Bookstore\n1 Buku Tulis 15.000\n1 Pulpen Gel 10.000\nTOTAL ITEMS : 2\nTOTAL BAYAR : 25.000');
    console.assert(gramedia.total_amount === 25000 && gramedia.qty === 2, 'OCR gramedia failed: ' + JSON.stringify(gramedia));

    // "TOTAL ITEM/QTY: N" tidak boleh terbaca sebagai nominal total.
    const qtyGuard = ocrExtract('TOKO BAJU\n2 Kemeja 75.000\nTOTAL ITEM : 2\nTOTAL BAYAR 75.000');
    console.assert(qtyGuard.total_amount === 75000, 'OCR qty guard failed: ' + JSON.stringify(qtyGuard));

    const qtyOnly = ocrExtract('TOKO\n1 Baju 120.000\nTOTAL QTY: 1');
    console.assert(qtyOnly.total_amount === 0, 'OCR qty-only should fail: ' + JSON.stringify(qtyOnly));

    // Nominal = uang diserahkan − kembalian, hanya bila tidak ada total eksplisit.
    const tunaiKembali = ocrExtract('INDOMARET\n1 Susu 25.000\nTUNAI 50.000\nKEMBALI 25.000');
    console.assert(tunaiKembali.total_amount === 25000, 'OCR tunai+kembali failed: ' + JSON.stringify(tunaiKembali));

    const totalBeatsTendered = ocrExtract('ALFAMART\n2 Roti 18.000\nTOTAL BAYAR 18.000\nTUNAI 20.000\nKEMBALI 2.000');
    console.assert(totalBeatsTendered.total_amount === 18000, 'OCR total beats tendered failed: ' + JSON.stringify(totalBeatsTendered));

    // Nominal di baris berikutnya dari label.
    const amountNextLine = ocrExtract('WARUNG\n2 Es Teh 6.000\nTOTAL BAYAR\nRp6.000');
    console.assert(amountNextLine.total_amount === 6000, 'OCR amount next line failed: ' + JSON.stringify(amountNextLine));

    // Merchant: alamat, NPWP, dan terima kasih tidak boleh jadi nama toko.
    const merchantFilter = ocrExtract('Jl. Sudirman No. 12\nTERIMA KASIH\nKOPI KENANGAN\n1 Latte 32.000\nTOTAL 32.000');
    console.assert(/KOPI KENANGAN/i.test(merchantFilter.merchant), 'OCR merchant filter failed: ' + JSON.stringify(merchantFilter));

    const merchantNpwp = ocrExtract('NPWP 01.234.567.8-901.000\nTOKO ELEKTRONIK\n1 Kabel 45.000\nTOTAL 45.000');
    console.assert(/TOKO ELEKTRONIK/i.test(merchantNpwp.merchant), 'OCR merchant NPWP failed: ' + JSON.stringify(merchantNpwp));

    // Total tidak wajar dibanding penjumlahan item → peringatan.
    const mismatch = ocrExtract('TOKO\n1 Baju 50.000\nTOTAL BAYAR 750.000');
    console.assert(mismatch.warning && mismatch.warning.includes('perlu dicek'), 'OCR mismatch warning missing: ' + JSON.stringify(mismatch));

    const consistent = ocrExtract('TOKO\n1 Baju 50.000\nTOTAL BAYAR 50.000');
    console.assert(consistent.total_amount === 50000 && !consistent.warning, 'OCR consistent should have no warning: ' + JSON.stringify(consistent));
    console.log('✓ OCR receipt extraction passed!');
  }

  console.log('--- 4. Testing End-to-End Business Logic ---');
  const res1 = await handleUserMessage('keluar 25000 makan siang');
  console.assert(res1.success && res1.replyText.includes('Rp25.000'), 'res1 failed');
  console.log('Recorded expense: OK');

  const res2 = await handleUserMessage('masuk 5000000 gaji');
  console.assert(res2.success && res2.replyText.includes('Rp5.000.000'), 'res2 failed');
  console.log('Recorded income: OK');

  const dateAwareIncome = await handleUserMessage('penjualan pulsa sebesar 150k buat 28 agustus 2026', 'user_note_date');
  console.assert(dateAwareIncome.success && dateAwareIncome.replyText.includes('Catatan:* penjualan pulsa') && dateAwareIncome.replyText.includes('Tanggal:* 28 Agustus 2026') && !dateAwareIncome.replyText.includes('Catatan:* penjualan pulsa sebesar buat'), 'Date-aware income note failed: ' + dateAwareIncome.replyText);

  const res3 = await handleUserMessage('ringkasan bulan');
  console.assert(res3.success && res3.replyText.includes('Rp25.000'), 'res3 failed: ' + res3.replyText);
  console.log('Summary month: OK');

  const res4 = await handleUserMessage('edit terakhir 35000');
  console.assert(res4.success && res4.replyText.includes('Rp35.000'), 'res4 failed');
  console.log('Edit last: OK');

  const res5 = await handleUserMessage('tambah rutin 150000 netflix tgl 5');
  console.assert(res5.success && res5.replyText.includes('Netflix'), 'res5 failed');
  console.log('Add recurring: OK');

  const res6 = await handleUserMessage('list rutin');
  console.assert(res6.success && res6.replyText.includes('Netflix'), 'res6 failed');
  console.log('List recurring: OK');

  const res7 = await handleUserMessage('hapus terakhir');
  console.assert(res7.success && res7.replyText.includes('Dibatalkan'), 'res7 failed');
  console.log('Delete last: OK');

  console.log('--- 4b. Testing Conversation Memory (follow-up) ---');
  const fu1 = await handleUserMessage('beli nasi goreng 25rb', 'user_followup');
  console.assert(fu1.success && fu1.replyText.includes('Rp25.000'), 'fu1 failed: ' + fu1.replyText);

  // "tambahin telur 5rb" sudah lengkap (nominal ada) sehingga dicatat normal.
  const fu2 = await handleUserMessage('tambahin telur 5rb', 'user_followup');
  console.assert(fu2.success && fu2.replyText.includes('Rp5.000'), 'fu2 failed: ' + fu2.replyText);

  // Nominal saja setelah transaksi gagal tercatat (tanpa nominal) → lengkapi transaksi.
  const fu3 = await handleUserMessage('gua keluar 25rb', 'user_followup2');
  console.assert(fu3.success && fu3.replyText.includes('Rp25.000'), 'fu3 failed: ' + fu3.replyText);

  // "hapus yang tadi" menghapus transaksi terakhir dari percakapan ini.
  const fu5 = await handleUserMessage('hapus yang tadi', 'user_followup2');
  console.assert(fu5.success && fu5.replyText.includes('Dibatalkan'), 'fu5 failed: ' + fu5.replyText);
  console.log('Conversation memory: OK');

  console.log('--- 4c. Testing Multi-Transaction Split ---');
  const mt1 = await handleUserMessage('beli nasi 20rb dan kopi 15rb', 'user_multi');
  console.assert(
    mt1.success && mt1.replyText.includes('2 transaksi tercatat') && mt1.replyText.includes('Rp20.000') && mt1.replyText.includes('Rp15.000'),
    'mt1 failed: ' + mt1.replyText
  );

  const mt2 = await handleUserMessage('keluar makan 30rb, ojek 12rb, parkir 5rb', 'user_multi');
  console.assert(
    mt2.success && mt2.replyText.includes('3 transaksi tercatat') && mt2.replyText.includes('Rp30.000'),
    'mt2 failed: ' + mt2.replyText
  );

  // "list pemasukan dan pengeluaran" adalah SATU intent, bukan dipecah.
  const mt3 = await handleUserMessage('list pemasukan dan pengeluaran', 'user_multi');
  console.assert(mt3.success && !mt3.replyText.includes('transaksi tercatat dari satu pesan'), 'mt3 split wrongly: ' + mt3.replyText);
  console.log('Multi-transaction: OK');

  const qtyIncome = await handleUserMessage('penjualan es teh manis 30 pcs sebesar 250k', 'user_qty_test');
  console.assert(
    qtyIncome.success &&
    qtyIncome.replyText.includes('Rp250.000') &&
    qtyIncome.replyText.includes('Qty:* 30') &&
    qtyIncome.replyText.includes('Catatan:* penjualan es teh manis') &&
    !qtyIncome.replyText.includes('sebesar'),
    'Qty income test failed: ' + qtyIncome.replyText
  );

  const qtyExpense = await handleUserMessage('catat pengeluaran 50rb 2 bungkus rokok', 'user_exp_qty');
  console.assert(
    qtyExpense.success &&
    qtyExpense.replyText.includes('Rp50.000') &&
    qtyExpense.replyText.includes('Qty:* 2') &&
    qtyExpense.replyText.includes('Pengeluaran Dicatat') &&
    qtyExpense.replyText.includes('Catatan:* rokok'),
    'Qty expense test failed: ' + qtyExpense.replyText
  );

  const res8 = await handleUserMessage('list pemasukan tanggal 27 september 2026');
  console.assert(res8.success && res8.replyText.includes('27 September 2026'), 'res8 failed: ' + res8.replyText);
  console.log('List incomes by date: OK');

  const res9 = await handleUserMessage('buatin list tanggal 27 september 2026');
  console.assert(res9.success && res9.replyText.includes('27 September 2026'), 'res9 failed: ' + res9.replyText);
  console.log('Summary list by date: OK');

  const res10 = await handleUserMessage('list pemasukan dan pengeluaran hari ini');
  console.assert(res10.success && res10.replyText.includes('PEMASUKAN') && res10.replyText.includes('PENGELUARAN'), 'res10 failed: ' + res10.replyText);
  console.log('List all (incomes and expenses): OK');

  const rangeA = await handleUserMessage('27 september 2026 makan siang 45rb', 'user_range');
  const rangeB = await handleUserMessage('28 september 2026 makan siang 30rb', 'user_range');
  console.assert(rangeA.success && rangeB.success, 'range record failed');
  const rangeList = await handleUserMessage('list pemasukan dan pengeluaran 27 - 28 september', 'user_range');
  console.assert(rangeList.success && rangeList.replyText.includes('27 September 2026') && rangeList.replyText.includes('Rp45.000') && rangeList.replyText.includes('Rp30.000'), 'range list failed: ' + rangeList.replyText);
  console.log('Date range list: OK');

  const historicalDelete = await handleUserMessage('hapus transaksi 27 september 2026', 'user_range');
  console.assert(historicalDelete.success && historicalDelete.replyText.includes('27 September 2026'), 'historical delete output failed: ' + historicalDelete.replyText);
  console.log('Historical delete output: OK');

  const res11 = await handleUserMessage('langganan spotify 55rb tiap tgl 25');
  console.assert(res11.success && res11.replyText.includes('Spotify'), 'res11 failed: ' + res11.replyText);
  console.log('Add recurring via flexible "langganan": OK');

  const res12 = await handleUserMessage('list langganan');
  console.assert(res12.success && res12.replyText.includes('Spotify'), 'res12 failed: ' + res12.replyText);
  console.log('List recurring via "list langganan": OK');

  const res13 = await handleUserMessage('stop langganan spotify');
  console.assert(res13.success && res13.replyText.includes('Spotify'), 'res13 failed: ' + res13.replyText);
  console.log('Stop recurring via "stop langganan": OK');

  const menuRes = await handleUserMessage('menu');
  console.assert(menuRes.success && menuRes.replyText.includes('Expense Bot Menu'), 'menu response should be successful: ' + menuRes.replyText);
  console.log('Menu response: OK');

  const helpRes = await handleUserMessage('bantuan');
  console.assert(helpRes.success && helpRes.replyText.includes('Format Pesan') || helpRes.replyText.includes('Panduan'), 'help response should be successful: ' + helpRes.replyText);
  console.log('Help response: OK');

  const downloadRes = await handleUserMessage('download spreadsheet', 'user_export');
  console.assert(downloadRes.success && downloadRes.replyText.includes('/api/download-spreadsheet?userId=user_export') && downloadRes.replyText.includes('hanya mencakup transaksi milik user ini saja') && downloadRes.replyText.includes('recurring_expenses'), 'download spreadsheet response should include a private multi-sheet download link: ' + downloadRes.replyText);
  console.log('Download spreadsheet response: OK');

  const historicalDeleteOutput = await handleUserMessage('27 september 2026 makan siang 45rb', 'user_output_delete');
  console.assert(historicalDeleteOutput.success, 'historical delete setup failed: ' + historicalDeleteOutput.replyText);
  const deleteOutput = await handleUserMessage('hapus transaksi 27 september 2026', 'user_output_delete');
  console.assert(deleteOutput.success && deleteOutput.replyText.includes('27 September 2026'), 'historical delete output missing date label: ' + deleteOutput.replyText);
  console.log('Historical delete output with date label: OK');

  const specificDeleteUser = 'user_specific_delete_qa';
  const specificDeleteSetup = await handleUserMessage('pengeluaran first media 450660 tanggal 28 september 2026', specificDeleteUser);
  console.assert(specificDeleteSetup.success, 'specific delete setup failed: ' + specificDeleteSetup.replyText);
  const specificDelete = await handleUserMessage('hapus pengeluaran first media sebesar 450k tanggal 28 september', specificDeleteUser);
  console.assert(specificDelete.success && specificDelete.replyText.includes('Rp450.660'), 'specific approximate delete failed: ' + specificDelete.replyText);
  console.log('Delete by description, approximate amount, and explicit date: OK');

  const historicalEditOutput = await handleUserMessage('27 september 2026 masuk 200000 freelance', 'user_output_edit');
  console.assert(historicalEditOutput.success, 'historical edit setup failed: ' + historicalEditOutput.replyText);
  const editOutput = await handleUserMessage('edit 27 september 2026 jadi 250000', 'user_output_edit');
  console.assert(editOutput.success && editOutput.replyText.includes('27 September 2026'), 'historical edit output missing date label: ' + editOutput.replyText);
  console.log('Historical edit output with date label: OK');

  console.log('--- 5. Testing Historical Date Transaction Commands ---');
  const pastExpense = await handleUserMessage('27 september 2026 makan siang 45rb', 'user_date');
  console.assert(pastExpense.success && pastExpense.replyText.includes('Rp45.000'), 'Historical expense record failed: ' + pastExpense.replyText);

  const pastDelete = await handleUserMessage('hapus transaksi 27 september 2026', 'user_date');
  console.assert(pastDelete.success && pastDelete.replyText.includes('Dibatalkan'), 'Historical delete failed: ' + pastDelete.replyText);

  const pastIncome = await handleUserMessage('27 september 2026 masuk 200000 freelance', 'user_date');
  console.assert(pastIncome.success && pastIncome.replyText.includes('Rp200.000'), 'Historical income record failed: ' + pastIncome.replyText);

  const pastEdit = await handleUserMessage('edit 27 september 2026 jadi 250000', 'user_date');
  console.assert(pastEdit.success && pastEdit.replyText.includes('Rp250.000'), 'Historical edit failed: ' + pastEdit.replyText);

  const datedExpense = await handleUserMessage('28 september 2026 PERTAMINA 100rb', 'user_move_date');
  console.assert(datedExpense.success, 'Date move setup failed: ' + datedExpense.replyText);
  console.assert(datedExpense.replyText.includes('Rp100.000'), 'Date move setup amount parsed incorrectly: ' + datedExpense.replyText);
  const moveDate = await handleUserMessage('edit pengeluaran PERTAMINA ke tanggal 27 september 2026', 'user_move_date');
  console.assert(moveDate.success && moveDate.replyText.includes('Tanggal: 28 September 2026 ➔ *27 September 2026*'), 'Date move failed: ' + moveDate.replyText);
  const movedList = await handleUserMessage('list pengeluaran 27 september 2026', 'user_move_date');
  console.assert(movedList.success && movedList.replyText.includes('Rp100.000'), 'Moved transaction not found on new date: ' + movedList.replyText);

  console.log('Historical date commands: OK');

  console.log('--- 6. Testing Multi-User Data Isolation ---');
  // User A records 30k coffee
  await handleUserMessage('kopi 30rb', 'user_A');
  // User B records 100k book
  await handleUserMessage('buku 100rb', 'user_B');

  // User A summary should only show 30k
  const summaryA = await handleUserMessage('pengeluaran hari ini', 'user_A');
  console.assert(summaryA.success && summaryA.replyText.includes('Rp30.000') && !summaryA.replyText.includes('Rp100.000'), 'User A data isolation failed: ' + summaryA.replyText);

  // User B summary should only show 100k
  const summaryB = await handleUserMessage('pengeluaran hari ini', 'user_B');
  console.assert(summaryB.success && summaryB.replyText.includes('Rp100.000') && !summaryB.replyText.includes('Rp30.000'), 'User B data isolation failed: ' + summaryB.replyText);

  // User A adds subscription
  await handleUserMessage('langganan netflix 186k tgl 5', 'user_A');

  // User B checks subscriptions -> should NOT see Netflix
  const listB = await handleUserMessage('list langganan', 'user_B');
  console.assert(listB.success && !listB.replyText.includes('Netflix'), 'User B should not see User A subscriptions: ' + listB.replyText);

  // User A checks subscriptions -> should see Netflix
  const listA = await handleUserMessage('list langganan', 'user_A');
  console.assert(listA.success && listA.replyText.includes('Netflix'), 'User A should see Netflix: ' + listA.replyText);

  // User B deletes their last transaction
  const delB = await handleUserMessage('hapus terakhir', 'user_B');
  console.assert(delB.success && delB.replyText.includes('Rp100.000'), 'User B delete last failed: ' + delB.replyText);

  // User A's transaction should still be intact
  const verifyA = await handleUserMessage('pengeluaran hari ini', 'user_A');
  console.assert(verifyA.success && verifyA.replyText.includes('Rp30.000'), 'User A transaction was improperly deleted: ' + verifyA.replyText);

  console.log('Multi-user data isolation: OK');

  if (assertionFailures.length > 0) {
    throw new Error(`${assertionFailures.length} regression assertion(s) failed.`);
  }
  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! EVERYTHING WORKS & MAKES SENSE.');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
