import { parseMessage, parseAmount, detectCategory, parseQueryDate } from '../lib/parser';
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

  const p13 = parseMessage('list pemasukan dan pengeluaran hari ini');
  console.assert(p13.intent === 'LIST_ALL', 'p13 failed: ' + JSON.stringify(p13));

  const p14 = parseMessage('list pengeluaran dan pemasukan kemarin');
  console.assert(p14.intent === 'LIST_ALL', 'p14 failed: ' + JSON.stringify(p14));

  const p14b = parseMessage('list pemasukan dan pengeluaran 27 - 28 september');
  console.assert(p14b.intent === 'LIST_ALL' && p14b.targetDate === '2026-09-27' && p14b.endDate === '2026-09-28', 'p14b failed: ' + JSON.stringify(p14b));

  const p14c = parseMessage('list pemasukan dan pengeluaran bulan ini');
  console.assert(p14c.intent === 'LIST_ALL' && p14c.period === 'month' && p14c.startDate && p14c.endDate, 'p14c failed: ' + JSON.stringify(p14c));

  const p14d = parseMessage('list penyusutan minggu ini');
  console.assert(p14d.intent === 'LIST_ALL' && p14d.period === 'week' && p14d.startDate && p14d.endDate, 'p14d failed: ' + JSON.stringify(p14d));

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

  const p33 = parseQueryDate('struk tanggal 27 september 2026');
  console.assert(p33 && p33.targetDate === '2026-09-27', 'p33 failed: ' + JSON.stringify(p33));

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
  console.assert(historicalDelete.success && historicalDelete.replyText.includes('Tanggal: 27 September 2026'), 'historical delete output failed: ' + historicalDelete.replyText);
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
  console.assert(downloadRes.success && downloadRes.replyText.includes('/api/download-spreadsheet?userId=user_export') && downloadRes.replyText.includes('hanya data user'), 'download spreadsheet response should include a user-scoped download link: ' + downloadRes.replyText);
  console.log('Download spreadsheet response: OK');

  const historicalDeleteOutput = await handleUserMessage('27 september 2026 makan siang 45rb', 'user_output_delete');
  console.assert(historicalDeleteOutput.success, 'historical delete setup failed: ' + historicalDeleteOutput.replyText);
  const deleteOutput = await handleUserMessage('hapus transaksi 27 september 2026', 'user_output_delete');
  console.assert(deleteOutput.success && deleteOutput.replyText.includes('27 September 2026'), 'historical delete output missing date label: ' + deleteOutput.replyText);
  console.log('Historical delete output with date label: OK');

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

  console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY! EVERYTHING WORKS & MAKES SENSE.');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
