import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import styled from 'styled-components';
import { format, parseISO } from 'date-fns';
import { useDb } from '../context';
import { getAccounts, categorizeTransaction } from '@fresh/core/db';
import type { Account, Transaction, Category, SqliteDriver } from '@fresh/core/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Flow = 'all' | 'debit' | 'credit';

interface Filters {
  accountId: string;
  categoryIds: string[];
  startDate: string;
  endDate: string;
  search: string;
  flow: Flow;
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

async function fetchTxPage(
  db: SqliteDriver,
  filters: Filters,
  offset: number
): Promise<Transaction[]> {
  const conds: string[] = [];
  const params: (string | number | null)[] = [];

  if (filters.accountId) {
    conds.push('t.account_id = ?');
    params.push(filters.accountId);
  }
  if (filters.categoryIds.length > 0) {
    conds.push(`t.category_id IN (${filters.categoryIds.map(() => '?').join(',')})`);
    params.push(...filters.categoryIds);
  }
  if (filters.startDate) {
    conds.push('t.date >= ?');
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    conds.push('t.date <= ?');
    params.push(filters.endDate);
  }
  if (filters.search) {
    conds.push('(t.description LIKE ? OR t.merchant_name LIKE ? OR t.notes LIKE ?)');
    const like = `%${filters.search}%`;
    params.push(like, like, like);
  }
  if (filters.flow === 'debit') conds.push('t.amount < 0');
  if (filters.flow === 'credit') conds.push('t.amount >= 0');

  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';

  type TxRow = Omit<Transaction, 'pending' | 'tags'> & { pending: 0 | 1; tags_json: string | null };
  const rows = await db.query<TxRow>(
    `SELECT t.*, json(t.tags) as tags_json
     FROM transactions t
     ${where}
     ORDER BY t.date DESC, t.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE + 1, offset]
  );

  return rows.map((r) => ({
    ...r,
    pending: r.pending === 1,
    tags: r.tags_json ? JSON.parse(r.tags_json) : null,
  })) as Transaction[];
}

async function fetchAllForExport(db: SqliteDriver, filters: Filters): Promise<Transaction[]> {
  const conds: string[] = [];
  const params: (string | number | null)[] = [];

  if (filters.accountId) { conds.push('t.account_id = ?'); params.push(filters.accountId); }
  if (filters.categoryIds.length > 0) {
    conds.push(`t.category_id IN (${filters.categoryIds.map(() => '?').join(',')})`);
    params.push(...filters.categoryIds);
  }
  if (filters.startDate) { conds.push('t.date >= ?'); params.push(filters.startDate); }
  if (filters.endDate) { conds.push('t.date <= ?'); params.push(filters.endDate); }
  if (filters.search) {
    conds.push('(t.description LIKE ? OR t.merchant_name LIKE ? OR t.notes LIKE ?)');
    const like = `%${filters.search}%`;
    params.push(like, like, like);
  }
  if (filters.flow === 'debit') conds.push('t.amount < 0');
  if (filters.flow === 'credit') conds.push('t.amount >= 0');

  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';

  type TxRow = Omit<Transaction, 'pending' | 'tags'> & { pending: 0 | 1; tags_json: string | null };
  const rows = await db.query<TxRow>(
    `SELECT t.*, json(t.tags) as tags_json FROM transactions t ${where}
     ORDER BY t.date DESC, t.created_at DESC`,
    params
  );
  return rows.map((r) => ({
    ...r, pending: r.pending === 1, tags: r.tags_json ? JSON.parse(r.tags_json) : null,
  })) as Transaction[];
}

function exportToCsv(txns: Transaction[], categories: Map<string, Category>, accounts: Map<string, Account>) {
  const header = ['Date', 'Account', 'Merchant', 'Description', 'Amount', 'Currency', 'Category', 'Status', 'Notes', 'Tags'];
  const rows = txns.map((t) => [
    t.date,
    accounts.get(t.account_id)?.name ?? t.account_id,
    t.merchant_name ?? '',
    t.description,
    t.amount.toFixed(2),
    t.currency,
    categories.get(t.category_id ?? '')?.name ?? '',
    t.pending ? 'Pending' : 'Posted',
    t.notes ?? '',
    (t.tags ?? []).join('; '),
  ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));

  const csv = [header.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `transactions-${format(new Date(), 'yyyy-MM-dd')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function catColor(color: string | null, id: string | null): string {
  if (color) return color;
  if (!id) return '#7da98a';
  const palette = ['#22c55e', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ec4899', '#14b8a6'];
  const hash = id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return palette[hash % palette.length];
}

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Math.abs(amount));
}

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Page = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[5]};
  max-width: 960px;
`;

const PageHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const PageTitle = styled.h2`
  font-size: ${({ theme }) => theme.font.size.xl};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  color: ${({ theme }) => theme.color.text};
`;

const FilterBar = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${({ theme }) => theme.space[2]};
  align-items: center;
`;

const SearchInput = styled.input`
  padding: ${({ theme }) => `${theme.space[2]} ${theme.space[3]}`};
  border: 1.5px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.color.surface};
  color: ${({ theme }) => theme.color.text};
  font-size: ${({ theme }) => theme.font.size.sm};
  width: 180px;
  transition: ${({ theme }) => theme.transition.fast};

  &::placeholder { color: ${({ theme }) => theme.color.textMuted}; }
  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.color.green400};
    box-shadow: ${({ theme }) => theme.shadow.focus};
  }
`;

const DateInput = styled.input`
  padding: ${({ theme }) => `${theme.space[2]} ${theme.space[3]}`};
  border: 1.5px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.color.surface};
  color: ${({ theme }) => theme.color.text};
  font-size: ${({ theme }) => theme.font.size.sm};
  transition: ${({ theme }) => theme.transition.fast};

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.color.green400};
    box-shadow: ${({ theme }) => theme.shadow.focus};
  }
`;

const SelectInput = styled.select`
  padding: ${({ theme }) => `${theme.space[2]} ${theme.space[3]}`};
  border: 1.5px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.color.surface};
  color: ${({ theme }) => theme.color.text};
  font-size: ${({ theme }) => theme.font.size.sm};
  cursor: pointer;
  transition: ${({ theme }) => theme.transition.fast};

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.color.green400};
    box-shadow: ${({ theme }) => theme.shadow.focus};
  }
`;

const FlowToggle = styled.div`
  display: flex;
  border: 1.5px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.md};
  overflow: hidden;
`;

const FlowBtn = styled.button<{ $active: boolean }>`
  padding: ${({ theme }) => `${theme.space[2]} ${theme.space[3]}`};
  border: none;
  background: ${({ $active, theme }) => $active ? theme.color.green500 : theme.color.surface};
  color: ${({ $active, theme }) => $active ? theme.color.textInvert : theme.color.textSub};
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  cursor: pointer;
  transition: ${({ theme }) => theme.transition.fast};

  &:hover {
    background: ${({ $active, theme }) => $active ? theme.color.green600 : theme.color.green50};
    color: ${({ $active, theme }) => $active ? theme.color.textInvert : theme.color.text};
  }
`;

const DropdownWrap = styled.div`
  position: relative;
`;

const DropdownTrigger = styled.button<{ $active: boolean }>`
  padding: ${({ theme }) => `${theme.space[2]} ${theme.space[3]}`};
  border: 1.5px solid ${({ $active, theme }) => $active ? theme.color.green400 : theme.color.border};
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ $active, theme }) => $active ? theme.color.green50 : theme.color.surface};
  color: ${({ $active, theme }) => $active ? theme.color.green700 : theme.color.textSub};
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  cursor: pointer;
  white-space: nowrap;
  transition: ${({ theme }) => theme.transition.fast};

  &:hover {
    border-color: ${({ theme }) => theme.color.green300};
    color: ${({ theme }) => theme.color.text};
  }
`;

const DropdownPanel = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 100;
  background: ${({ theme }) => theme.color.surface};
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.lg};
  min-width: 200px;
  max-height: 280px;
  overflow-y: auto;
  padding: ${({ theme }) => theme.space[2]};
`;

const DropdownItem = styled.label`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space[2]};
  padding: ${({ theme }) => `${theme.space[2]} ${theme.space[3]}`};
  border-radius: ${({ theme }) => theme.radius.sm};
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.text};
  cursor: pointer;
  transition: ${({ theme }) => theme.transition.fast};

  &:hover { background: ${({ theme }) => theme.color.green50}; }

  input { cursor: pointer; }
`;

const GhostButton = styled.button`
  padding: ${({ theme }) => `${theme.space[2]} ${theme.space[3]}`};
  border: 1.5px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.md};
  background: transparent;
  color: ${({ theme }) => theme.color.textSub};
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  cursor: pointer;
  transition: ${({ theme }) => theme.transition.fast};

  &:hover {
    color: ${({ theme }) => theme.color.text};
    border-color: ${({ theme }) => theme.color.green300};
  }
`;

const TableWrap = styled.div`
  background: ${({ theme }) => theme.color.surface};
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.xl};
  overflow: hidden;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
`;

const Thead = styled.thead`
  background: ${({ theme }) => theme.color.bg};
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
`;

const Th = styled.th`
  padding: ${({ theme }) => `${theme.space[3]} ${theme.space[4]}`};
  text-align: left;
  font-size: ${({ theme }) => theme.font.size.xs};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.color.textMuted};
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
`;

const TBody = styled.tbody``;

const Tr = styled.tr<{ $clickable?: boolean; $expanded?: boolean }>`
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
  transition: ${({ theme }) => theme.transition.fast};
  cursor: ${({ $clickable }) => $clickable ? 'pointer' : 'default'};
  background: ${({ $expanded, theme }) => $expanded ? theme.color.green50 : 'transparent'};

  &:last-child { border-bottom: none; }
  &:hover { background: ${({ $expanded, theme }) => $expanded ? theme.color.green50 : theme.color.surfaceAlt}; }
`;

const Td = styled.td`
  padding: ${({ theme }) => `${theme.space[3]} ${theme.space[4]}`};
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.text};
  vertical-align: middle;
`;

const TdMuted = styled(Td)`
  color: ${({ theme }) => theme.color.textMuted};
  font-size: ${({ theme }) => theme.font.size.xs};
`;

const AmountCell = styled(Td)<{ $debit: boolean }>`
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  font-variant-numeric: tabular-nums;
  color: ${({ $debit, theme }) => $debit ? theme.color.danger : theme.color.green600};
  text-align: right;
  white-space: nowrap;
`;

const MerchantCell = styled(Td)`
  max-width: 220px;
`;

const MerchantName = styled.div`
  font-weight: ${({ theme }) => theme.font.weight.medium};
  color: ${({ theme }) => theme.color.text};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const DescMuted = styled.div`
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.color.textMuted};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const BadgeRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space[1]};
  flex-wrap: wrap;
`;

const CategoryChip = styled.button<{ $color: string }>`
  display: inline-flex;
  align-items: center;
  padding: 2px ${({ theme }) => theme.space[2]};
  border-radius: ${({ theme }) => theme.radius.full};
  font-size: ${({ theme }) => theme.font.size.xs};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  border: 1.5px solid transparent;
  cursor: pointer;
  transition: ${({ theme }) => theme.transition.fast};
  background: ${({ $color }) => `${$color}22`};
  color: ${({ $color }) => $color};
  border-color: ${({ $color }) => `${$color}44`};

  &:hover {
    background: ${({ $color }) => `${$color}33`};
    border-color: ${({ $color }) => $color};
  }
`;


const PendingBadge = styled.span`
  display: inline-block;
  padding: 2px ${({ theme }) => theme.space[2]};
  border-radius: ${({ theme }) => theme.radius.full};
  font-size: ${({ theme }) => theme.font.size.xs};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  background: ${({ theme }) => theme.color.warningBg};
  color: ${({ theme }) => theme.color.warning};
  border: 1px solid ${({ theme }) => theme.color.warning}44;
`;

const AnomalyBadge = styled.span`
  display: inline-block;
  padding: 2px ${({ theme }) => theme.space[2]};
  border-radius: ${({ theme }) => theme.radius.full};
  font-size: ${({ theme }) => theme.font.size.xs};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  background: ${({ theme }) => theme.color.infoBg};
  color: ${({ theme }) => theme.color.info};
  border: 1px solid ${({ theme }) => theme.color.info}44;
`;

const CategorySelect = styled.select`
  padding: 2px ${({ theme }) => theme.space[2]};
  border: 1.5px solid ${({ theme }) => theme.color.green400};
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.color.surface};
  color: ${({ theme }) => theme.color.text};
  font-size: ${({ theme }) => theme.font.size.xs};
  cursor: pointer;
  max-width: 160px;

  &:focus {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadow.focus};
  }
`;

const ExpandedRow = styled.tr`
  background: ${({ theme }) => theme.color.green50};
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
`;

const ExpandedCell = styled.td`
  padding: ${({ theme }) => `${theme.space[3]} ${theme.space[4]} ${theme.space[4]}`};
`;

const ExpandedInner = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space[6]};
  flex-wrap: wrap;
`;

const ExpandedField = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[1]};
  flex: 1;
  min-width: 200px;
`;

const FieldLabel = styled.label`
  font-size: ${({ theme }) => theme.font.size.xs};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.color.textMuted};
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const NotesTextarea = styled.textarea`
  padding: ${({ theme }) => `${theme.space[2]} ${theme.space[3]}`};
  border: 1.5px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.color.surface};
  color: ${({ theme }) => theme.color.text};
  font-size: ${({ theme }) => theme.font.size.sm};
  font-family: inherit;
  resize: vertical;
  min-height: 64px;
  transition: ${({ theme }) => theme.transition.fast};

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.color.green400};
    box-shadow: ${({ theme }) => theme.shadow.focus};
  }
`;

const TagsInput = styled.input`
  padding: ${({ theme }) => `${theme.space[2]} ${theme.space[3]}`};
  border: 1.5px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.color.surface};
  color: ${({ theme }) => theme.color.text};
  font-size: ${({ theme }) => theme.font.size.sm};
  transition: ${({ theme }) => theme.transition.fast};

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.color.green400};
    box-shadow: ${({ theme }) => theme.shadow.focus};
  }
`;

const SaveMetaBtn = styled.button`
  align-self: flex-start;
  padding: ${({ theme }) => `${theme.space[2]} ${theme.space[4]}`};
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.color.green500};
  color: ${({ theme }) => theme.color.textInvert};
  font-size: ${({ theme }) => theme.font.size.xs};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  cursor: pointer;
  transition: ${({ theme }) => theme.transition.fast};

  &:hover { background: ${({ theme }) => theme.color.green600}; }
`;

const Pagination = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${({ theme }) => `${theme.space[3]} ${theme.space[4]}`};
  border-top: 1px solid ${({ theme }) => theme.color.border};
`;

const PageInfo = styled.span`
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.textMuted};
`;

const PaginationButtons = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space[2]};
`;

const NavButton = styled.button<{ disabled?: boolean }>`
  padding: ${({ theme }) => `${theme.space[2]} ${theme.space[3]}`};
  border: 1.5px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.md};
  background: transparent;
  color: ${({ theme }) => theme.color.textSub};
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  cursor: ${({ disabled }) => disabled ? 'not-allowed' : 'pointer'};
  opacity: ${({ disabled }) => disabled ? 0.4 : 1};
  transition: ${({ theme }) => theme.transition.fast};

  &:hover:not(:disabled) {
    color: ${({ theme }) => theme.color.text};
    border-color: ${({ theme }) => theme.color.green300};
  }
`;

const EmptyState = styled.div`
  padding: ${({ theme }) => `${theme.space[12]} ${theme.space[6]}`};
  text-align: center;
  color: ${({ theme }) => theme.color.textMuted};
  font-size: ${({ theme }) => theme.font.size.sm};
`;

const LoadingState = styled(EmptyState)``;

const FilterSep = styled.div`
  width: 1px;
  height: 24px;
  background: ${({ theme }) => theme.color.border};
  margin: 0 ${({ theme }) => theme.space[1]};
`;

// ---------------------------------------------------------------------------
// Category multi-select dropdown
// ---------------------------------------------------------------------------

interface CategoryDropdownProps {
  categories: Category[];
  selected: string[];
  onChange: (ids: string[]) => void;
}

function CategoryDropdown({ categories, selected, onChange }: CategoryDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const label = selected.length === 0
    ? 'All categories'
    : selected.length === 1
    ? (categories.find((c) => c.id === selected[0])?.name ?? '1 selected')
    : `${selected.length} categories`;

  return (
    <DropdownWrap ref={ref}>
      <DropdownTrigger $active={selected.length > 0} onClick={() => setOpen((v) => !v)}>
        {label} ▾
      </DropdownTrigger>
      {open && (
        <DropdownPanel>
          {categories.length === 0 && (
            <DropdownItem as="div" style={{ cursor: 'default', color: '#7da98a' }}>
              No categories
            </DropdownItem>
          )}
          {categories.map((cat) => (
            <DropdownItem key={cat.id}>
              <input
                type="checkbox"
                checked={selected.includes(cat.id)}
                onChange={() => toggle(cat.id)}
              />
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: catColor(cat.color, cat.id),
                  flexShrink: 0,
                }}
              />
              {cat.name}
            </DropdownItem>
          ))}
          {selected.length > 0 && (
            <div style={{ borderTop: '1px solid #ddeee5', marginTop: 4, paddingTop: 4 }}>
              <DropdownItem as="button" style={{ width: '100%', border: 'none', background: 'none' }} onClick={() => onChange([])}>
                Clear selection
              </DropdownItem>
            </div>
          )}
        </DropdownPanel>
      )}
    </DropdownWrap>
  );
}

// ---------------------------------------------------------------------------
// Inline category editor (select shown in place of chip)
// ---------------------------------------------------------------------------

interface InlineCategoryEditorProps {
  categories: Category[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

function InlineCategoryEditor({ categories, currentId, onSelect, onClose }: InlineCategoryEditorProps) {
  const ref = useRef<HTMLSelectElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  return (
    <CategorySelect
      ref={ref}
      value={currentId ?? ''}
      onChange={(e) => {
        if (e.target.value) onSelect(e.target.value);
      }}
      onBlur={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      onClick={(e) => e.stopPropagation()}
    >
      <option value="">— Uncategorized —</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </CategorySelect>
  );
}

// ---------------------------------------------------------------------------
// Transaction row
// ---------------------------------------------------------------------------

interface TxRowProps {
  tx: Transaction;
  categories: Map<string, Category>;
  accounts: Map<string, Account>;
  expanded: boolean;
  editingCat: boolean;
  onToggleExpand: () => void;
  onStartCatEdit: (e: React.MouseEvent) => void;
  onCatSelect: (catId: string) => void;
  onCatEditClose: () => void;
  onSaveMeta: (txId: string, notes: string, tags: string[]) => void;
}

function TxRow({
  tx,
  categories,
  accounts: _accounts,
  expanded,
  editingCat,
  onToggleExpand,
  onStartCatEdit,
  onCatSelect,
  onCatEditClose,
  onSaveMeta,
}: TxRowProps) {
  const [notes, setNotes] = useState(tx.notes ?? '');
  const [tagsStr, setTagsStr] = useState((tx.tags ?? []).join(', '));

  // Reset local state when tx changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset form fields when transaction changes
    setNotes(tx.notes ?? '');
    setTagsStr((tx.tags ?? []).join(', '));
  }, [tx.id, tx.notes, tx.tags]);

  const cat = tx.category_id ? categories.get(tx.category_id) : null;
  const color = catColor(cat?.color ?? null, tx.category_id);
  const isDebit = tx.amount < 0;
  const showAnomaly = tx.category_source === 'ml' && tx.ml_confidence !== null && tx.ml_confidence < 0.65;
  const displayName = tx.merchant_name || tx.description;
  const showDesc = tx.merchant_name && tx.description !== tx.merchant_name;

  return (
    <>
      <Tr $clickable $expanded={expanded} onClick={onToggleExpand}>
        <TdMuted style={{ whiteSpace: 'nowrap' }}>
          {format(parseISO(tx.date), 'MMM d, yyyy')}
        </TdMuted>
        <MerchantCell>
          <MerchantName title={displayName}>{displayName}</MerchantName>
          {showDesc && <DescMuted title={tx.description}>{tx.description}</DescMuted>}
        </MerchantCell>
        <Td>
          <BadgeRow>
            {editingCat ? (
              <InlineCategoryEditor
                categories={Array.from(categories.values())}
                currentId={tx.category_id}
                onSelect={onCatSelect}
                onClose={onCatEditClose}
              />
            ) : (
              <CategoryChip
                $color={color}
                title="Click to change category"
                onClick={onStartCatEdit}
              >
                {cat?.name ?? 'Uncategorized'}
              </CategoryChip>
            )}
            {tx.pending && <PendingBadge>Pending</PendingBadge>}
            {showAnomaly && <AnomalyBadge>Low confidence</AnomalyBadge>}
          </BadgeRow>
        </Td>
        <AmountCell $debit={isDebit}>
          {isDebit ? '−' : '+'}{formatAmount(tx.amount, tx.currency)}
        </AmountCell>
        <TdMuted style={{ textAlign: 'center', fontSize: '10px' }}>
          {expanded ? '▲' : '▼'}
        </TdMuted>
      </Tr>

      {expanded && (
        <ExpandedRow>
          <ExpandedCell colSpan={5}>
            <ExpandedInner>
              <ExpandedField>
                <FieldLabel>Notes</FieldLabel>
                <NotesTextarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add a note…"
                  onClick={(e) => e.stopPropagation()}
                />
              </ExpandedField>
              <ExpandedField>
                <FieldLabel>Tags (comma-separated)</FieldLabel>
                <TagsInput
                  value={tagsStr}
                  onChange={(e) => setTagsStr(e.target.value)}
                  placeholder="food, travel, …"
                  onClick={(e) => e.stopPropagation()}
                />
                <SaveMetaBtn
                  onClick={(e) => {
                    e.stopPropagation();
                    const tags = tagsStr.split(',').map((t) => t.trim()).filter(Boolean);
                    onSaveMeta(tx.id, notes, tags);
                  }}
                >
                  Save
                </SaveMetaBtn>
              </ExpandedField>
              <ExpandedField style={{ minWidth: 'auto', flex: 0 }}>
                <FieldLabel>Details</FieldLabel>
                <div style={{ fontSize: '12px', color: '#3d6b50', lineHeight: 1.8 }}>
                  <div><strong>Currency:</strong> {tx.currency}</div>
                  {tx.posted_at && <div><strong>Posted:</strong> {format(parseISO(tx.posted_at), 'MMM d, yyyy')}</div>}
                  {tx.ml_confidence !== null && (
                    <div><strong>ML confidence:</strong> {Math.round(tx.ml_confidence * 100)}%</div>
                  )}
                  {tx.category_source && <div><strong>Source:</strong> {tx.category_source}</div>}
                </div>
              </ExpandedField>
            </ExpandedInner>
          </ExpandedCell>
        </ExpandedRow>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function defaultFilters(): Filters {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  return {
    accountId: '',
    categoryIds: [],
    startDate: format(start, 'yyyy-MM-dd'),
    endDate: format(now, 'yyyy-MM-dd'),
    search: '',
    flow: 'all',
  };
}

export function Transactions() {
  const db = useDb();
  const qc = useQueryClient();

  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [catEditId, setCatEditId] = useState<string | null>(null);

  // Reset to page 0 whenever filters change
  const updateFilters = useCallback((patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(0);
    setExpandedId(null);
    setCatEditId(null);
  }, []);

  // Accounts
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => getAccounts(db.raw),
  });
  const accountMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts]
  );

  // Categories (raw query — no pre-built helper)
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => db.raw.query<Category>('SELECT * FROM categories ORDER BY name ASC'),
  });
  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );

  // Transactions
  const { data: txPage = [], isFetching } = useQuery({
    queryKey: ['transactions', filters, page],
    queryFn: () => fetchTxPage(db.raw, filters, page * PAGE_SIZE),
    placeholderData: (prev: Transaction[] | undefined) => prev,
  });

  const txns: Transaction[] = (txPage as Transaction[]).slice(0, PAGE_SIZE);
  const hasNextPage = (txPage as Transaction[]).length > PAGE_SIZE;

  // Categorize mutation
  const categorizeMut = useMutation({
    mutationFn: ({ txId, catId }: { txId: string; catId: string }) =>
      categorizeTransaction(db.raw, txId, catId, 'user'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      setCatEditId(null);
    },
  });

  // Save notes/tags mutation
  const saveMetaMut = useMutation({
    mutationFn: ({ txId, notes, tags }: { txId: string; notes: string; tags: string[] }) =>
      db.raw.execute(
        `UPDATE transactions SET notes = ?, tags = ?, updated_at = datetime('now') WHERE id = ?`,
        [notes || null, tags.length > 0 ? JSON.stringify(tags) : null, txId]
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions'] }),
  });

  // CSV export
  const handleExport = useCallback(async () => {
    const all = await fetchAllForExport(db.raw, filters);
    exportToCsv(all, categoryMap, accountMap);
  }, [db.raw, filters, categoryMap, accountMap]);

  // Search debounce ref
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => updateFilters({ search: val }), 300);
  };

  const offset = page * PAGE_SIZE;

  return (
    <Page>
      <PageHeader>
        <PageTitle>Transactions</PageTitle>
        <GhostButton onClick={handleExport}>Export CSV</GhostButton>
      </PageHeader>

      <FilterBar>
        <SearchInput
          type="search"
          placeholder="Search merchant, notes…"
          defaultValue={filters.search}
          onChange={handleSearchChange}
        />

        <FilterSep />

        <DateInput
          type="date"
          value={filters.startDate}
          onChange={(e) => updateFilters({ startDate: e.target.value })}
          title="From"
        />
        <DateInput
          type="date"
          value={filters.endDate}
          onChange={(e) => updateFilters({ endDate: e.target.value })}
          title="To"
        />

        <FilterSep />

        <SelectInput
          value={filters.accountId}
          onChange={(e) => updateFilters({ accountId: e.target.value })}
        >
          <option value="">All accounts</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </SelectInput>

        <CategoryDropdown
          categories={categories}
          selected={filters.categoryIds}
          onChange={(ids) => updateFilters({ categoryIds: ids })}
        />

        <FilterSep />

        <FlowToggle>
          {(['all', 'debit', 'credit'] as Flow[]).map((f) => (
            <FlowBtn key={f} $active={filters.flow === f} onClick={() => updateFilters({ flow: f })}>
              {f === 'all' ? 'All' : f === 'debit' ? 'Debits' : 'Credits'}
            </FlowBtn>
          ))}
        </FlowToggle>
      </FilterBar>

      <TableWrap>
        <Table>
          <Thead>
            <tr>
              <Th>Date</Th>
              <Th>Merchant</Th>
              <Th>Category</Th>
              <Th style={{ textAlign: 'right' }}>Amount</Th>
              <Th style={{ width: 24 }} />
            </tr>
          </Thead>
          <TBody>
            {isFetching && txns.length === 0 ? (
              <tr><td colSpan={5}><LoadingState>Loading…</LoadingState></td></tr>
            ) : txns.length === 0 ? (
              <tr><td colSpan={5}><EmptyState>No transactions match your filters.</EmptyState></td></tr>
            ) : (
              txns.map((tx) => (
                <TxRow
                  key={tx.id}
                  tx={tx}
                  categories={categoryMap}
                  accounts={accountMap}
                  expanded={expandedId === tx.id}
                  editingCat={catEditId === tx.id}
                  onToggleExpand={() => setExpandedId((id) => id === tx.id ? null : tx.id)}
                  onStartCatEdit={(e) => { e.stopPropagation(); setCatEditId(tx.id); }}
                  onCatSelect={(catId) => categorizeMut.mutate({ txId: tx.id, catId })}
                  onCatEditClose={() => setCatEditId(null)}
                  onSaveMeta={(txId, notes, tags) => saveMetaMut.mutate({ txId, notes, tags })}
                />
              ))
            )}
          </TBody>
        </Table>

        <Pagination>
          <PageInfo>
            {txns.length === 0
              ? 'No results'
              : `Showing ${offset + 1}–${offset + txns.length}`}
          </PageInfo>
          <PaginationButtons>
            <NavButton disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
              ← Prev
            </NavButton>
            <NavButton disabled={!hasNextPage} onClick={() => setPage((p) => p + 1)}>
              Next →
            </NavButton>
          </PaginationButtons>
        </Pagination>
      </TableWrap>
    </Page>
  );
}
