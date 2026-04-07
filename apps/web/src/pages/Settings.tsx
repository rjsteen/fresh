import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import styled from 'styled-components';
import { useDb } from '../App';
import { useAuth } from '../hooks/useAuth';
import { upsertAlertRule, deleteAlertRule, getAllAlertRules, getAccounts } from '@fresh/core/db';
import type { AlertRule, AlertRuleType, Account } from '@fresh/core/db';
import { apiFetch, API } from '../utils/api';

// ---------------------------------------------------------------------------
// Common timezones
// ---------------------------------------------------------------------------

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Helsinki',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];

const REGIONS = [
  { value: 'US', label: 'United States' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'EU', label: 'European Union' },
  { value: 'CA', label: 'Canada' },
  { value: 'AU', label: 'Australia' },
  { value: 'NZ', label: 'New Zealand' },
  { value: 'SG', label: 'Singapore' },
  { value: 'IN', label: 'India' },
  { value: 'BR', label: 'Brazil' },
  { value: 'OTHER', label: 'Other' },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Device {
  id: string;
  name: string;
  platform: string;
  last_active_at: string;
  is_current: boolean;
}

interface BudgetLineOption {
  id: string;
  name: string;
  budget_name: string;
}

interface RuleFormState {
  id?: string;
  name: string;
  rule_type: AlertRuleType;
  enabled: boolean;
  threshold_amount: string;
  budget_line_id: string;
  threshold_pct: string;
  period_start: string;
  period_end: string;
  account_id: string;
  merchant_names: string;
}

const EMPTY_RULE_FORM: RuleFormState = {
  name: '',
  rule_type: 'large_transaction',
  enabled: true,
  threshold_amount: '',
  budget_line_id: '',
  threshold_pct: '',
  period_start: '',
  period_end: '',
  account_id: '',
  merchant_names: '',
};

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Page = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[6]};
  max-width: 600px;
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
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[4]};
`;

const CardHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const SectionTitle = styled.h3`
  font-size: ${({ theme }) => theme.font.size.md};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.color.text};
`;

const Row = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: ${({ theme }) => theme.space[4]};
`;

const RowLabel = styled.div`
  font-size: ${({ theme }) => theme.font.size.base};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  color: ${({ theme }) => theme.color.text};
`;

const RowSub = styled.div`
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.textMuted};
  margin-top: 2px;
`;

const Divider = styled.hr`
  border: none;
  border-top: 1px solid ${({ theme }) => theme.color.border};
  margin: 0;
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
  cursor: pointer;
  box-sizing: border-box;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.color.green400};
    box-shadow: ${({ theme }) => theme.shadow.focus};
  }
`;

const ButtonRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space[3]};
  align-items: center;
  flex-wrap: wrap;
`;

const PrimaryButton = styled.button<{ $loading?: boolean }>`
  padding: ${({ theme }) => `${theme.space[2]} ${theme.space[5]}`};
  background: ${({ theme }) => theme.color.green500};
  color: ${({ theme }) => theme.color.textInvert};
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  border-radius: ${({ theme }) => theme.radius.md};
  border: none;
  cursor: ${({ $loading }) => ($loading ? 'not-allowed' : 'pointer')};
  opacity: ${({ $loading }) => ($loading ? 0.7 : 1)};
  transition: ${({ theme }) => theme.transition.fast};

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.color.green600};
  }
`;

const GhostButton = styled.button`
  padding: ${({ theme }) => `${theme.space[2]} ${theme.space[4]}`};
  background: transparent;
  color: ${({ theme }) => theme.color.textSub};
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  border: 1.5px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.md};
  cursor: pointer;
  transition: ${({ theme }) => theme.transition.fast};

  &:hover {
    border-color: ${({ theme }) => theme.color.green300};
    color: ${({ theme }) => theme.color.text};
  }
`;

const DangerButton = styled.button`
  padding: ${({ theme }) => `${theme.space[2]} ${theme.space[4]}`};
  background: transparent;
  color: ${({ theme }) => theme.color.danger};
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  border: 1.5px solid ${({ theme }) => theme.color.danger}55;
  border-radius: ${({ theme }) => theme.radius.md};
  cursor: pointer;
  transition: ${({ theme }) => theme.transition.fast};

  &:hover {
    background: ${({ theme }) => theme.color.dangerBg};
    border-color: ${({ theme }) => theme.color.danger};
  }
`;

const TextButton = styled.button`
  background: none;
  border: none;
  padding: 0;
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  color: ${({ theme }) => theme.color.green600};
  cursor: pointer;

  &:hover {
    color: ${({ theme }) => theme.color.green700};
    text-decoration: underline;
  }
`;

const Banner = styled.div<{ $variant: 'success' | 'error' }>`
  padding: ${({ theme }) => `${theme.space[3]} ${theme.space[4]}`};
  border-radius: ${({ theme }) => theme.radius.md};
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.medium};

  ${({ $variant, theme }) =>
    $variant === 'success'
      ? `background: ${theme.color.successBg}; color: ${theme.color.green700}; border: 1px solid ${theme.color.green200};`
      : `background: ${theme.color.dangerBg}; color: ${theme.color.danger}; border: 1px solid ${theme.color.danger}33;`}
`;

const FormPanel = styled.div`
  background: ${({ theme }) => theme.color.surfaceAlt};
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: ${({ theme }) => theme.space[5]};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[4]};
`;

const FormPanelTitle = styled.h4`
  font-size: ${({ theme }) => theme.font.size.base};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.color.text};
  margin: 0;
`;

const FormGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.space[3]};

  @media (max-width: 480px) {
    grid-template-columns: 1fr;
  }
`;

const RuleList = styled.ul`
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[3]};
`;

const RuleItem = styled.li`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space[3]};
  padding: ${({ theme }) => theme.space[3]};
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.color.bg};
`;

const RuleInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const RuleName = styled.div`
  font-size: ${({ theme }) => theme.font.size.base};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  color: ${({ theme }) => theme.color.text};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const RuleSummary = styled.div`
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.color.textMuted};
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const RuleActions = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space[2]};
  flex-shrink: 0;
`;

const Badge = styled.span<{ $variant?: 'type' | 'current' | 'disabled' }>`
  display: inline-flex;
  align-items: center;
  padding: 2px ${({ theme }) => theme.space[2]};
  border-radius: ${({ theme }) => theme.radius.full};
  font-size: ${({ theme }) => theme.font.size.xs};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  white-space: nowrap;

  ${({ $variant, theme }) => {
    if ($variant === 'current') return `
      background: ${theme.color.green50};
      border: 1px solid ${theme.color.green100};
      color: ${theme.color.green700};
    `;
    if ($variant === 'disabled') return `
      background: ${theme.color.surfaceAlt};
      border: 1px solid ${theme.color.border};
      color: ${theme.color.textMuted};
    `;
    return `
      background: ${theme.color.infoBg};
      border: 1px solid ${theme.color.info}33;
      color: ${theme.color.info};
    `;
  }}
`;

const ToggleButton = styled.button<{ $on: boolean }>`
  width: 36px;
  height: 20px;
  border-radius: ${({ theme }) => theme.radius.full};
  border: none;
  cursor: pointer;
  transition: ${({ theme }) => theme.transition.fast};
  position: relative;
  flex-shrink: 0;

  ${({ $on, theme }) =>
    $on
      ? `background: ${theme.color.green500};`
      : `background: ${theme.color.border};`}

  &::after {
    content: '';
    position: absolute;
    top: 3px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: white;
    transition: ${({ theme }) => theme.transition.fast};
    ${({ $on }) => ($on ? 'right: 3px;' : 'left: 3px;')}
  }
`;

const IconButton = styled.button`
  background: none;
  border: none;
  padding: ${({ theme }) => theme.space[1]};
  border-radius: ${({ theme }) => theme.radius.sm};
  cursor: pointer;
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.textMuted};
  transition: ${({ theme }) => theme.transition.fast};
  line-height: 1;

  &:hover {
    background: ${({ theme }) => theme.color.surfaceAlt};
    color: ${({ theme }) => theme.color.text};
  }

  &.danger:hover {
    background: ${({ theme }) => theme.color.dangerBg};
    color: ${({ theme }) => theme.color.danger};
  }
`;

const DeviceList = styled.ul`
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[3]};
`;

const DeviceItem = styled.li`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space[3]};
  padding: ${({ theme }) => theme.space[3]};
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.color.bg};
`;

const DeviceInfo = styled.div`
  flex: 1;
`;

const DeviceName = styled.div`
  font-size: ${({ theme }) => theme.font.size.base};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  color: ${({ theme }) => theme.color.text};
`;

const DeviceMeta = styled.div`
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.color.textMuted};
  margin-top: 2px;
`;

const ErrorText = styled.p`
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.danger};
  margin: 0;
`;

const EmptyText = styled.p`
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.textMuted};
  margin: 0;
`;

const CheckboxRow = styled.label`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space[2]};
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.textSub};
  cursor: pointer;
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRuleParams(rule: AlertRule): string {
  const p = rule.params;
  switch (rule.rule_type) {
    case 'large_transaction':
      return `Threshold: $${(p as { threshold_amount: number }).threshold_amount}`;
    case 'budget_threshold':
      return `Alert at ${(p as { threshold_pct: number }).threshold_pct}% usage`;
    case 'balance_low':
      return `Alert below $${(p as { threshold_amount: number }).threshold_amount}`;
    case 'merchant': {
      const names = (p as { merchant_names: string[] }).merchant_names;
      return `Watch: ${names.slice(0, 2).join(', ')}${names.length > 2 ? '…' : ''}`;
    }
    default:
      return '';
  }
}

function ruleFormToParams(form: RuleFormState): Record<string, unknown> {
  switch (form.rule_type) {
    case 'large_transaction':
      return { threshold_amount: parseFloat(form.threshold_amount) };
    case 'budget_threshold':
      return {
        budget_line_id: form.budget_line_id,
        threshold_pct: parseFloat(form.threshold_pct),
        period_start: form.period_start,
        period_end: form.period_end,
      };
    case 'balance_low':
      return {
        account_id: form.account_id,
        threshold_amount: parseFloat(form.threshold_amount),
      };
    case 'merchant':
      return {
        merchant_names: form.merchant_names
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };
  }
}

function ruleToForm(rule: AlertRule): RuleFormState {
  const p = rule.params;
  const base: RuleFormState = {
    id: rule.id,
    name: rule.name,
    rule_type: rule.rule_type,
    enabled: rule.enabled,
    threshold_amount: '',
    budget_line_id: '',
    threshold_pct: '',
    period_start: '',
    period_end: '',
    account_id: '',
    merchant_names: '',
  };

  switch (rule.rule_type) {
    case 'large_transaction':
      return { ...base, threshold_amount: String((p as any).threshold_amount ?? '') };
    case 'budget_threshold':
      return {
        ...base,
        budget_line_id: (p as any).budget_line_id ?? '',
        threshold_pct: String((p as any).threshold_pct ?? ''),
        period_start: (p as any).period_start ?? '',
        period_end: (p as any).period_end ?? '',
      };
    case 'balance_low':
      return {
        ...base,
        account_id: (p as any).account_id ?? '',
        threshold_amount: String((p as any).threshold_amount ?? ''),
      };
    case 'merchant':
      return {
        ...base,
        merchant_names: ((p as any).merchant_names as string[] ?? []).join(', '),
      };
  }
}

function validateRuleForm(form: RuleFormState): string | null {
  if (!form.name.trim()) return 'Rule name is required.';
  switch (form.rule_type) {
    case 'large_transaction':
      if (!form.threshold_amount || isNaN(parseFloat(form.threshold_amount)) || parseFloat(form.threshold_amount) <= 0)
        return 'Enter a positive threshold amount.';
      break;
    case 'budget_threshold':
      if (!form.budget_line_id) return 'Select a budget line.';
      if (!form.threshold_pct || parseFloat(form.threshold_pct) <= 0 || parseFloat(form.threshold_pct) > 100)
        return 'Threshold must be between 1 and 100%.';
      if (!form.period_start || !form.period_end) return 'Period start and end dates are required.';
      break;
    case 'balance_low':
      if (!form.account_id) return 'Select an account.';
      if (!form.threshold_amount || isNaN(parseFloat(form.threshold_amount)))
        return 'Enter a balance threshold amount.';
      break;
    case 'merchant':
      if (!form.merchant_names.trim()) return 'Enter at least one merchant name.';
      break;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

export function Settings() {
  const db = useDb();
  const { logout } = useAuth();
  const queryClient = useQueryClient();
  const email = localStorage.getItem('user_email') ?? '—';

  // ---- profile state ----
  const [timezone, setTimezone] = useState(
    () => localStorage.getItem('user_timezone') ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [region, setRegion] = useState(() => localStorage.getItem('user_region') ?? 'US');
  const [profileBanner, setProfileBanner] = useState<{ msg: string; ok: boolean } | null>(null);

  const [showPwForm, setShowPwForm] = useState(false);
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwBanner, setPwBanner] = useState<{ msg: string; ok: boolean } | null>(null);

  // ---- alert rule state ----
  const [rulePanel, setRulePanel] = useState<'new' | 'edit' | null>(null);
  const [ruleForm, setRuleForm] = useState<RuleFormState>(EMPTY_RULE_FORM);
  const [ruleFormError, setRuleFormError] = useState<string | null>(null);
  const [ruleBanner, setRuleBanner] = useState<string | null>(null);

  // ---- data section state ----
  const [dataBanner, setDataBanner] = useState<{ msg: string; ok: boolean } | null>(null);

  // ---- queries ----
  const { data: rules = [] } = useQuery({
    queryKey: ['alert_rules', 'all'],
    queryFn: () => getAllAlertRules(db.raw),
  });

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ['accounts'],
    queryFn: () => getAccounts(db.raw),
  });

  const { data: budgetLineOptions = [] } = useQuery<BudgetLineOption[]>({
    queryKey: ['budget_lines', 'options'],
    queryFn: () =>
      db.raw.query<BudgetLineOption>(
        `SELECT bl.id, bl.name, b.name as budget_name
         FROM budget_lines bl
         JOIN budgets b ON b.id = bl.budget_id
         ORDER BY b.name, bl.name`
      ),
  });

  const { data: devices = [], isLoading: devicesLoading, error: devicesError } = useQuery<Device[]>({
    queryKey: ['devices'],
    queryFn: async () => {
      const res = await apiFetch(`${API}/api/v1/devices`);
      if (!res.ok) throw new Error('Failed to load devices');
      return res.json();
    },
  });

  // ---- mutations ----
  const saveProfile = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`${API}/api/v1/users/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone, region }),
      });
      if (!res.ok) throw new Error('Failed to save profile');
    },
    onSuccess: () => {
      localStorage.setItem('user_timezone', timezone);
      localStorage.setItem('user_region', region);
      setProfileBanner({ msg: 'Profile saved.', ok: true });
      setTimeout(() => setProfileBanner(null), 3000);
    },
    onError: () => {
      setProfileBanner({ msg: 'Failed to save profile.', ok: false });
    },
  });

  const changePassword = useMutation({
    mutationFn: async (form: typeof pwForm) => {
      if (form.next !== form.confirm) throw new Error('Passwords do not match.');
      if (form.next.length < 8) throw new Error('New password must be at least 8 characters.');
      const res = await apiFetch(`${API}/api/v1/users/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: form.current, new_password: form.next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? 'Failed to change password.');
      }
    },
    onSuccess: () => {
      setPwBanner({ msg: 'Password updated.', ok: true });
      setPwForm({ current: '', next: '', confirm: '' });
      setShowPwForm(false);
      setTimeout(() => setPwBanner(null), 3000);
    },
    onError: (err) => {
      setPwBanner({ msg: err instanceof Error ? err.message : 'Error.', ok: false });
    },
  });

  const saveRule = useMutation({
    mutationFn: async (form: RuleFormState) => {
      const params = ruleFormToParams(form);
      await upsertAlertRule(db.raw, {
        id: form.id,
        name: form.name.trim(),
        rule_type: form.rule_type,
        params,
        enabled: form.enabled,
        backend_token_ref: null,
      });
    },
    onSuccess: (_, form) => {
      queryClient.invalidateQueries({ queryKey: ['alert_rules'] });
      setRulePanel(null);
      setRuleForm(EMPTY_RULE_FORM);
      setRuleFormError(null);
      setRuleBanner(form.id ? 'Rule updated.' : 'Rule created.');
      setTimeout(() => setRuleBanner(null), 3000);
    },
    onError: () => {
      setRuleFormError('Failed to save rule.');
    },
  });

  const toggleRule = useMutation({
    mutationFn: async (rule: AlertRule) => {
      await upsertAlertRule(db.raw, { ...rule, enabled: !rule.enabled });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alert_rules'] }),
  });

  const removeRule = useMutation({
    mutationFn: async (id: string) => {
      await deleteAlertRule(db.raw, id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert_rules'] });
      setRuleBanner('Rule deleted.');
      setTimeout(() => setRuleBanner(null), 3000);
    },
  });

  const revokeDevice = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`${API}/api/v1/devices/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to revoke device');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['devices'] }),
  });

  const deleteAccount = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`${API}/api/v1/users/me`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete account');
    },
    onSuccess: async () => {
      await wipeLocalDb();
      logout();
    },
  });

  // ---- handlers ----

  function handleOpenNewRule() {
    setRuleForm(EMPTY_RULE_FORM);
    setRuleFormError(null);
    setRulePanel('new');
  }

  function handleEditRule(rule: AlertRule) {
    setRuleForm(ruleToForm(rule));
    setRuleFormError(null);
    setRulePanel('edit');
  }

  function handleCancelRuleForm() {
    setRulePanel(null);
    setRuleForm(EMPTY_RULE_FORM);
    setRuleFormError(null);
  }

  function handleSubmitRuleForm() {
    const err = validateRuleForm(ruleForm);
    if (err) {
      setRuleFormError(err);
      return;
    }
    saveRule.mutate(ruleForm);
  }

  function handleDeleteRule(rule: AlertRule) {
    if (!window.confirm(`Delete rule "${rule.name}"? This cannot be undone.`)) return;
    removeRule.mutate(rule.id);
  }

  function handleRevokeDevice(device: Device) {
    if (!window.confirm(`Revoke access for "${device.name}"?`)) return;
    revokeDevice.mutate(device.id);
  }

  async function handleExportData() {
    const [accs, txns, cats, budgets, lines, alertRules, anomalies] = await Promise.all([
      db.raw.query('SELECT * FROM accounts'),
      db.raw.query('SELECT * FROM transactions'),
      db.raw.query('SELECT * FROM categories'),
      db.raw.query('SELECT * FROM budgets'),
      db.raw.query('SELECT * FROM budget_lines'),
      db.raw.query('SELECT * FROM alert_rules'),
      db.raw.query('SELECT * FROM anomalies'),
    ]);

    const payload = {
      exported_at: new Date().toISOString(),
      accounts: accs,
      transactions: txns,
      categories: cats,
      budgets,
      budget_lines: lines,
      alert_rules: alertRules,
      anomalies,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `privacyfinance-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    setDataBanner({ msg: 'Export downloaded.', ok: true });
    setTimeout(() => setDataBanner(null), 3000);
  }

  async function wipeLocalDb() {
    await db.raw.execute('DELETE FROM anomalies');
    await db.raw.execute('DELETE FROM recurring_patterns');
    await db.raw.execute('DELETE FROM alert_rules');
    await db.raw.execute('DELETE FROM budget_lines');
    await db.raw.execute('DELETE FROM budgets');
    await db.raw.execute('DELETE FROM transactions');
    await db.raw.execute('DELETE FROM sync_state');
    await db.raw.execute('DELETE FROM accounts');
    await db.raw.execute('DELETE FROM categories');
    await db.raw.execute('DELETE FROM change_log');
    await db.raw.execute('DELETE FROM sync_meta');
    queryClient.invalidateQueries();
  }

  async function handleWipeLocalDb() {
    if (!window.confirm('Wipe all local financial data? This cannot be undone.')) return;
    try {
      await wipeLocalDb();
      setDataBanner({ msg: 'Local data wiped.', ok: true });
      setTimeout(() => setDataBanner(null), 4000);
    } catch {
      setDataBanner({ msg: 'Failed to wipe data.', ok: false });
    }
  }

  function handleDeleteAccount() {
    if (
      !window.confirm(
        'Permanently delete your account and all local data? This cannot be undone.'
      )
    )
      return;
    deleteAccount.mutate();
  }

  // ---- render helpers ----

  function renderRuleForm() {
    return (
      <FormPanel>
        <FormPanelTitle>{rulePanel === 'edit' ? 'Edit Rule' : 'New Alert Rule'}</FormPanelTitle>

        <InputGroup>
          <Label htmlFor="rule-name">Rule name</Label>
          <Input
            id="rule-name"
            value={ruleForm.name}
            onChange={(e) => setRuleForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Large purchases"
          />
        </InputGroup>

        <InputGroup>
          <Label htmlFor="rule-type">Rule type</Label>
          <Select
            id="rule-type"
            value={ruleForm.rule_type}
            onChange={(e) =>
              setRuleForm((f) => ({ ...EMPTY_RULE_FORM, id: f.id, name: f.name, enabled: f.enabled, rule_type: e.target.value as AlertRuleType }))
            }
            disabled={rulePanel === 'edit'}
          >
            <option value="large_transaction">Large transaction</option>
            <option value="budget_threshold">Budget threshold</option>
            <option value="balance_low">Low balance</option>
            <option value="merchant">Merchant watch</option>
          </Select>
        </InputGroup>

        {ruleForm.rule_type === 'large_transaction' && (
          <InputGroup>
            <Label htmlFor="rule-threshold">Threshold amount ($)</Label>
            <Input
              id="rule-threshold"
              type="number"
              min="0"
              step="0.01"
              value={ruleForm.threshold_amount}
              onChange={(e) => setRuleForm((f) => ({ ...f, threshold_amount: e.target.value }))}
              placeholder="e.g. 500"
            />
          </InputGroup>
        )}

        {ruleForm.rule_type === 'budget_threshold' && (
          <>
            <InputGroup>
              <Label htmlFor="rule-budget-line">Budget line</Label>
              <Select
                id="rule-budget-line"
                value={ruleForm.budget_line_id}
                onChange={(e) => setRuleForm((f) => ({ ...f, budget_line_id: e.target.value }))}
              >
                <option value="">Select a budget line…</option>
                {budgetLineOptions.map((bl) => (
                  <option key={bl.id} value={bl.id}>
                    {bl.budget_name} — {bl.name}
                  </option>
                ))}
              </Select>
            </InputGroup>
            <InputGroup>
              <Label htmlFor="rule-threshold-pct">Alert at (% of limit)</Label>
              <Input
                id="rule-threshold-pct"
                type="number"
                min="1"
                max="100"
                value={ruleForm.threshold_pct}
                onChange={(e) => setRuleForm((f) => ({ ...f, threshold_pct: e.target.value }))}
                placeholder="e.g. 80"
              />
            </InputGroup>
            <FormGrid>
              <InputGroup>
                <Label htmlFor="rule-period-start">Period start</Label>
                <Input
                  id="rule-period-start"
                  type="date"
                  value={ruleForm.period_start}
                  onChange={(e) => setRuleForm((f) => ({ ...f, period_start: e.target.value }))}
                />
              </InputGroup>
              <InputGroup>
                <Label htmlFor="rule-period-end">Period end</Label>
                <Input
                  id="rule-period-end"
                  type="date"
                  value={ruleForm.period_end}
                  onChange={(e) => setRuleForm((f) => ({ ...f, period_end: e.target.value }))}
                />
              </InputGroup>
            </FormGrid>
          </>
        )}

        {ruleForm.rule_type === 'balance_low' && (
          <>
            <InputGroup>
              <Label htmlFor="rule-account">Account</Label>
              <Select
                id="rule-account"
                value={ruleForm.account_id}
                onChange={(e) => setRuleForm((f) => ({ ...f, account_id: e.target.value }))}
              >
                <option value="">Select an account…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.institution})
                  </option>
                ))}
              </Select>
            </InputGroup>
            <InputGroup>
              <Label htmlFor="rule-balance-threshold">Alert below ($)</Label>
              <Input
                id="rule-balance-threshold"
                type="number"
                step="0.01"
                value={ruleForm.threshold_amount}
                onChange={(e) => setRuleForm((f) => ({ ...f, threshold_amount: e.target.value }))}
                placeholder="e.g. 100"
              />
            </InputGroup>
          </>
        )}

        {ruleForm.rule_type === 'merchant' && (
          <InputGroup>
            <Label htmlFor="rule-merchants">Merchant names (comma-separated)</Label>
            <Input
              id="rule-merchants"
              value={ruleForm.merchant_names}
              onChange={(e) => setRuleForm((f) => ({ ...f, merchant_names: e.target.value }))}
              placeholder="e.g. Amazon, Uber, Starbucks"
            />
          </InputGroup>
        )}

        <CheckboxRow>
          <input
            type="checkbox"
            checked={ruleForm.enabled}
            onChange={(e) => setRuleForm((f) => ({ ...f, enabled: e.target.checked }))}
          />
          Enable rule
        </CheckboxRow>

        {ruleFormError && <ErrorText>{ruleFormError}</ErrorText>}

        <ButtonRow>
          <PrimaryButton onClick={handleSubmitRuleForm} $loading={saveRule.isPending}>
            {saveRule.isPending ? 'Saving…' : 'Save rule'}
          </PrimaryButton>
          <GhostButton onClick={handleCancelRuleForm}>Cancel</GhostButton>
        </ButtonRow>
      </FormPanel>
    );
  }

  return (
    <Page>
      <PageTitle>Settings</PageTitle>

      {/* ------------------------------------------------------------------ */}
      {/* Profile                                                             */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <SectionTitle>Profile</SectionTitle>

        <Row>
          <div>
            <RowLabel>Email</RowLabel>
            <RowSub>{email}</RowSub>
          </div>
        </Row>

        <Divider />

        <InputGroup>
          <Label htmlFor="timezone">Timezone</Label>
          <Select
            id="timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </InputGroup>

        <InputGroup>
          <Label htmlFor="region">Region</Label>
          <Select
            id="region"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
          >
            {REGIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </InputGroup>

        {profileBanner && <Banner $variant={profileBanner.ok ? 'success' : 'error'}>{profileBanner.msg}</Banner>}

        <ButtonRow>
          <PrimaryButton onClick={() => saveProfile.mutate()} $loading={saveProfile.isPending}>
            {saveProfile.isPending ? 'Saving…' : 'Save'}
          </PrimaryButton>
          <TextButton onClick={() => { setShowPwForm((v) => !v); setPwBanner(null); }}>
            {showPwForm ? 'Cancel password change' : 'Change password'}
          </TextButton>
        </ButtonRow>

        {showPwForm && (
          <FormPanel>
            <FormPanelTitle>Change password</FormPanelTitle>
            <InputGroup>
              <Label htmlFor="pw-current">Current password</Label>
              <Input
                id="pw-current"
                type="password"
                value={pwForm.current}
                onChange={(e) => setPwForm((f) => ({ ...f, current: e.target.value }))}
                autoComplete="current-password"
              />
            </InputGroup>
            <InputGroup>
              <Label htmlFor="pw-new">New password</Label>
              <Input
                id="pw-new"
                type="password"
                value={pwForm.next}
                onChange={(e) => setPwForm((f) => ({ ...f, next: e.target.value }))}
                autoComplete="new-password"
              />
            </InputGroup>
            <InputGroup>
              <Label htmlFor="pw-confirm">Confirm new password</Label>
              <Input
                id="pw-confirm"
                type="password"
                value={pwForm.confirm}
                onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))}
                autoComplete="new-password"
              />
            </InputGroup>
            {pwBanner && (
              <Banner $variant={pwBanner.ok ? 'success' : 'error'}>{pwBanner.msg}</Banner>
            )}
            <ButtonRow>
              <PrimaryButton
                onClick={() => changePassword.mutate(pwForm)}
                $loading={changePassword.isPending}
              >
                {changePassword.isPending ? 'Updating…' : 'Update password'}
              </PrimaryButton>
            </ButtonRow>
          </FormPanel>
        )}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Alert rules                                                         */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <SectionTitle>Alert Rules</SectionTitle>
          {rulePanel === null && (
            <PrimaryButton onClick={handleOpenNewRule}>+ New rule</PrimaryButton>
          )}
        </CardHeader>

        {ruleBanner && <Banner $variant="success">{ruleBanner}</Banner>}

        {rules.length === 0 && rulePanel === null ? (
          <EmptyText>No alert rules yet. Create one to get notified about transactions and balances.</EmptyText>
        ) : (
          <RuleList>
            {rules.map((rule) => (
              <RuleItem key={rule.id}>
                <RuleInfo>
                  <RuleName>{rule.name}</RuleName>
                  <RuleSummary>
                    <Badge $variant="type">{rule.rule_type.replace(/_/g, ' ')}</Badge>
                    {' '}
                    {formatRuleParams(rule)}
                  </RuleSummary>
                </RuleInfo>
                <RuleActions>
                  {!rule.enabled && <Badge $variant="disabled">off</Badge>}
                  <ToggleButton
                    $on={rule.enabled}
                    onClick={() => toggleRule.mutate(rule)}
                    aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'}
                    title={rule.enabled ? 'Disable' : 'Enable'}
                  />
                  <IconButton
                    onClick={() => handleEditRule(rule)}
                    aria-label="Edit rule"
                    title="Edit"
                  >
                    ✎
                  </IconButton>
                  <IconButton
                    className="danger"
                    onClick={() => handleDeleteRule(rule)}
                    aria-label="Delete rule"
                    title="Delete"
                  >
                    ✕
                  </IconButton>
                </RuleActions>
              </RuleItem>
            ))}
          </RuleList>
        )}

        {rulePanel !== null && renderRuleForm()}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Connected devices                                                   */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <SectionTitle>Connected Devices</SectionTitle>

        {devicesLoading && <EmptyText>Loading devices…</EmptyText>}
        {devicesError && <ErrorText>Could not load devices.</ErrorText>}

        {!devicesLoading && !devicesError && devices.length === 0 && (
          <EmptyText>No other devices connected.</EmptyText>
        )}

        {devices.length > 0 && (
          <DeviceList>
            {devices.map((device) => (
              <DeviceItem key={device.id}>
                <DeviceInfo>
                  <DeviceName>
                    {device.name}
                    {device.is_current && (
                      <> <Badge $variant="current">This device</Badge></>
                    )}
                  </DeviceName>
                  <DeviceMeta>
                    {device.platform} · Last active{' '}
                    {new Date(device.last_active_at).toLocaleDateString()}
                  </DeviceMeta>
                </DeviceInfo>
                {!device.is_current && (
                  <DangerButton
                    onClick={() => handleRevokeDevice(device)}
                    disabled={revokeDevice.isPending}
                  >
                    Revoke
                  </DangerButton>
                )}
              </DeviceItem>
            ))}
          </DeviceList>
        )}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Data                                                                */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <SectionTitle>Data</SectionTitle>

        <Row>
          <div>
            <RowLabel>Export local data</RowLabel>
            <RowSub>Download all your transactions, budgets, and settings as JSON.</RowSub>
          </div>
          <GhostButton onClick={handleExportData}>Export</GhostButton>
        </Row>

        <Divider />

        <Row>
          <div>
            <RowLabel>Wipe local database</RowLabel>
            <RowSub>Remove all financial data from this device. Your account remains active.</RowSub>
          </div>
          <DangerButton onClick={handleWipeLocalDb}>Wipe</DangerButton>
        </Row>

        {dataBanner && (
          <Banner $variant={dataBanner.ok ? 'success' : 'error'}>{dataBanner.msg}</Banner>
        )}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Danger zone                                                         */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <SectionTitle>Danger Zone</SectionTitle>

        <Row>
          <div>
            <RowLabel>Sign out</RowLabel>
            <RowSub>Removes your session from this browser. Local data is preserved.</RowSub>
          </div>
          <DangerButton onClick={logout}>Sign out</DangerButton>
        </Row>

        <Divider />

        <Row>
          <div>
            <RowLabel>Delete account</RowLabel>
            <RowSub>
              Permanently deletes your account and wipes all local data. This cannot be undone.
            </RowSub>
          </div>
          <DangerButton onClick={handleDeleteAccount} disabled={deleteAccount.isPending}>
            {deleteAccount.isPending ? 'Deleting…' : 'Delete account'}
          </DangerButton>
        </Row>

        {deleteAccount.isError && (
          <Banner $variant="error">Failed to delete account. Please try again.</Banner>
        )}
      </Card>
    </Page>
  );
}
