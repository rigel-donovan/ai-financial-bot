export type TransactionType = 'expense' | 'income';

export interface Transaction {
  id: string;
  user_id?: string;
  type: TransactionType;
  amount: number;
  category: string;
  note: string;
  raw_message: string;
  source: 'manual' | 'recurring';
  created_at: string; // ISO 8601
}

export interface RecurringExpense {
  id: string;
  user_id?: string;
  name: string;
  amount: number;
  category: string;
  due_date: number; // 1-31
  active: boolean;
  last_run_date?: string; // YYYY-MM-DD
  created_at: string;
}

export interface CategoryMapping {
  keyword: string;
  category: string;
}

export type IntentType =
  | 'RECORD_EXPENSE'
  | 'RECORD_INCOME'
  | 'SUMMARY_DAY'
  | 'SUMMARY_WEEK'
  | 'SUMMARY_MONTH'
  | 'LIST_EXPENSES'
  | 'LIST_INCOMES'
  | 'LIST_ALL'
  | 'DELETE_LAST'
  | 'EDIT_LAST'
  | 'MENU'
  | 'DOWNLOAD_SPREADSHEET'
  | 'AI_ADVICE'
  | 'ADD_RECURRING'
  | 'LIST_RECURRING'
  | 'DELETE_RECURRING'
  | 'HELP_RECURRING'
  | 'HELP'
  | 'UNKNOWN';

export interface ParsedIntent {
  intent: IntentType;
  amount?: number;
  note?: string;
  category?: string;
  rawMessage: string;
  dueDate?: number; // for recurring
  name?: string; // for recurring
  period?: 'day' | 'week' | 'month';
  targetDate?: string; // YYYY-MM-DD for single-day queries
  startDate?: string; // YYYY-MM-DD for ranges
  endDate?: string; // YYYY-MM-DD for ranges
  displayDate?: string; // e.g. "27 September 2026", "Kemarin"
}

export interface ExecutionResult {
  success: boolean;
  replyText: string;
  interactiveType?: 'list' | 'buttons';
  interactiveData?: any;
}
