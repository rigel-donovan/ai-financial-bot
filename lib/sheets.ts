import { google } from 'googleapis';
import { createHash } from 'node:crypto';
import { Transaction, RecurringExpense, CategoryMapping } from '@/types';

// In-memory fallback database for local development / testing without credentials
const mockStore = {
  transactions: [] as Transaction[],
  recurring: [] as RecurringExpense[],
  categories: [
    { keyword: 'makan, kopi, jajan, nasi, bakso, resto', category: 'Food' },
    { keyword: 'bensin, ojek, tol, grab, gojek, parkir', category: 'Transport' },
    { keyword: 'listrik, air, wifi, pulsa, kos', category: 'Bills' },
    { keyword: 'netflix, bioskop, game, nonton', category: 'Entertainment' },
    { keyword: 'belanja, baju, sepatu, shopee, tokped', category: 'Shopping' },
  ] as CategoryMapping[]
};

function matchesTargetDate(isoStr: string, targetDate: string): boolean {
  if (!isoStr || !targetDate) return false;
  if (isoStr.startsWith(targetDate)) return true;
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return false;
    const jakartaDate = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    return jakartaDate === targetDate;
  } catch {
    return false;
  }
}

/**
 * Get Google Sheets API client with service account auth
 */
function getSheetsClient() {
  let sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) {
    return null;
  }

  // Strip trailing slashes, whitespace, or extract ID if user pasted full URL
  sheetId = sheetId.trim();
  const urlMatch = sheetId.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch) {
    sheetId = urlMatch[1];
  } else {
    sheetId = sheetId.replace(/[/?#].*$/, '').trim();
  }

  const jsonCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  let auth;
  if (jsonCredentials) {
    try {
      let trimmed = jsonCredentials.trim();
      if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
        trimmed = trimmed.slice(1, -1);
      }
      const parsed = JSON.parse(trimmed);
      auth = new google.auth.JWT({
        email: parsed.client_email,
        key: parsed.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    } catch (err) {
      console.error('Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON, attempting fallback credentials:', err);
    }
  }

  if (!auth && clientEmail && privateKey) {
    // Strip surrounding quotes if loaded literally from .env
    let cleanedKey = privateKey.trim();
    if ((cleanedKey.startsWith('"') && cleanedKey.endsWith('"')) || (cleanedKey.startsWith("'") && cleanedKey.endsWith("'"))) {
      cleanedKey = cleanedKey.slice(1, -1);
    }
    cleanedKey = cleanedKey.replace(/\\n/g, '\n');

    auth = new google.auth.JWT({
      email: clientEmail,
      key: cleanedKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }

  if (!auth) {
    return null;
  }

  const sheets = google.sheets({ version: 'v4', auth });
  return { sheets, sheetId };
}

export function isSheetsConfigured(): boolean {
  return !!getSheetsClient();
}

function userViewSuffix(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 12);
}

type UserSheetMeta = Array<{
  properties?: { sheetId?: number | null; title?: string | null } | null;
  filterViews?: Array<{ filterViewId?: number | null; title?: string | null }> | null;
}>;

/** Create or refresh a dashboard copy whose user selector is fixed to this user. */
async function ensureUserDashboard(
  sheets: ReturnType<typeof google.sheets>,
  sheetId: string,
  sheetMeta: UserSheetMeta,
  userId: string
): Promise<number | undefined> {
  const suffix = userViewSuffix(userId);
  const title = `Dashboard ${suffix}`;
  let dashboard = sheetMeta.find((sheet) => sheet.properties?.title === title);
  if (!dashboard) {
    const template = sheetMeta.find((sheet) => sheet.properties?.title === 'Dashboard');
    if (template?.properties?.sheetId == null) return undefined;
    const copied = await sheets.spreadsheets.sheets.copyTo({
      spreadsheetId: sheetId,
      sheetId: template.properties.sheetId,
      requestBody: { destinationSpreadsheetId: sheetId }
    });
    const newSheetId = copied.data.sheetId;
    if (newSheetId === undefined) return undefined;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [{
          updateSheetProperties: {
            properties: { sheetId: newSheetId, title },
            fields: 'title'
          }
        }]
      }
    });
    dashboard = { properties: { sheetId: newSheetId, title } };
  }

  const dashboardId = dashboard.properties?.sheetId;
  if (dashboardId == null) return undefined;
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${title}'!H4`,
    valueInputOption: 'RAW',
    requestBody: { values: [[userId]] }
  });
  return dashboardId;
}

/** Create or refresh a live recurring-expense view containing only one user. */
async function ensureUserRecurringView(
  sheets: ReturnType<typeof google.sheets>,
  sheetId: string,
  sheetMeta: UserSheetMeta,
  userId: string
): Promise<void> {
  const suffix = userViewSuffix(userId);
  const title = `Recurring ${suffix}`;
  let view = sheetMeta.find((sheet) => sheet.properties?.title === title);
  if (!view) {
    const template = sheetMeta.find((sheet) => sheet.properties?.title === 'recurring_expenses');
    if (template?.properties?.sheetId == null) return;
    const copied = await sheets.spreadsheets.sheets.copyTo({
      spreadsheetId: sheetId,
      sheetId: template.properties.sheetId,
      requestBody: { destinationSpreadsheetId: sheetId }
    });
    const newSheetId = copied.data.sheetId;
    if (newSheetId === undefined) return;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [{
          updateSheetProperties: {
            properties: { sheetId: newSheetId, title },
            fields: 'title'
          }
        }]
      }
    });
    view = { properties: { sheetId: newSheetId, title } };
    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: `'${title}'!A2:I`
    });
  }

  const escapedUserId = userId.replace(/"/g, '""');
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `'${title}'!A2`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[`=IFERROR(FILTER(recurring_expenses!A2:I,recurring_expenses!B2:B="${escapedUserId}"),"")`]]
    }
  });
}

/** Return a live spreadsheet link to a dashboard and recurring view for this user. */
export async function getUserTransactionsSpreadsheetUrl(userId: string): Promise<string | null> {
  const client = getSheetsClient();
  if (!client) return null;

  const { sheets, sheetId } = client;
  const baseUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/edit`;
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: 'sheets(properties(sheetId,title),filterViews(filterViewId,title))'
  });
  const allSheets = spreadsheet.data.sheets || [];
  const transactionsSheet = allSheets.find((sheet) => sheet.properties?.title === 'transactions');
  const gid = transactionsSheet?.properties?.sheetId;
  if (!transactionsSheet || gid === undefined) return baseUrl;

  const viewTitle = `Transactions for ${userId}`;
  let filterView = transactionsSheet.filterViews?.find((view) => view.title === viewTitle);

  if (!filterView?.filterViewId) {
    const result = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [{
          addFilterView: {
            filter: {
              title: viewTitle,
              range: { sheetId: gid, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 10 },
              criteria: {
                1: {
                  condition: {
                    type: 'TEXT_EQ',
                    values: [{ userEnteredValue: userId }]
                  }
                }
              }
            }
          }
        }]
      }
    });
    filterView = result.data.replies?.[0]?.addFilterView?.filter;
  }

  // Each Telegram link opens its own dashboard copy. Its formulas still read
  // the live source tabs, while the user selector is fixed to this account.
  await ensureUserRecurringView(sheets, sheetId, allSheets, userId);
  const dashboardId = await ensureUserDashboard(sheets, sheetId, allSheets, userId);
  if (dashboardId !== undefined) {
    // Keep the shared source tabs out of the normal tab bar. The bot still
    // reads/writes them, while Telegram opens the per-user views above.
    const sourceTabIds = allSheets
      .filter((sheet) => ['Dashboard', 'recurring_expenses'].includes(sheet.properties?.title || ''))
      .map((sheet) => sheet.properties?.sheetId)
      .filter((sourceId): sourceId is number => sourceId != null);
    if (sourceTabIds.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: sourceTabIds.map((sourceId) => ({
            updateSheetProperties: {
              properties: { sheetId: sourceId, hidden: true },
              fields: 'hidden'
            }
          }))
        }
      });
    }
    return `${baseUrl}#gid=${dashboardId}`;
  }

  if (!filterView?.filterViewId) return `${baseUrl}#gid=${gid}`;
  return `${baseUrl}#gid=${gid}&fvid=${filterView.filterViewId}`;
}

/**
 * Automatically create required tabs & header rows if spreadsheet is empty
 */
/**
 * Automatically create required tabs & header rows if spreadsheet is empty
 * or migrate existing legacy 8-column rows to 9-column (with user_id)
 */
export async function ensureSheetStructure(): Promise<void> {
  const client = getSheetsClient();
  if (!client) return;

  const { sheets, sheetId } = client;

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const existingSheets = meta.data.sheets?.map(s => s.properties?.title) || [];

    const requests: any[] = [];
    if (!existingSheets.includes('transactions')) {
      requests.push({ addSheet: { properties: { title: 'transactions' } } });
    }
    if (!existingSheets.includes('categories')) {
      requests.push({ addSheet: { properties: { title: 'categories' } } });
    }
    if (!existingSheets.includes('recurring_expenses')) {
      requests.push({ addSheet: { properties: { title: 'recurring_expenses' } } });
    }

    if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests }
      });
    }

    // 1. Transactions Sheet Header & Migration
    const txHeader = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'transactions!A1:J1'
    });
    const txRow0 = txHeader.data.values?.[0] || [];

    if (txRow0.length === 0) {
      // Empty sheet
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: 'transactions!A1:J1',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [['id', 'user_id', 'type', 'amount', 'category', 'note', 'raw_message', 'source', 'created_at', 'qty']]
        }
      });
    } else if (txRow0[1] !== 'user_id') {
      // Legacy 8-column header (missing user_id at Col B) -> migrate rows
      const allTxRes = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'transactions!A:H'
      });
      const allRows = allTxRes.data.values || [];
      if (allRows.length > 0) {
        const defaultUser = process.env.ALLOWED_PHONE_NUMBER || 'default_user';
        const migratedRows = allRows.map((r, idx) => {
          if (idx === 0) {
            return ['id', 'user_id', 'type', 'amount', 'category', 'note', 'raw_message', 'source', 'created_at', 'qty'];
          }
          return [
            r[0] || '', // id
            r[8] || defaultUser, // user_id
            r[1] || 'expense', // type
            r[2] || '0', // amount
            r[3] || 'Lainnya', // category
            r[4] || '', // note
            r[5] || '', // raw_message
            r[6] || 'manual', // source
            r[7] || new Date().toISOString(), // created_at
            '' // qty (legacy rows don't have qty)
          ];
        });
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: 'transactions!A1:J',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: migratedRows }
        });
      }
    } else if (!txRow0[9] || txRow0[9] !== 'qty') {
      // Sheet has user_id but missing qty header in column J
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: 'transactions!J1',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [['qty']]
        }
      });
    }

    // 2. Recurring Expenses Header & Migration
    const recHeader = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'recurring_expenses!A1:I1'
    });
    const recRow0 = recHeader.data.values?.[0] || [];

    if (recRow0.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: 'recurring_expenses!A1:I1',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [['id', 'user_id', 'name', 'amount', 'category', 'due_date', 'active', 'last_run_date', 'created_at']]
        }
      });
    } else if (recRow0[1] !== 'user_id') {
      const allRecRes = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'recurring_expenses!A:H'
      });
      const allRows = allRecRes.data.values || [];
      if (allRows.length > 0) {
        const defaultUser = process.env.ALLOWED_PHONE_NUMBER || 'default_user';
        const migratedRows = allRows.map((r, idx) => {
          if (idx === 0) {
            return ['id', 'user_id', 'name', 'amount', 'category', 'due_date', 'active', 'last_run_date', 'created_at'];
          }
          return [
            r[0] || '',
            r[8] || defaultUser,
            r[1] || '',
            r[2] || '0',
            r[3] || 'Bills',
            r[4] || '1',
            r[5] || 'TRUE',
            r[6] || '',
            r[7] || new Date().toISOString()
          ];
        });
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: 'recurring_expenses!A1:I',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: migratedRows }
        });
      }
    }

    // 3. Categories Sheet
    const catHeader = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'categories!A1:B1'
    });
    if (!catHeader.data.values || catHeader.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: 'categories!A1:B',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [
            ['keyword', 'category'],
            ['makan, kopi, jajan, resto, cafe', 'Food'],
            ['bensin, ojek, tol, grab, gojek, parkir', 'Transport'],
            ['listrik, pdam, pulsa, kuota, wifi', 'Bills'],
            ['netflix, bioskop, spotify, nonton', 'Entertainment'],
            ['belanja, baju, sepatu, shopee, tokped', 'Shopping']
          ]
        }
      });
    }
  } catch (err) {
    console.error('Error ensuring sheet structure:', err);
  }
}

/**
 * Append a transaction
 */
export async function appendTransaction(tx: Transaction): Promise<void> {
  const client = getSheetsClient();
  if (!client) {
    // Fallback in-memory
    mockStore.transactions.push(tx);
    return;
  }

  const { sheets, sheetId } = client;
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'transactions!A:J',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [
        [
          tx.id,
          tx.user_id || '',
          tx.type,
          tx.amount,
          tx.category,
          tx.note,
          tx.raw_message,
          tx.source,
          tx.created_at,
          tx.qty || ''
        ]
      ]
    }
  });
}

/**
 * Fetch all transactions from sheet, optionally filtered by user_id
 */
export async function getAllTransactions(userId?: string): Promise<Transaction[]> {
  const client = getSheetsClient();
  if (!client) {
    if (userId) {
      return mockStore.transactions.filter(t => t.user_id === userId);
    }
    return [...mockStore.transactions];
  }

  const { sheets, sheetId } = client;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'transactions!A2:J'
    });

    const rows = res.data.values || [];
    const all = rows.map((r) => {
      if (r.length >= 9 || r[2] === 'expense' || r[2] === 'income') {
        const qtyVal = r[9] ? parseInt(r[9], 10) : undefined;
        return {
          id: r[0] || '',
          user_id: r[1] || '',
          type: (r[2] as 'expense' | 'income') || 'expense',
          amount: parseInt((r[3] || '0').toString().replace(/[^\d]/g, ''), 10),
          category: r[4] || 'Lainnya',
          note: r[5] || '',
          raw_message: r[6] || '',
          source: (r[7] as 'manual' | 'recurring') || 'manual',
          created_at: r[8] || new Date().toISOString(),
          qty: qtyVal && qtyVal > 0 ? qtyVal : undefined
        };
      } else {
        return {
          id: r[0] || '',
          user_id: '',
          type: (r[1] as 'expense' | 'income') || 'expense',
          amount: parseInt((r[2] || '0').toString().replace(/[^\d]/g, ''), 10),
          category: r[3] || 'Lainnya',
          note: r[4] || '',
          raw_message: r[5] || '',
          source: (r[6] as 'manual' | 'recurring') || 'manual',
          created_at: r[7] || new Date().toISOString()
        };
      }
    });

    if (userId) {
      return all.filter(t => t.user_id === userId);
    }

    return all;
  } catch (err) {
    console.error('Error reading transactions from sheet:', err);
    return [];
  }
}

/**
 * Delete a transaction (either by matching criteria or the latest one for the given user)
 */
export async function deleteTransaction(criteria?: {
  amount?: number;
  query?: string;
  userId?: string;
  targetDate?: string;
}): Promise<Transaction | null> {
  const targetUserId = criteria?.userId;
  const client = getSheetsClient();

  if (!client) {
    if (mockStore.transactions.length === 0) return null;
    for (let i = mockStore.transactions.length - 1; i >= 0; i--) {
      const tx = mockStore.transactions[i];
      if (targetUserId && tx.user_id && tx.user_id !== targetUserId) {
        continue;
      }
      if (criteria?.targetDate && !matchesTargetDate(tx.created_at, criteria.targetDate)) {
        continue;
      }
      if (!criteria || (!criteria.amount && !criteria.query)) {
        return mockStore.transactions.splice(i, 1)[0];
      }
      const words = criteria.query ? criteria.query.toLowerCase().split(/\s+/).filter(w => w.length > 2) : [];
      const text = `${tx.category} ${tx.note} ${tx.raw_message}`.toLowerCase();
      if (criteria.amount && criteria.query) {
        if (tx.amount === criteria.amount && words.some(w => text.includes(w))) {
          return mockStore.transactions.splice(i, 1)[0];
        }
      } else if (criteria.amount && tx.amount === criteria.amount) {
        return mockStore.transactions.splice(i, 1)[0];
      } else if (criteria.query && words.some(w => text.includes(w))) {
        return mockStore.transactions.splice(i, 1)[0];
      }
    }
    return null;
  }

  const { sheets, sheetId } = client;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'transactions!A2:J'
    });

    const rows = res.data.values || [];
    if (rows.length === 0) return null;

    let targetIdx = -1;

    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      const is9Col = r.length >= 9 || r[2] === 'expense' || r[2] === 'income';
      const rowUserId = is9Col ? (r[1] || '') : '';
      if (targetUserId && rowUserId && rowUserId !== targetUserId) {
        continue;
      }

      const rAmount = parseInt((is9Col ? r[3] : r[2] || '0').toString().replace(/[^\d]/g, ''), 10);
      const text = (is9Col ? `${r[4]} ${r[5]} ${r[6]}` : `${r[3]} ${r[4]} ${r[5]}`).toLowerCase();
      const rowCreatedAt = (is9Col ? r[8] : r[7]) || '';

      if (criteria?.targetDate && !matchesTargetDate(rowCreatedAt, criteria.targetDate)) {
        continue;
      }

      if (criteria && (criteria.amount || criteria.query)) {
        const words = criteria.query ? criteria.query.toLowerCase().split(/\s+/).filter(w => w.length > 2) : [];
        if (criteria.amount && criteria.query) {
          if (rAmount === criteria.amount && words.some(w => text.includes(w))) {
            targetIdx = i;
            break;
          }
        } else if (criteria.amount && rAmount === criteria.amount) {
          targetIdx = i;
          break;
        } else if (criteria.query && words.some(w => text.includes(w))) {
          targetIdx = i;
          break;
        }
      } else {
        // No criteria -> latest transaction for this user
        targetIdx = i;
        break;
      }
    }

    if (targetIdx === -1) {
      return null;
    }

    const rowToDelete = rows[targetIdx];
    const is9Col = rowToDelete.length >= 9 || rowToDelete[2] === 'expense' || rowToDelete[2] === 'income';
    const deleted: Transaction = is9Col
      ? {
          id: rowToDelete[0] || '',
          user_id: rowToDelete[1] || '',
          type: (rowToDelete[2] as any) || 'expense',
          amount: parseInt((rowToDelete[3] || '0').toString().replace(/[^\d]/g, ''), 10),
          category: rowToDelete[4] || '',
          note: rowToDelete[5] || '',
          raw_message: rowToDelete[6] || '',
          source: (rowToDelete[7] as any) || 'manual',
          created_at: rowToDelete[8] || '',
          qty: rowToDelete[9] ? parseInt(rowToDelete[9], 10) : undefined
        }
      : {
          id: rowToDelete[0] || '',
          user_id: '',
          type: (rowToDelete[1] as any) || 'expense',
          amount: parseInt((rowToDelete[2] || '0').toString().replace(/[^\d]/g, ''), 10),
          category: rowToDelete[3] || '',
          note: rowToDelete[4] || '',
          raw_message: rowToDelete[5] || '',
          source: (rowToDelete[6] as any) || 'manual',
          created_at: rowToDelete[7] || ''
        };

    // If deleting the last row of the sheet
    if (targetIdx === rows.length - 1) {
      const lastRowIndex = rows.length + 1;
      await sheets.spreadsheets.values.clear({
        spreadsheetId: sheetId,
        range: `transactions!A${lastRowIndex}:J${lastRowIndex}`
      });
    } else {
      // Remove from array and rewrite transactions!A2:J
      rows.splice(targetIdx, 1);
      await sheets.spreadsheets.values.clear({
        spreadsheetId: sheetId,
        range: 'transactions!A2:J'
      });
      if (rows.length > 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: 'transactions!A2',
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: rows }
        });
      }
    }

    return deleted;
  } catch (err) {
    console.error('Error deleting transaction:', err);
    return null;
  }
}

/**
 * Delete the latest transaction (convenience alias)
 */
export async function deleteLatestTransaction(userId?: string): Promise<Transaction | null> {
  return deleteTransaction({ userId });
}

export interface EditTransactionOptions {
  criteria?: {
    query?: string;
    userId?: string;
    targetDate?: string;
  };
  newAmount?: number;
  newQty?: number;
  newNote?: string;
  newCategory?: string;
  newDate?: string;
  userId?: string;
  targetDate?: string;
}

/**
 * Edit a transaction, scoped to a specific user
 */
export async function editTransaction(
  options: EditTransactionOptions | number
): Promise<{ previous: Transaction; updated: Transaction } | null> {
  const opts: EditTransactionOptions =
    typeof options === 'number' ? { newAmount: options } : options;

  const targetUserId = opts.userId || opts.criteria?.userId;

  const client = getSheetsClient();
  if (!client) {
    if (mockStore.transactions.length === 0) return null;
    let targetIdx = -1;
    const matchesQuery = (tx: Transaction, query?: string) => {
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        tx.note.toLowerCase().includes(q) ||
        tx.category.toLowerCase().includes(q) ||
        tx.raw_message.toLowerCase().includes(q)
      );
    };

    const candidates = mockStore.transactions.filter((tx) => {
      if (targetUserId && tx.user_id && tx.user_id !== targetUserId) return false;
      if (opts.targetDate && !matchesTargetDate(tx.created_at, opts.targetDate)) return false;
      if (opts.criteria?.query) return matchesQuery(tx, opts.criteria.query);
      return true;
    });

    if (opts.criteria?.query || opts.targetDate) {
      const preferred = candidates[candidates.length - 1];
      if (preferred) targetIdx = mockStore.transactions.indexOf(preferred);
    } else {
      for (let i = mockStore.transactions.length - 1; i >= 0; i--) {
        if (targetUserId && mockStore.transactions[i].user_id && mockStore.transactions[i].user_id !== targetUserId) continue;
        targetIdx = i;
        break;
      }
    }

    if (targetIdx === -1) {
      for (let i = mockStore.transactions.length - 1; i >= 0; i--) {
        const tx = mockStore.transactions[i];
        if (targetUserId && tx.user_id && tx.user_id !== targetUserId) {
          continue;
        }
        if (opts.targetDate && !matchesTargetDate(tx.created_at, opts.targetDate)) {
          continue;
        }
        if (opts.criteria?.query) {
          const q = opts.criteria.query.toLowerCase();
          if (
            tx.note.toLowerCase().includes(q) ||
            tx.category.toLowerCase().includes(q) ||
            tx.raw_message.toLowerCase().includes(q)
          ) {
            targetIdx = i;
            break;
          }
        } else {
          targetIdx = i;
          break;
        }
      }
    }

    if (targetIdx === -1) return null;
    if (targetIdx === -1) return null;

    const prev = { ...mockStore.transactions[targetIdx] };
    if (opts.newAmount !== undefined && opts.newAmount > 0) {
      mockStore.transactions[targetIdx].amount = opts.newAmount;
    }
    if (opts.newNote) {
      mockStore.transactions[targetIdx].note = opts.newNote;
    }
    if (opts.newCategory) {
      mockStore.transactions[targetIdx].category = opts.newCategory;
    }
    if (opts.newDate) {
      mockStore.transactions[targetIdx].created_at = new Date(`${opts.newDate}T12:00:00+07:00`).toISOString();
    }
    return { previous: prev, updated: mockStore.transactions[targetIdx] };
  }

  const { sheets, sheetId } = client;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'transactions!A2:J'
    });

    const rows = res.data.values || [];
    if (rows.length === 0) return null;

    let targetIdx = -1;
    const matchingRows = rows
      .map((r, idx) => ({ row: r, idx }))
      .filter(({ row }) => {
        const is9Col = row.length >= 9 || row[2] === 'expense' || row[2] === 'income';
        const rowUserId = is9Col ? (row[1] || '') : '';
        if (targetUserId && rowUserId && rowUserId !== targetUserId) return false;

        const rowCreatedAt = (is9Col ? row[8] : row[7]) || '';
        if (opts.targetDate && !matchesTargetDate(rowCreatedAt, opts.targetDate)) return false;

        if (opts.criteria?.query) {
          const q = opts.criteria.query.toLowerCase();
          const text = (is9Col ? `${row[4]} ${row[5]} ${row[6]}` : `${row[3]} ${row[4]} ${row[5]}`).toLowerCase();
          return text.includes(q);
        }

        return true;
      });

    if (opts.criteria?.query || opts.targetDate) {
      const preferred = matchingRows[matchingRows.length - 1];
      if (preferred) targetIdx = preferred.idx;
    } else {
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        const is9Col = r.length >= 9 || r[2] === 'expense' || r[2] === 'income';
        const rowUserId = is9Col ? (r[1] || '') : '';
        if (targetUserId && rowUserId && rowUserId !== targetUserId) {
          continue;
        }
        targetIdx = i;
        break;
      }
    }

    if (targetIdx === -1) {
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        const is9Col = r.length >= 9 || r[2] === 'expense' || r[2] === 'income';
        const rowUserId = is9Col ? (r[1] || '') : '';
        if (targetUserId && rowUserId && rowUserId !== targetUserId) {
          continue;
        }

        const rowCreatedAt = (is9Col ? r[8] : r[7]) || '';
        if (opts.targetDate && !matchesTargetDate(rowCreatedAt, opts.targetDate)) {
          continue;
        }

        if (opts.criteria?.query) {
          const q = opts.criteria.query.toLowerCase();
          const text = (is9Col ? `${r[4]} ${r[5]} ${r[6]}` : `${r[3]} ${r[4]} ${r[5]}`).toLowerCase();
          if (text.includes(q)) {
            targetIdx = i;
            break;
          }
        } else {
          targetIdx = i;
          break;
        }
      }
    }

    if (targetIdx === -1) return null;

    const row = rows[targetIdx];
    const is9Col = row.length >= 9 || row[2] === 'expense' || row[2] === 'income';

    const previous: Transaction = is9Col
      ? {
          id: row[0] || '',
          user_id: row[1] || '',
          type: (row[2] as any) || 'expense',
          amount: parseInt((row[3] || '0').toString().replace(/[^\d]/g, ''), 10),
          category: row[4] || '',
          note: row[5] || '',
          raw_message: row[6] || '',
          source: (row[7] as any) || 'manual',
          created_at: row[8] || '',
          qty: row[9] ? parseInt(row[9], 10) : undefined
        }
      : {
          id: row[0] || '',
          user_id: '',
          type: (row[1] as any) || 'expense',
          amount: parseInt((row[2] || '0').toString().replace(/[^\d]/g, ''), 10),
          category: row[3] || '',
          note: row[4] || '',
          raw_message: row[5] || '',
          source: (row[6] as any) || 'manual',
          created_at: row[7] || ''
        };

    const updatedAmount =
      opts.newAmount !== undefined && opts.newAmount > 0 ? opts.newAmount : previous.amount;
    const updatedNote = opts.newNote !== undefined && opts.newNote ? opts.newNote : previous.note;
    const updatedCategory =
      opts.newCategory !== undefined && opts.newCategory
        ? opts.newCategory
        : previous.type === 'income' && (!previous.category || previous.category === 'Lainnya')
        ? 'Income'
        : previous.category;
    const updatedCreatedAt = opts.newDate
      ? new Date(`${opts.newDate}T12:00:00+07:00`).toISOString()
      : previous.created_at;

    const targetRowIndex = targetIdx + 2;

    if (is9Col) {
      // In 9-column mode, columns D (amount), E (category), F (note)
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `transactions!D${targetRowIndex}:F${targetRowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[updatedAmount, updatedCategory, updatedNote]]
        }
      });
      if (opts.newDate) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `transactions!I${targetRowIndex}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[updatedCreatedAt]] }
        });
      }
      if (opts.newQty !== undefined) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `transactions!J${targetRowIndex}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[opts.newQty || '']] }
        });
      }
    } else {
      // Legacy columns C..E
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `transactions!C${targetRowIndex}:E${targetRowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[updatedAmount, updatedCategory, updatedNote]]
        }
      });
      if (opts.newDate) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: sheetId,
          range: `transactions!H${targetRowIndex}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[updatedCreatedAt]] }
        });
      }
    }

    const updated: Transaction = {
      ...previous,
      amount: updatedAmount,
      note: updatedNote,
      category: updatedCategory,
      created_at: updatedCreatedAt
    };

    return { previous, updated };
  } catch (err) {
    console.error('Error editing transaction:', err);
    return null;
  }
}

/**
 * Edit the latest transaction amount (convenience alias)
 */
export async function editLatestTransactionAmount(
  newAmount: number,
  userId?: string
): Promise<{ previous: Transaction; updated: Transaction } | null> {
  return editTransaction({ newAmount, userId });
}

/**
 * Get all recurring expenses, optionally filtered by user_id
 */
export async function getRecurringExpenses(userId?: string): Promise<RecurringExpense[]> {
  const client = getSheetsClient();
  if (!client) {
    if (userId) {
      return mockStore.recurring.filter(r => r.user_id === userId);
    }
    return [...mockStore.recurring];
  }

  const { sheets, sheetId } = client;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'recurring_expenses!A2:I'
    });

    const rows = res.data.values || [];
    const all = rows.map((r) => {
      if (r.length >= 9 || r[6] === 'TRUE' || r[6] === 'FALSE') {
        return {
          id: r[0] || '',
          user_id: r[1] || '',
          name: r[2] || '',
          amount: parseInt((r[3] || '0').toString().replace(/[^\d]/g, ''), 10),
          category: r[4] || 'Lainnya',
          due_date: parseInt(r[5] || '1', 10),
          active: (r[6] || '').toString().toUpperCase() === 'TRUE',
          last_run_date: r[7] || undefined,
          created_at: r[8] || ''
        };
      } else {
        return {
          id: r[0] || '',
          user_id: '',
          name: r[1] || '',
          amount: parseInt((r[2] || '0').toString().replace(/[^\d]/g, ''), 10),
          category: r[3] || 'Lainnya',
          due_date: parseInt(r[4] || '1', 10),
          active: (r[5] || '').toString().toUpperCase() === 'TRUE',
          last_run_date: r[6] || undefined,
          created_at: r[7] || ''
        };
      }
    });

    if (userId) {
      return all.filter(r => r.user_id === userId);
    }

    return all;
  } catch (err) {
    console.error('Error getting recurring expenses:', err);
    return [];
  }
}

/**
 * Add a recurring expense
 */
export async function addRecurringExpense(item: RecurringExpense): Promise<void> {
  const client = getSheetsClient();
  if (!client) {
    mockStore.recurring.push(item);
    return;
  }

  const { sheets, sheetId } = client;
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'recurring_expenses!A:I',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [
        [
          item.id,
          item.user_id || '',
          item.name,
          item.amount,
          item.category,
          item.due_date,
          item.active ? 'TRUE' : 'FALSE',
          item.last_run_date || '',
          item.created_at
        ]
      ]
    }
  });
}

/**
 * Toggle or disable recurring expense by name, scoped to user
 */
export async function toggleRecurringExpense(name: string, active: boolean, userId?: string): Promise<boolean> {
  const client = getSheetsClient();
  if (!client) {
    const target = mockStore.recurring.find(
      r => r.name.toLowerCase() === name.toLowerCase() && (!userId || !r.user_id || r.user_id === userId)
    );
    if (target) {
      target.active = active;
      return true;
    }
    return false;
  }

  const { sheets, sheetId } = client;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'recurring_expenses!A2:I'
    });

    const rows = res.data.values || [];
    const index = rows.findIndex((r) => {
      const is9Col = r.length >= 9 || r[6] === 'TRUE' || r[6] === 'FALSE';
      const rUserId = is9Col ? (r[1] || '') : '';
      const rName = is9Col ? r[2] : r[1];
      if (userId && rUserId && rUserId !== userId) return false;
      return (rName || '').toString().trim().toLowerCase() === name.trim().toLowerCase();
    });

    if (index === -1) return false;

    const rowNum = index + 2; // header is 1, 0-index + 2
    const is9Col = rows[index].length >= 9 || rows[index][6] === 'TRUE' || rows[index][6] === 'FALSE';
    const activeCol = is9Col ? 'G' : 'F';

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `recurring_expenses!${activeCol}${rowNum}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[active ? 'TRUE' : 'FALSE']]
      }
    });

    return true;
  } catch (err) {
    console.error('Error updating recurring status:', err);
    return false;
  }
}

/**
 * Update recurring last run date
 */
export async function updateRecurringLastRun(id: string, dateStr: string): Promise<void> {
  const client = getSheetsClient();
  if (!client) {
    const target = mockStore.recurring.find(r => r.id === id);
    if (target) target.last_run_date = dateStr;
    return;
  }

  const { sheets, sheetId } = client;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'recurring_expenses!A2:I'
    });

    const rows = res.data.values || [];
    const index = rows.findIndex(r => r[0] === id);
    if (index === -1) return;

    const rowNum = index + 2;
    const is9Col = rows[index].length >= 9 || rows[index][6] === 'TRUE' || rows[index][6] === 'FALSE';
    const lastRunCol = is9Col ? 'H' : 'G';

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `recurring_expenses!${lastRunCol}${rowNum}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[dateStr]]
      }
    });
  } catch (err) {
    console.error('Error updating last run date:', err);
  }
}

/**
 * Fetch custom category mappings from categories sheet
 */
export async function getCategoryMappings(): Promise<Record<string, string[]>> {
  const client = getSheetsClient();
  const map: Record<string, string[]> = {};

  if (!client) {
    for (const c of mockStore.categories) {
      map[c.category] = c.keyword.split(',').map(s => s.trim().toLowerCase());
    }
    return map;
  }

  const { sheets, sheetId } = client;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'categories!A2:B'
    });

    const rows = res.data.values || [];
    for (const r of rows) {
      const keywords = (r[0] || '').toString().split(',').map((k: string) => k.trim().toLowerCase());
      const cat = (r[1] || '').toString().trim();
      if (cat && keywords.length > 0) {
        if (!map[cat]) map[cat] = [];
        map[cat].push(...keywords);
      }
    }
  } catch (err) {
    console.error('Error reading categories sheet:', err);
  }

  return map;
}
