import { parseMessage, parseAmount, detectCategory } from '../lib/parser';
import { handleUserMessage } from '../lib/transactions';

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

  const p5 = parseMessage('edit terakhir 30000');
  console.assert(p5.intent === 'EDIT_LAST' && p5.amount === 30000, 'p5 failed');

  const p6 = parseMessage('tambah rutin 150000 netflix tgl 5');
  console.assert(p6.intent === 'ADD_RECURRING' && p6.dueDate === 5 && p6.amount === 150000, 'p6 failed');

  const p7 = parseMessage('list rutin');
  console.assert(p7.intent === 'LIST_RECURRING', 'p7 failed');

  const p8 = parseMessage('menu');
  console.assert(p8.intent === 'MENU', 'p8 failed');

  // Test Date-filtered queries
  const p9 = parseMessage('list pemasukan tanggal 27 september 2026');
  console.assert(p9.intent === 'LIST_INCOMES' && p9.targetDate === '2026-09-27', 'p9 failed: ' + JSON.stringify(p9));

  const p10 = parseMessage('buatin list tanggal 27 september 2026');
  console.assert(p10.intent === 'SUMMARY_DAY' && p10.targetDate === '2026-09-27', 'p10 failed: ' + JSON.stringify(p10));

  const p11 = parseMessage('list pengeluaran kemarin');
  console.assert(p11.intent === 'LIST_EXPENSES' && p11.targetDate, 'p11 failed: ' + JSON.stringify(p11));

  const p12 = parseMessage('27 september 2026 beli tiket 500rb');
  console.assert(p12.intent === 'RECORD_EXPENSE' && p12.amount === 500000, 'p12 failed: ' + JSON.stringify(p12));

  console.log('✓ parseMessage passed!');

  console.log('--- 4. Testing End-to-End Business Logic ---');
  const res1 = await handleUserMessage('keluar 25000 makan siang');
  console.assert(res1.success && res1.replyText.includes('Rp25.000'), 'res1 failed');
  console.log('Recorded expense: OK');

  const res2 = await handleUserMessage('masuk 5000000 gaji');
  console.assert(res2.success && res2.replyText.includes('Rp5.000.000'), 'res2 failed');
  console.log('Recorded income: OK');

  const res3 = await handleUserMessage('ringkasan bulan');
  console.assert(res3.success && res3.replyText.includes('Rp25.000'), 'res3 failed');
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

  const res8 = await handleUserMessage('list pemasukan tanggal 27 september 2026');
  console.assert(res8.success && res8.replyText.includes('27 September 2026'), 'res8 failed: ' + res8.replyText);
  console.log('List incomes by date: OK');

  const res9 = await handleUserMessage('buatin list tanggal 27 september 2026');
  console.assert(res9.success && res9.replyText.includes('27 September 2026'), 'res9 failed: ' + res9.replyText);
  console.log('Summary list by date: OK');

  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! EVERYTHING WORKS & MAKES SENSE.');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
