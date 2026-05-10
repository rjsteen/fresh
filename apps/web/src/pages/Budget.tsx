import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import styled from 'styled-components';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  startOfYear,
  endOfYear,
} from 'date-fns';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useDb } from '../context';
import { getBudgetSummary } from '@fresh/core/db';
import type { Budget, BudgetLine, BudgetSummary, PeriodType } from '@fresh/core/db';

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Page = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[6]};
  max-width: 800px;
`;

const PageHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.space[4]};
`;

const PageTitle = styled.h2`
  font-size: ${({ theme }) => theme.font.size.xl};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  color: ${({ theme }) => theme.color.text};
`;

const Card = styled.div`
  background: ${({ theme }) => theme.color.surface};
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.xl};
  padding: ${({ theme }) => theme.space[6]};
`;

const SectionTitle = styled.h3`
  font-size: ${({ theme }) => theme.font.size.md};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.color.text};
  margin-bottom: ${({ theme }) => theme.space[4]};
`;

const BudgetTabs = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space[2]};
  flex-wrap: wrap;
`;

const BudgetTab = styled.button<{ $active: boolean }>`
  padding: ${({ theme }) => `${theme.space[2]} ${theme.space[4]}`};
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  border-radius: ${({ theme }) => theme.radius.full};
  border: 1.5px solid;
  cursor: pointer;
  transition: ${({ theme }) => theme.transition.fast};

  ${({ $active, theme }) =>
    $active
      ? `
    background: ${theme.color.green500};
    border-color: ${theme.color.green500};
    color: ${theme.color.textInvert};
  `
      : `
    background: transparent;
    border-color: ${theme.color.border};
    color: ${theme.color.textSub};
    &:hover {
      border-color: ${theme.color.green300};
      color: ${theme.color.text};
    }
  `}
`;

const OverviewGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: ${({ theme }) => theme.space[4]};
  margin-bottom: ${({ theme }) => theme.space[5]};

  @media (max-width: 560px) {
    grid-template-columns: 1fr 1fr;
  }
`;

const StatItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[1]};
`;

const StatLabel = styled.div`
  font-size: ${({ theme }) => theme.font.size.xs};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  color: ${({ theme }) => theme.color.textMuted};
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const StatValue = styled.div<{ $danger?: boolean; $warning?: boolean }>`
  font-size: ${({ theme }) => theme.font.size['2xl']};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  letter-spacing: -0.5px;
  color: ${({ theme, $danger, $warning }) =>
    $danger ? theme.color.danger : $warning ? theme.color.warning : theme.color.text};
`;

const MasterBarTrack = styled.div`
  height: 8px;
  background: ${({ theme }) => theme.color.surfaceAlt};
  border-radius: ${({ theme }) => theme.radius.full};
  overflow: hidden;
`;

const MasterBarFill = styled.div<{ $pct: number }>`
  height: 100%;
  width: ${({ $pct }) => Math.min($pct, 100)}%;
  border-radius: ${({ theme }) => theme.radius.full};
  background: ${({ theme, $pct }) =>
    $pct >= 90 ? theme.color.danger : $pct >= 75 ? theme.color.warning : theme.color.green500};
  transition: width 0.4s ease;
`;

const PctLabel = styled.div`
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.color.textMuted};
  margin-top: ${({ theme }) => theme.space[1]};
  text-align: right;
`;

const LineList = styled.ul`
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[4]};
`;

const LineItem = styled.li`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[2]};
`;

const LineHeader = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space[2]};
`;

const LineName = styled.span`
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  color: ${({ theme }) => theme.color.text};
  flex: 1;
`;

const LineAmounts = styled.span`
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.textMuted};
  white-space: nowrap;
`;

const LinePct = styled.span<{ $pct: number }>`
  font-size: ${({ theme }) => theme.font.size.xs};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme, $pct }) =>
    $pct >= 90 ? theme.color.danger : $pct >= 75 ? theme.color.warning : theme.color.green700};
  min-width: 36px;
  text-align: right;
`;

const BarTrack = styled.div`
  height: 6px;
  background: ${({ theme }) => theme.color.surfaceAlt};
  border-radius: ${({ theme }) => theme.radius.full};
  overflow: hidden;
`;

const BarFill = styled.div<{ $pct: number }>`
  height: 100%;
  width: ${({ $pct }) => Math.min($pct, 100)}%;
  border-radius: ${({ theme }) => theme.radius.full};
  background: ${({ theme, $pct }) =>
    $pct >= 90 ? theme.color.danger : $pct >= 75 ? theme.color.warning : theme.color.green500};
  transition: width 0.35s ease;
`;

const RolloverToggle = styled.button<{ $on: boolean }>`
  font-size: ${({ theme }) => theme.font.size.xs};
  padding: 2px ${({ theme }) => theme.space[2]};
  border-radius: ${({ theme }) => theme.radius.full};
  border: 1px solid;
  cursor: pointer;
  transition: ${({ theme }) => theme.transition.fast};
  white-space: nowrap;

  ${({ $on, theme }) =>
    $on
      ? `
    background: ${theme.color.green50};
    border-color: ${theme.color.green200};
    color: ${theme.color.green700};
  `
      : `
    background: transparent;
    border-color: ${theme.color.border};
    color: ${theme.color.textMuted};
    &:hover { border-color: ${theme.color.green200}; color: ${theme.color.green700}; }
  `}
`;

const PeriodBadge = styled.span`
  display: inline-block;
  padding: 2px ${({ theme }) => theme.space[2]};
  background: ${({ theme }) => theme.color.green50};
  border: 1px solid ${({ theme }) => theme.color.green100};
  border-radius: ${({ theme }) => theme.radius.full};
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.color.green700};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  text-transform: capitalize;
`;

const CardHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: ${({ theme }) => theme.space[4]};
`;

const CardTitleGroup = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space[2]};
`;

const ActionRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space[2]};
`;

const EditButton = styled.button`
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.textSub};
  background: transparent;
  border: 1.5px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.sm};
  padding: ${({ theme }) => `${theme.space[1]} ${theme.space[3]}`};
  cursor: pointer;
  transition: ${({ theme }) => theme.transition.fast};

  &:hover {
    border-color: ${({ theme }) => theme.color.green300};
    color: ${({ theme }) => theme.color.text};
  }
`;

const DeleteButton = styled.button`
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.danger};
  background: transparent;
  border: none;
  cursor: pointer;
  padding: ${({ theme }) => `${theme.space[1]} ${theme.space[2]}`};
  border-radius: ${({ theme }) => theme.radius.sm};
  transition: ${({ theme }) => theme.transition.fast};

  &:hover {
    background: ${({ theme }) => theme.color.dangerBg};
  }
`;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.space[4]};
  padding: ${({ theme }) => theme.space[16]};
  text-align: center;
  border: 2px dashed ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.xl};
`;

const EmptyTitle = styled.div`
  font-size: ${({ theme }) => theme.font.size.md};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.color.text};
`;

const EmptyBody = styled.div`
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.textMuted};
  max-width: 300px;
  line-height: ${({ theme }) => theme.font.lineHeight.relaxed};
`;

const EmptyBodyLink = styled.a`
  color: inherit;
  text-decoration: underline;
`;

const FormSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[4]};
`;

const FormRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.space[4]};

  @media (max-width: 500px) {
    grid-template-columns: 1fr;
  }
`;

const InputGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[2]};
`;

const Label = styled.label`
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  color: ${({ theme }) => theme.color.textSub};
`;

const Input = styled.input`
  width: 100%;
  padding: ${({ theme }) => `${theme.space[3]} ${theme.space[4]}`};
  border: 1.5px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.color.surface};
  color: ${({ theme }) => theme.color.text};
  font-size: ${({ theme }) => theme.font.size.base};
  transition: ${({ theme }) => theme.transition.fast};
  box-sizing: border-box;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.color.green400};
    box-shadow: ${({ theme }) => theme.shadow.focus};
  }
`;

const Select = styled.select`
  width: 100%;
  padding: ${({ theme }) => `${theme.space[3]} ${theme.space[4]}`};
  border: 1.5px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.color.surface};
  color: ${({ theme }) => theme.color.text};
  font-size: ${({ theme }) => theme.font.size.base};
  transition: ${({ theme }) => theme.transition.fast};
  box-sizing: border-box;
  appearance: none;
  cursor: pointer;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.color.green400};
    box-shadow: ${({ theme }) => theme.shadow.focus};
  }
`;

const Divider = styled.hr`
  border: none;
  border-top: 1px solid ${({ theme }) => theme.color.border};
  margin: 0;
`;

const LineFormList = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[3]};
`;

const LineFormRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 120px auto auto;
  align-items: center;
  gap: ${({ theme }) => theme.space[2]};

  @media (max-width: 500px) {
    grid-template-columns: 1fr 100px auto auto;
  }
`;

const RolloverCheck = styled.label`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space[1]};
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.color.textMuted};
  cursor: pointer;
  white-space: nowrap;

  input[type='checkbox'] {
    accent-color: ${({ theme }) => theme.color.green500};
    width: 14px;
    height: 14px;
    cursor: pointer;
  }
`;

const RemoveLineButton = styled.button`
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: ${({ theme }) => theme.color.textMuted};
  border-radius: ${({ theme }) => theme.radius.sm};
  cursor: pointer;
  font-size: ${({ theme }) => theme.font.size.md};
  line-height: 1;
  transition: ${({ theme }) => theme.transition.fast};
  flex-shrink: 0;

  &:hover {
    background: ${({ theme }) => theme.color.dangerBg};
    color: ${({ theme }) => theme.color.danger};
  }
`;

const AddLineButton = styled.button`
  align-self: flex-start;
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.green700};
  background: ${({ theme }) => theme.color.green50};
  border: 1px solid ${({ theme }) => theme.color.green100};
  border-radius: ${({ theme }) => theme.radius.sm};
  padding: ${({ theme }) => `${theme.space[2]} ${theme.space[3]}`};
  cursor: pointer;
  transition: ${({ theme }) => theme.transition.fast};

  &:hover {
    background: ${({ theme }) => theme.color.green100};
  }
`;

const ButtonRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space[3]};
  margin-top: ${({ theme }) => theme.space[2]};
`;

const PrimaryButton = styled.button<{ $loading?: boolean }>`
  padding: ${({ theme }) => `${theme.space[3]} ${theme.space[6]}`};
  background: ${({ theme }) => theme.color.green500};
  color: ${({ theme }) => theme.color.textInvert};
  font-size: ${({ theme }) => theme.font.size.base};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  border-radius: ${({ theme }) => theme.radius.md};
  border: none;
  cursor: ${({ $loading }) => ($loading ? 'not-allowed' : 'pointer')};
  opacity: ${({ $loading }) => ($loading ? 0.7 : 1)};
  transition: ${({ theme }) => theme.transition.fast};

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.color.green600};
    transform: translateY(-1px);
  }
`;

const GhostButton = styled.button`
  padding: ${({ theme }) => `${theme.space[3]} ${theme.space[4]}`};
  background: transparent;
  color: ${({ theme }) => theme.color.textSub};
  font-size: ${({ theme }) => theme.font.size.base};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  border-radius: ${({ theme }) => theme.radius.md};
  border: 1.5px solid ${({ theme }) => theme.color.border};
  cursor: pointer;
  transition: ${({ theme }) => theme.transition.fast};

  &:hover {
    color: ${({ theme }) => theme.color.text};
    border-color: ${({ theme }) => theme.color.green300};
  }
`;

const ErrorBanner = styled.div`
  padding: ${({ theme }) => `${theme.space[3]} ${theme.space[4]}`};
  background: ${({ theme }) => theme.color.dangerBg};
  border: 1px solid ${({ theme }) => theme.color.danger}33;
  border-radius: ${({ theme }) => theme.radius.md};
  color: ${({ theme }) => theme.color.danger};
  font-size: ${({ theme }) => theme.font.size.sm};
`;

const SuccessBanner = styled.div`
  padding: ${({ theme }) => `${theme.space[3]} ${theme.space[4]}`};
  background: ${({ theme }) => theme.color.green50};
  border: 1px solid ${({ theme }) => theme.color.green100};
  border-radius: ${({ theme }) => theme.radius.md};
  color: ${({ theme }) => theme.color.green700};
  font-size: ${({ theme }) => theme.font.size.sm};
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Panel = null | 'create' | 'edit';

interface DraftLine {
  tempId: string;
  name: string;
  limit_amount: string;
  rollover: boolean;
}

interface DraftBudget {
  name: string;
  period_type: PeriodType;
  start_date: string;
  end_date: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function getPeriodDates(budget: Budget): { start: string; end: string } {
  const now = new Date();
  switch (budget.period_type) {
    case 'monthly':
      return {
        start: format(startOfMonth(now), 'yyyy-MM-dd'),
        end: format(endOfMonth(now), 'yyyy-MM-dd'),
      };
    case 'weekly':
      return {
        start: format(startOfWeek(now), 'yyyy-MM-dd'),
        end: format(endOfWeek(now), 'yyyy-MM-dd'),
      };
    case 'annual':
      return {
        start: format(startOfYear(now), 'yyyy-MM-dd'),
        end: format(endOfYear(now), 'yyyy-MM-dd'),
      };
    case 'custom':
      return {
        start: budget.start_date,
        end: budget.end_date ?? format(now, 'yyyy-MM-dd'),
      };
  }
}

function periodLabel(budget: Budget): string {
  const { start, end } = getPeriodDates(budget);
  if (budget.period_type === 'monthly') {
    return format(new Date(start + 'T00:00:00'), 'MMMM yyyy');
  }
  return `${format(new Date(start + 'T00:00:00'), 'MMM d')} – ${format(new Date(end + 'T00:00:00'), 'MMM d, yyyy')}`;
}

function blankDraftBudget(): DraftBudget {
  const now = new Date();
  return {
    name: '',
    period_type: 'monthly',
    start_date: format(startOfMonth(now), 'yyyy-MM-dd'),
    end_date: format(endOfMonth(now), 'yyyy-MM-dd'),
  };
}

function blankLine(): DraftLine {
  return { tempId: crypto.randomUUID(), name: '', limit_amount: '', rollover: false };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Budget() {
  const db = useDb();
  const qc = useQueryClient();

  const [panel, setPanel] = useState<Panel>(null);
  const [selectedBudgetId, setSelectedBudgetId] = useState<string | null>(null);
  const [draftBudget, setDraftBudget] = useState<DraftBudget>(blankDraftBudget);
  const [draftLines, setDraftLines] = useState<DraftLine[]>([blankLine()]);
  const [editingBudgetId, setEditingBudgetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  const { data: budgets = [] } = useQuery<Budget[]>({
    queryKey: ['budgets'],
    queryFn: () =>
      db.raw.query<Budget>(
        `SELECT * FROM budgets WHERE is_active = 1 ORDER BY created_at DESC`
      ),
  });

  // Auto-select first budget when list loads
  const activeBudgetId = selectedBudgetId ?? budgets[0]?.id ?? null;

  const activeBudget = useMemo(
    () => budgets.find((b) => b.id === activeBudgetId) ?? null,
    [budgets, activeBudgetId]
  );

  const { data: budgetLines = [] } = useQuery<BudgetLine[]>({
    queryKey: ['budget-lines', activeBudgetId],
    queryFn: () =>
      db.raw.query<BudgetLine>(
        `SELECT * FROM budget_lines WHERE budget_id = ? ORDER BY name ASC`,
        [activeBudgetId!]
      ),
    enabled: activeBudgetId !== null,
  });

  const { data: summary = [] } = useQuery<BudgetSummary[]>({
    queryKey: ['budget-summary', activeBudgetId],
    queryFn: () => {
      const { start, end } = getPeriodDates(activeBudget!);
      return getBudgetSummary(db.raw, activeBudgetId!, start, end);
    },
    enabled: activeBudget !== null,
  });

  // -------------------------------------------------------------------------
  // Computed totals
  // -------------------------------------------------------------------------

  const totals = useMemo(() => {
    const totalBudgeted = summary.reduce((s, l) => s + l.limit_amount, 0);
    const totalSpent = summary.reduce((s, l) => s + l.spent, 0);
    const remaining = totalBudgeted - totalSpent;
    const pctUsed = totalBudgeted > 0 ? (totalSpent / totalBudgeted) * 100 : 0;
    return { totalBudgeted, totalSpent, remaining, pctUsed };
  }, [summary]);

  const chartData = useMemo(
    () =>
      summary.map((s) => ({
        name: s.line_name.length > 14 ? s.line_name.slice(0, 12) + '…' : s.line_name,
        Budget: s.limit_amount,
        Spent: s.spent,
      })),
    [summary]
  );

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  const saveBudgetMutation = useMutation({
    mutationFn: async ({
      draft,
      lines,
      existingId,
    }: {
      draft: DraftBudget;
      lines: DraftLine[];
      existingId: string | null;
    }) => {
      const validLines = lines.filter((l) => l.name.trim() && Number(l.limit_amount) > 0);
      if (!draft.name.trim()) throw new Error('Budget name is required.');
      if (validLines.length === 0) throw new Error('Add at least one budget line.');

      const budgetId = existingId ?? crypto.randomUUID();

      if (existingId) {
        await db.raw.execute(
          `UPDATE budgets SET name=?, period_type=?, start_date=?, end_date=?, updated_at=datetime('now') WHERE id=?`,
          [
            draft.name.trim(),
            draft.period_type,
            draft.start_date,
            draft.period_type === 'custom' ? draft.end_date : null,
            existingId,
          ]
        );
        // Replace all lines
        await db.raw.execute(`DELETE FROM budget_lines WHERE budget_id=?`, [existingId]);
      } else {
        await db.raw.execute(
          `INSERT INTO budgets (id, name, period_type, start_date, end_date, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`,
          [
            budgetId,
            draft.name.trim(),
            draft.period_type,
            draft.start_date,
            draft.period_type === 'custom' ? draft.end_date : null,
          ]
        );
      }

      for (const line of validLines) {
        const lineName = line.name.trim();
        const existing = await db.raw.query<{ id: string }>(
          'SELECT id FROM categories WHERE name = ? LIMIT 1',
          [lineName]
        );
        const categoryId = existing[0]?.id ?? crypto.randomUUID();
        if (!existing[0]) {
          await db.raw.execute(
            `INSERT INTO categories (id, name, is_system, created_at) VALUES (?, ?, 0, datetime('now'))`,
            [categoryId, lineName]
          );
        }

        await db.raw.execute(
          `INSERT INTO budget_lines (id, budget_id, category_id, name, limit_amount, rollover, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
          [
            crypto.randomUUID(),
            budgetId,
            categoryId,
            lineName,
            Number(line.limit_amount),
            line.rollover ? 1 : 0,
          ]
        );
      }

      return budgetId;
    },
    onSuccess: (budgetId) => {
      setSuccess(editingBudgetId ? 'Budget updated.' : 'Budget created.');
      setPanel(null);
      setEditingBudgetId(null);
      setSelectedBudgetId(budgetId);
      setDraftBudget(blankDraftBudget());
      setDraftLines([blankLine()]);
      qc.invalidateQueries({ queryKey: ['budgets'] });
      qc.invalidateQueries({ queryKey: ['budget-lines'] });
      qc.invalidateQueries({ queryKey: ['budget-summary'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const toggleRolloverMutation = useMutation({
    mutationFn: async ({ lineId, rollover }: { lineId: string; rollover: boolean }) => {
      await db.raw.execute(
        `UPDATE budget_lines SET rollover=?, updated_at=datetime('now') WHERE id=?`,
        [rollover ? 1 : 0, lineId]
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget-lines', activeBudgetId] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const deleteBudgetMutation = useMutation({
    mutationFn: async (budgetId: string) => {
      await db.raw.execute(`DELETE FROM budgets WHERE id=?`, [budgetId]);
    },
    onSuccess: () => {
      setSelectedBudgetId(null);
      setSuccess('Budget deleted.');
      qc.invalidateQueries({ queryKey: ['budgets'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  function openCreate() {
    setDraftBudget(blankDraftBudget());
    setDraftLines([blankLine()]);
    setEditingBudgetId(null);
    setError(null);
    setPanel('create');
  }

  function openEdit(budget: Budget, lines: BudgetLine[]) {
    setDraftBudget({
      name: budget.name,
      period_type: budget.period_type,
      start_date: budget.start_date,
      end_date: budget.end_date ?? '',
    });
    setDraftLines(
      lines.length > 0
        ? lines.map((l) => ({
            tempId: l.id,
            name: l.name,
            limit_amount: String(l.limit_amount),
            rollover: l.rollover,
          }))
        : [blankLine()]
    );
    setEditingBudgetId(budget.id);
    setError(null);
    setPanel('edit');
  }

  function cancelForm() {
    setPanel(null);
    setEditingBudgetId(null);
    setError(null);
  }

  function updateDraftLine(tempId: string, patch: Partial<DraftLine>) {
    setDraftLines((prev) => prev.map((l) => (l.tempId === tempId ? { ...l, ...patch } : l)));
  }

  function removeDraftLine(tempId: string) {
    setDraftLines((prev) => prev.filter((l) => l.tempId !== tempId));
  }

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const showForm = panel === 'create' || panel === 'edit';

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <Page>
      <PageHeader>
        <PageTitle>Budgets</PageTitle>
        {!showForm && (
          <PrimaryButton onClick={openCreate}>+ New Budget</PrimaryButton>
        )}
      </PageHeader>

      {success && <SuccessBanner>{success}</SuccessBanner>}

      {/* Budget selector tabs */}
      {!showForm && budgets.length > 1 && (
        <BudgetTabs>
          {budgets.map((b) => (
            <BudgetTab
              key={b.id}
              $active={b.id === activeBudgetId}
              onClick={() => { setSelectedBudgetId(b.id); setSuccess(null); }}
            >
              {b.name}
            </BudgetTab>
          ))}
        </BudgetTabs>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Create / Edit form                                                  */}
      {/* ------------------------------------------------------------------ */}
      {showForm && (
        <Card>
          <SectionTitle>{panel === 'create' ? 'New budget' : 'Edit budget'}</SectionTitle>
          <FormSection>
            <FormRow>
              <InputGroup>
                <Label htmlFor="budget-name">Budget name</Label>
                <Input
                  id="budget-name"
                  type="text"
                  placeholder="e.g. Monthly spending"
                  value={draftBudget.name}
                  onChange={(e) => setDraftBudget((d) => ({ ...d, name: e.target.value }))}
                />
              </InputGroup>
              <InputGroup>
                <Label htmlFor="budget-period">Period</Label>
                <Select
                  id="budget-period"
                  value={draftBudget.period_type}
                  onChange={(e) =>
                    setDraftBudget((d) => ({ ...d, period_type: e.target.value as PeriodType }))
                  }
                >
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                  <option value="annual">Annual</option>
                  <option value="custom">Custom</option>
                </Select>
              </InputGroup>
            </FormRow>

            {draftBudget.period_type === 'custom' && (
              <FormRow>
                <InputGroup>
                  <Label htmlFor="budget-start">Start date</Label>
                  <Input
                    id="budget-start"
                    type="date"
                    value={draftBudget.start_date}
                    onChange={(e) =>
                      setDraftBudget((d) => ({ ...d, start_date: e.target.value }))
                    }
                  />
                </InputGroup>
                <InputGroup>
                  <Label htmlFor="budget-end">End date</Label>
                  <Input
                    id="budget-end"
                    type="date"
                    value={draftBudget.end_date}
                    onChange={(e) =>
                      setDraftBudget((d) => ({ ...d, end_date: e.target.value }))
                    }
                  />
                </InputGroup>
              </FormRow>
            )}

            <Divider />

            <div>
              <Label style={{ marginBottom: '12px', display: 'block' }}>
                Budget lines
              </Label>
              <LineFormList>
                {draftLines.map((line) => (
                  <LineFormRow key={line.tempId}>
                    <Input
                      type="text"
                      placeholder="Category / line name"
                      value={line.name}
                      onChange={(e) =>
                        updateDraftLine(line.tempId, { name: e.target.value })
                      }
                    />
                    <Input
                      type="number"
                      placeholder="Limit"
                      min="0"
                      step="1"
                      value={line.limit_amount}
                      onChange={(e) =>
                        updateDraftLine(line.tempId, { limit_amount: e.target.value })
                      }
                    />
                    <RolloverCheck>
                      <input
                        type="checkbox"
                        checked={line.rollover}
                        onChange={(e) =>
                          updateDraftLine(line.tempId, { rollover: e.target.checked })
                        }
                      />
                      Rollover
                    </RolloverCheck>
                    <RemoveLineButton
                      onClick={() => removeDraftLine(line.tempId)}
                      disabled={draftLines.length === 1}
                      title="Remove line"
                    >
                      ×
                    </RemoveLineButton>
                  </LineFormRow>
                ))}
              </LineFormList>
              <AddLineButton
                onClick={() => setDraftLines((prev) => [...prev, blankLine()])}
                style={{ marginTop: '12px' }}
              >
                + Add line
              </AddLineButton>
            </div>

            {error && <ErrorBanner>{error}</ErrorBanner>}

            <ButtonRow>
              <PrimaryButton
                $loading={saveBudgetMutation.isPending}
                disabled={saveBudgetMutation.isPending}
                onClick={() =>
                  saveBudgetMutation.mutate({
                    draft: draftBudget,
                    lines: draftLines,
                    existingId: editingBudgetId,
                  })
                }
              >
                {saveBudgetMutation.isPending ? 'Saving…' : 'Save budget'}
              </PrimaryButton>
              <GhostButton onClick={cancelForm}>Cancel</GhostButton>
            </ButtonRow>
          </FormSection>
        </Card>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Budget detail view                                                  */}
      {/* ------------------------------------------------------------------ */}
      {!showForm && activeBudget && (
        <>
          {/* Overview card */}
          <Card>
            <CardHeader>
              <CardTitleGroup>
                <SectionTitle style={{ marginBottom: 0 }}>{activeBudget.name}</SectionTitle>
                <PeriodBadge>{activeBudget.period_type}</PeriodBadge>
              </CardTitleGroup>
              <ActionRow>
                <EditButton
                  onClick={() => openEdit(activeBudget, budgetLines)}
                >
                  Edit
                </EditButton>
                <DeleteButton
                  onClick={() => {
                    if (confirm('Delete this budget? This cannot be undone.')) {
                      deleteBudgetMutation.mutate(activeBudget.id);
                    }
                  }}
                >
                  Delete
                </DeleteButton>
              </ActionRow>
            </CardHeader>

            <div
              style={{ fontSize: '13px', color: 'inherit', marginBottom: '20px', opacity: 0.5 }}
            >
              {periodLabel(activeBudget)}
            </div>

            <OverviewGrid>
              <StatItem>
                <StatLabel>Budgeted</StatLabel>
                <StatValue>{formatCurrency(totals.totalBudgeted)}</StatValue>
              </StatItem>
              <StatItem>
                <StatLabel>Spent</StatLabel>
                <StatValue
                  $danger={totals.pctUsed >= 90}
                  $warning={totals.pctUsed >= 75 && totals.pctUsed < 90}
                >
                  {formatCurrency(totals.totalSpent)}
                </StatValue>
              </StatItem>
              <StatItem>
                <StatLabel>Remaining</StatLabel>
                <StatValue $danger={totals.remaining < 0}>
                  {formatCurrency(totals.remaining)}
                </StatValue>
              </StatItem>
            </OverviewGrid>

            <MasterBarTrack>
              <MasterBarFill $pct={totals.pctUsed} />
            </MasterBarTrack>
            <PctLabel>{totals.pctUsed.toFixed(1)}% used</PctLabel>
          </Card>

          {/* Budget lines card */}
          {summary.length > 0 && (
            <Card>
              <SectionTitle>Budget lines</SectionTitle>
              <LineList>
                {summary.map((line) => {
                  const bl = budgetLines.find((l) => l.id === line.line_id);
                  return (
                    <LineItem key={line.line_id}>
                      <LineHeader>
                        <LineName>{line.line_name}</LineName>
                        <LineAmounts>
                          {formatCurrency(line.spent)} / {formatCurrency(line.limit_amount)}
                        </LineAmounts>
                        <LinePct $pct={line.pct_used}>{line.pct_used.toFixed(0)}%</LinePct>
                        {bl && (
                          <RolloverToggle
                            $on={bl.rollover}
                            onClick={() =>
                              toggleRolloverMutation.mutate({
                                lineId: bl.id,
                                rollover: !bl.rollover,
                              })
                            }
                          >
                            {bl.rollover ? '↻ rollover' : 'rollover'}
                          </RolloverToggle>
                        )}
                      </LineHeader>
                      <BarTrack>
                        <BarFill $pct={line.pct_used} />
                      </BarTrack>
                    </LineItem>
                  );
                })}
              </LineList>
            </Card>
          )}

          {/* Spending chart */}
          {chartData.length > 0 && (
            <Card>
              <SectionTitle>Actual vs. budget by category</SectionTitle>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={chartData}
                  margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
                  barCategoryGap="30%"
                >
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: '#7da98a' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#7da98a' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                    width={40}
                  />
                  <Tooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    contentStyle={{
                      background: '#fff',
                      border: '1px solid #ddeee5',
                      borderRadius: '10px',
                      fontSize: '13px',
                    }}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                  />
                  <Bar dataKey="Budget" fill="#ddeee5" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Spent" fill="#22c55e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* No summary data yet */}
          {summary.length === 0 && (
            <Card>
              <div
                style={{
                  textAlign: 'center',
                  padding: '32px 0',
                  fontSize: '13px',
                  color: '#7da98a',
                }}
              >
                No spending data for this period yet.
              </div>
            </Card>
          )}
        </>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Empty state                                                         */}
      {/* ------------------------------------------------------------------ */}
      {!showForm && budgets.length === 0 && (
        <EmptyState>
          <EmptyTitle>No budgets yet</EmptyTitle>
          <EmptyBody>
            Create a budget to track spending by category and stay on top of your finances.
            <br />
            <br />
            Your financial data lives on your device — nothing is sent to a server.{' '}
            <EmptyBodyLink href="https://privacyfinance.app/mobile" target="_blank" rel="noreferrer">
              Get the mobile app
            </EmptyBodyLink>{' '}
            for the best experience.
          </EmptyBody>
          <PrimaryButton onClick={openCreate}>Create your first budget</PrimaryButton>
        </EmptyState>
      )}

      {error && !showForm && <ErrorBanner>{error}</ErrorBanner>}
    </Page>
  );
}
