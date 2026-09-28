import { google } from 'googleapis';
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

/**
 * Automatically create required tabs & header rows if spreadsheet is empty
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

    // Set headers if empty
    const txHeader = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'transactions!A1:H1'
    });
    if (!txHeader.data.values || txHeader.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: 'transactions!A1:H1',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [['id', 'type', 'amount', 'category', 'note', 'raw_message', 'source', 'created_at']]
        }
      });
    }

    const recHeader = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'recurring_expenses!A1:H1'
    });
    if (!recHeader.data.values || recHeader.data.values.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: 'recurring_expenses!A1:H1',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [['id', 'name', 'amount', 'category', 'due_date', 'active', 'last_run_date', 'created_at']]
        }
      });
    }

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
    range: 'transactions!A:H',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [
        [
          tx.id,
          tx.type,
          tx.amount,
          tx.category,
          tx.note,
          tx.raw_message,
          tx.source,
          tx.created_at
        ]
      ]
    }
  });
}

/**
 * Fetch all transactions from sheet
 */
export async function getAllTransactions(): Promise<Transaction[]> {
  const client = getSheetsClient();
  if (!client) {
    return [...mockStore.transactions];
  }

  const { sheets, sheetId } = client;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'transactions!A2:H'
    });

    const rows = res.data.values || [];
    return rows.map((r) => ({
      id: r[0] || '',
      type: (r[1] as 'expense' | 'income') || 'expense',
      amount: parseInt((r[2] || '0').toString().replace(/[^\d]/g, ''), 10),
      category: r[3] || 'Lainnya',
      note: r[4] || '',
      raw_message: r[5] || '',
      source: (r[6] as 'manual' | 'recurring') || 'manual',
      created_at: r[7] || new Date().toISOString()
    }));
  } catch (err) {
    console.error('Error reading transactions from sheet:', err);
    return [];
  }
}

/**
 * Delete a transaction (either by matching criteria or the latest one)
 */
export async function deleteTransaction(criteria?: {
  amount?: number;
  query?: string;
}): Promise<Transaction | null> {
  const client = getSheetsClient();
  if (!client) {
    if (mockStore.transactions.length === 0) return null;
    if (!criteria || (!criteria.amount && !criteria.query)) {
      return mockStore.transactions.pop() || null;
    }
    // 1. Dual match: amount & query
    if (criteria.amount && criteria.query) {
      const words = criteria.query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      for (let i = mockStore.transactions.length - 1; i >= 0; i--) {
        const tx = mockStore.transactions[i];
        const text = `${tx.category} ${tx.note} ${tx.raw_message}`.toLowerCase();
        if (tx.amount === criteria.amount && words.some((w) => text.includes(w))) {
          return mockStore.transactions.splice(i, 1)[0];
        }
      }
    }
    // 2. Match by amount
    if (criteria.amount) {
      for (let i = mockStore.transactions.length - 1; i >= 0; i--) {
        if (mockStore.transactions[i].amount === criteria.amount) {
          return mockStore.transactions.splice(i, 1)[0];
        }
      }
    }
    // 3. Match by query
    if (criteria.query) {
      const words = criteria.query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      for (let i = mockStore.transactions.length - 1; i >= 0; i--) {
        const text = `${mockStore.transactions[i].category} ${mockStore.transactions[i].note} ${mockStore.transactions[i].raw_message}`.toLowerCase();
        if (words.some((w) => text.includes(w))) {
          return mockStore.transactions.splice(i, 1)[0];
        }
      }
    }
    return null;
  }

  const { sheets, sheetId } = client;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'transactions!A2:H'
    });

    const rows = res.data.values || [];
    if (rows.length === 0) return null;

    let targetIdx = -1;

    if (criteria && (criteria.amount || criteria.query)) {
      // 1. Dual match: amount & query
      if (criteria.amount && criteria.query) {
        const words = criteria.query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
        for (let i = rows.length - 1; i >= 0; i--) {
          const r = rows[i];
          const rAmount = parseInt((r[2] || '0').toString().replace(/[^\d]/g, ''), 10);
          const text = `${r[3]} ${r[4]} ${r[5]}`.toLowerCase();
          if (rAmount === criteria.amount && words.some((w) => text.includes(w))) {
            targetIdx = i;
            break;
          }
        }
      }

      // 2. Match by amount
      if (targetIdx === -1 && criteria.amount) {
        for (let i = rows.length - 1; i >= 0; i--) {
          const r = rows[i];
          const rAmount = parseInt((r[2] || '0').toString().replace(/[^\d]/g, ''), 10);
          if (rAmount === criteria.amount) {
            targetIdx = i;
            break;
          }
        }
      }

      // 3. Match by query
      if (targetIdx === -1 && criteria.query) {
        const words = criteria.query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
        for (let i = rows.length - 1; i >= 0; i--) {
          const r = rows[i];
          const text = `${r[3]} ${r[4]} ${r[5]}`.toLowerCase();
          if (words.some((w) => text.includes(w))) {
            targetIdx = i;
            break;
          }
        }
      }

      // If user provided a specific search and no match found, do NOT delete an arbitrary row!
      if (targetIdx === -1) {
        return null;
      }
    } else {
      // No criteria specified (e.g. "hapus terakhir" / "undo") -> delete the last row
      targetIdx = rows.length - 1;
    }

    const rowToDelete = rows[targetIdx];
    const deleted: Transaction = {
      id: rowToDelete[0] || '',
      type: (rowToDelete[1] as any) || 'expense',
      amount: parseInt((rowToDelete[2] || '0').toString().replace(/[^\d]/g, ''), 10),
      category: rowToDelete[3] || '',
      note: rowToDelete[4] || '',
      raw_message: rowToDelete[5] || '',
      source: (rowToDelete[6] as any) || 'manual',
      created_at: rowToDelete[7] || ''
    };

    // If deleting the last row, clearing that row is fastest
    if (targetIdx === rows.length - 1) {
      const lastRowIndex = rows.length + 1;
      await sheets.spreadsheets.values.clear({
        spreadsheetId: sheetId,
        range: `transactions!A${lastRowIndex}:H${lastRowIndex}`
      });
    } else {
      // Remove from array and rewrite transactions!A2:H
      rows.splice(targetIdx, 1);
      await sheets.spreadsheets.values.clear({
        spreadsheetId: sheetId,
        range: 'transactions!A2:H'
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
export async function deleteLatestTransaction(): Promise<Transaction | null> {
  return deleteTransaction();
}

export interface EditTransactionOptions {
  criteria?: {
    query?: string;
  };
  newAmount?: number;
  newNote?: string;
  newCategory?: string;
}

/**
 * Edit a transaction (amount, note, or category)
 */
export async function editTransaction(
  options: EditTransactionOptions | number
): Promise<{ previous: Transaction; updated: Transaction } | null> {
  const opts: EditTransactionOptions =
    typeof options === 'number' ? { newAmount: options } : options;

  const client = getSheetsClient();
  if (!client) {
    if (mockStore.transactions.length === 0) return null;
    let targetIdx = -1;
    if (opts.criteria?.query) {
      const q = opts.criteria.query.toLowerCase();
      for (let i = mockStore.transactions.length - 1; i >= 0; i--) {
        const tx = mockStore.transactions[i];
        if (
          tx.note.toLowerCase().includes(q) ||
          tx.category.toLowerCase().includes(q) ||
          tx.raw_message.toLowerCase().includes(q)
        ) {
          targetIdx = i;
          break;
        }
      }
      if (targetIdx === -1) return null;
    } else {
      targetIdx = mockStore.transactions.length - 1;
    }

    const prev = { ...mockStore.transactions[targetIdx] };
    if (opts.newAmount !== undefined && opts.newAmount > 0) {
      mockStore.transactions[targetIdx].amount = opts.newAmount;
    }
    if (opts.newNote) {
      mockStore.transactions[targetIdx].note = opts.newNote;
      if (opts.newCategory) {
        mockStore.transactions[targetIdx].category = opts.newCategory;
      }
    }
    return { previous: prev, updated: mockStore.transactions[targetIdx] };
  }

  const { sheets, sheetId } = client;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'transactions!A2:H'
    });

    const rows = res.data.values || [];
    if (rows.length === 0) return null;

    let targetIdx = -1;

    if (opts.criteria?.query) {
      const q = opts.criteria.query.toLowerCase();
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        const text = `${r[3]} ${r[4]} ${r[5]}`.toLowerCase();
        if (text.includes(q)) {
          targetIdx = i;
          break;
        }
      }
      if (targetIdx === -1) {
        return null;
      }
    } else {
      targetIdx = rows.length - 1; // default to latest row
    }

    const row = rows[targetIdx];
    const previous: Transaction = {
      id: row[0] || '',
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

    const targetRowIndex = targetIdx + 2; // 1-indexed, +1 header

    // Update columns C (amount), D (category), E (note)
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `transactions!C${targetRowIndex}:E${targetRowIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[updatedAmount, updatedCategory, updatedNote]]
      }
    });

    const updated: Transaction = {
      ...previous,
      amount: updatedAmount,
      note: updatedNote,
      category: updatedCategory
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
  newAmount: number
): Promise<{ previous: Transaction; updated: Transaction } | null> {
  return editTransaction(newAmount);
}

/**
 * Get all recurring expenses
 */
export async function getRecurringExpenses(): Promise<RecurringExpense[]> {
  const client = getSheetsClient();
  if (!client) {
    return [...mockStore.recurring];
  }

  const { sheets, sheetId } = client;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'recurring_expenses!A2:H'
    });

    const rows = res.data.values || [];
    return rows.map((r) => ({
      id: r[0] || '',
      name: r[1] || '',
      amount: parseInt((r[2] || '0').toString().replace(/[^\d]/g, ''), 10),
      category: r[3] || 'Lainnya',
      due_date: parseInt(r[4] || '1', 10),
      active: (r[5] || '').toString().toUpperCase() === 'TRUE',
      last_run_date: r[6] || undefined,
      created_at: r[7] || ''
    }));
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
    range: 'recurring_expenses!A:H',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [
        [
          item.id,
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
 * Toggle or disable recurring expense by name
 */
export async function toggleRecurringExpense(name: string, active: boolean): Promise<boolean> {
  const client = getSheetsClient();
  if (!client) {
    const target = mockStore.recurring.find(r => r.name.toLowerCase() === name.toLowerCase());
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
      range: 'recurring_expenses!A2:H'
    });

    const rows = res.data.values || [];
    const index = rows.findIndex(r => (r[1] || '').toString().trim().toLowerCase() === name.trim().toLowerCase());

    if (index === -1) return false;

    const rowNum = index + 2; // header is 1, 0-index + 2
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `recurring_expenses!F${rowNum}`,
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
      range: 'recurring_expenses!A2:H'
    });

    const rows = res.data.values || [];
    const index = rows.findIndex(r => r[0] === id);
    if (index === -1) return;

    const rowNum = index + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `recurring_expenses!G${rowNum}`,
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
