import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import styled from 'styled-components';
import { format } from 'date-fns';
import { useDb } from '../App';
import { getAccounts } from '@fresh/core/db';
import type { Account } from '@fresh/core/db';
import { useFinanceSocket } from '@fresh/core/channels';
import { useAuth } from '../hooks/useAuth';
import { apiFetch, API } from '../utils/api';

const WS_URL = API.replace(/^http/, 'ws') + '/socket';

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Page = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[6]};
  max-width: 720px;
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

const AccountList = styled.ul`
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[3]};
`;

const AccountCard = styled.li`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[2]};
  padding: ${({ theme }) => theme.space[4]};
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.lg};
  background: ${({ theme }) => theme.color.bg};
`;

const AccountHeader = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.space[2]};
`;

const AccountName = styled.span`
  font-size: ${({ theme }) => theme.font.size.base};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.color.text};
  flex: 1;
`;

const TypeBadge = styled.span`
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

const SyncBadge = styled.span<{ $status: 'idle' | 'syncing' | 'error' }>`
  display: inline-block;
  padding: 2px ${({ theme }) => theme.space[2]};
  border-radius: ${({ theme }) => theme.radius.full};
  font-size: ${({ theme }) => theme.font.size.xs};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  border: 1px solid;

  ${({ $status, theme }) => {
    if ($status === 'syncing') return `
      background: ${theme.color.green50};
      border-color: ${theme.color.green100};
      color: ${theme.color.green700};
    `;
    if ($status === 'error') return `
      background: ${theme.color.dangerBg};
      border-color: ${theme.color.danger}33;
      color: ${theme.color.danger};
    `;
    return `
      background: transparent;
      border-color: ${theme.color.border};
      color: ${theme.color.textMuted};
    `;
  }}
`;

const AccountBalance = styled.div`
  font-size: ${({ theme }) => theme.font.size['2xl']};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  color: ${({ theme }) => theme.color.text};
  letter-spacing: -0.5px;
`;

const AccountMeta = styled.div`
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.color.textMuted};
`;

const AccountFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: ${({ theme }) => theme.space[2]};
  margin-top: ${({ theme }) => theme.space[1]};
`;

const SyncNowButton = styled.button`
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.green700};
  background: ${({ theme }) => theme.color.green50};
  border: 1px solid ${({ theme }) => theme.color.green100};
  border-radius: ${({ theme }) => theme.radius.sm};
  padding: ${({ theme }) => `${theme.space[1]} ${theme.space[3]}`};
  cursor: pointer;
  transition: ${({ theme }) => theme.transition.fast};

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.color.green100};
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const RemoveButton = styled.button`
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

const ProviderGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.space[3]};

  @media (max-width: 500px) {
    grid-template-columns: 1fr;
  }
`;

const ProviderCard = styled.button`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[2]};
  padding: ${({ theme }) => theme.space[5]};
  background: ${({ theme }) => theme.color.bg};
  border: 1.5px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.lg};
  text-align: left;
  cursor: pointer;
  transition: ${({ theme }) => theme.transition.fast};

  &:hover {
    border-color: ${({ theme }) => theme.color.green400};
    background: ${({ theme }) => theme.color.green50};
  }
`;

const ProviderName = styled.div`
  font-size: ${({ theme }) => theme.font.size.base};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.color.text};
`;

const ProviderDesc = styled.div`
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.textMuted};
  line-height: ${({ theme }) => theme.font.lineHeight.relaxed};
`;

const ProviderRegion = styled.span`
  display: inline-block;
  padding: 2px ${({ theme }) => theme.space[2]};
  background: ${({ theme }) => theme.color.green50};
  border: 1px solid ${({ theme }) => theme.color.green100};
  border-radius: ${({ theme }) => theme.radius.full};
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.color.green700};
  font-weight: ${({ theme }) => theme.font.weight.medium};
`;

const InputRow = styled.div`
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

type Panel = null | 'simplefin' | 'gocardless';
type SyncStatus = 'idle' | 'syncing' | 'error';

interface SyncJob {
  id: string;
  connection_type: string;
  status: string;
  account_token_ref: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBalance(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatLastSynced(iso: string | null): string {
  if (!iso) return 'Never synced';
  try {
    return 'Synced ' + format(new Date(iso), 'MMM d, h:mm a');
  } catch {
    return 'Synced recently';
  }
}

function normalizeSyncStatus(jobStatus: string): SyncStatus {
  if (jobStatus === 'syncing' || jobStatus === 'running') return 'syncing';
  if (jobStatus === 'error' || jobStatus === 'failed') return 'error';
  return 'idle';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Accounts() {
  const db = useDb();
  const { token } = useAuth();
  const qc = useQueryClient();

  const [panel, setPanel] = useState<Panel>(null);
  const [setupToken, setSetupToken] = useState('');
  const [institutionId, setInstitutionId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [syncStatusOverride, setSyncStatusOverride] = useState<Record<string, SyncStatus>>({});

  // Accounts from on-device SQLite
  const { data: accounts = [], refetch: refetchAccounts } = useQuery<Account[]>({
    queryKey: ['accounts'],
    queryFn: () => getAccounts(db.raw),
  });

  // Sync jobs from backend — used for job IDs, initial status, and sync triggering
  const { data: syncJobs = [] } = useQuery<SyncJob[]>({
    queryKey: ['sync-jobs'],
    queryFn: async () => {
      const res = await apiFetch(`${API}/api/v1/sync/jobs`);
      if (!res.ok) throw new Error('Failed to fetch sync jobs');
      return res.json();
    },
  });

  // O(1) lookup: sync_token_ref → SyncJob
  const syncJobsByRef = useMemo(
    () => new Map(syncJobs.map((j) => [j.account_token_ref, j])),
    [syncJobs],
  );

  // Real-time sync status from Phoenix channel
  useFinanceSocket({
    url: WS_URL,
    deviceToken: token,
    onSyncComplete: ({ account_token_ref }) => {
      setSyncStatusOverride((prev) => ({ ...prev, [account_token_ref]: 'idle' }));
      refetchAccounts();
      qc.invalidateQueries({ queryKey: ['sync-jobs'] });
    },
    onSyncError: ({ account_token_ref }) => {
      setSyncStatusOverride((prev) => ({ ...prev, [account_token_ref]: 'error' }));
    },
  });

  function getStatusForAccount(account: Account): SyncStatus {
    if (account.sync_token_ref) {
      const override = syncStatusOverride[account.sync_token_ref];
      if (override) return override;
      const job = syncJobsByRef.get(account.sync_token_ref);
      if (job) return normalizeSyncStatus(job.status);
    }
    return 'idle';
  }

  const triggerSyncMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await apiFetch(`${API}/api/v1/sync/${jobId}/trigger`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to trigger sync');
    },
    onMutate: (jobId) => {
      const job = syncJobs.find((j) => j.id === jobId);
      if (job) {
        setSyncStatusOverride((prev) => ({ ...prev, [job.account_token_ref]: 'syncing' }));
      }
    },
    onError: (e: Error, jobId) => {
      const job = syncJobs.find((j) => j.id === jobId);
      if (job) {
        setSyncStatusOverride((prev) => ({ ...prev, [job.account_token_ref]: 'idle' }));
      }
      setError(e.message);
    },
  });

  const removeMutation = useMutation({
    mutationFn: async ({ accountId, jobId }: { accountId: string; jobId?: string }) => {
      if (jobId) {
        const res = await apiFetch(`${API}/api/v1/connections/${jobId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to remove connection');
      }
      await db.raw.execute('DELETE FROM accounts WHERE id = ?', [accountId]);
    },
    onSuccess: () => {
      refetchAccounts();
      qc.invalidateQueries({ queryKey: ['sync-jobs'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const simplefinMutation = useMutation({
    mutationFn: async (token: string) => {
      const res = await apiFetch(`${API}/api/v1/connections/simplefin/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setup_token: token }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? 'Failed to connect');
      }
      return res.json();
    },
    onSuccess: () => {
      setSuccess('SimpleFIN account connected. Your device will sync shortly.');
      setPanel(null);
      setSetupToken('');
      qc.invalidateQueries({ queryKey: ['sync-jobs'] });
      refetchAccounts();
    },
    onError: (e: Error) => setError(e.message),
  });

  const gocardlessMutation = useMutation({
    mutationFn: async (instId: string) => {
      const res = await apiFetch(`${API}/api/v1/connections/gocardless/requisition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ institution_id: instId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? 'Failed to create requisition');
      }
      return res.json() as Promise<{ link: string }>;
    },
    onSuccess: (data) => {
      window.location.href = data.link;
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Page>
      <PageTitle>Accounts</PageTitle>

      {success && <SuccessBanner>{success}</SuccessBanner>}

      {accounts.length > 0 && (
        <Card>
          <SectionTitle>Your accounts</SectionTitle>
          <AccountList>
            {accounts.map((account) => {
              const status = getStatusForAccount(account);
              const syncJob = account.sync_token_ref
                ? syncJobsByRef.get(account.sync_token_ref)
                : undefined;
              return (
                <AccountCard key={account.id}>
                  <AccountHeader>
                    <AccountName>{account.name}</AccountName>
                    <TypeBadge>{account.type}</TypeBadge>
                    <SyncBadge $status={status}>
                      {status === 'syncing' ? 'Syncing…' : status === 'error' ? 'Error' : 'Idle'}
                    </SyncBadge>
                  </AccountHeader>
                  <AccountBalance>
                    {formatBalance(account.current_balance, account.currency)}
                  </AccountBalance>
                  <AccountMeta>{formatLastSynced(account.last_synced_at)}</AccountMeta>
                  <AccountFooter>
                    {syncJob && (
                      <SyncNowButton
                        disabled={status === 'syncing' || triggerSyncMutation.isPending}
                        onClick={() => triggerSyncMutation.mutate(syncJob.id)}
                      >
                        {status === 'syncing' ? 'Syncing…' : 'Sync now'}
                      </SyncNowButton>
                    )}
                    <RemoveButton
                      onClick={() =>
                        removeMutation.mutate({ accountId: account.id, jobId: syncJob?.id })
                      }
                    >
                      Remove
                    </RemoveButton>
                  </AccountFooter>
                </AccountCard>
              );
            })}
          </AccountList>
        </Card>
      )}

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <Card>
        <SectionTitle>Connect a bank</SectionTitle>

        {!panel && (
          <ProviderGrid>
            <ProviderCard onClick={() => { setPanel('simplefin'); setError(null); }}>
              <ProviderRegion>US</ProviderRegion>
              <ProviderName>SimpleFIN</ProviderName>
              <ProviderDesc>
                Connect US bank accounts using a one-time setup token from SimpleFIN Bridge.
              </ProviderDesc>
            </ProviderCard>
            <ProviderCard onClick={() => { setPanel('gocardless'); setError(null); }}>
              <ProviderRegion>EU</ProviderRegion>
              <ProviderName>GoCardless</ProviderName>
              <ProviderDesc>
                Connect European bank accounts via GoCardless Bank Account Data.
              </ProviderDesc>
            </ProviderCard>
          </ProviderGrid>
        )}

        {panel === 'simplefin' && (
          <>
            <p style={{ marginBottom: '16px', fontSize: '14px', color: 'var(--text-muted)' }}>
              Visit{' '}
              <a href="https://bridge.simplefin.org" target="_blank" rel="noopener noreferrer">
                bridge.simplefin.org
              </a>
              {' '}to generate a setup token, then paste it below.
            </p>
            <InputRow>
              <Label htmlFor="sf-token">Setup token</Label>
              <Input
                id="sf-token"
                type="text"
                placeholder="Paste your SimpleFIN setup token"
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
              />
            </InputRow>
            {error && <ErrorBanner style={{ marginTop: '12px' }}>{error}</ErrorBanner>}
            <ButtonRow>
              <PrimaryButton
                $loading={simplefinMutation.isPending}
                disabled={simplefinMutation.isPending || !setupToken.trim()}
                onClick={() => simplefinMutation.mutate(setupToken.trim())}
              >
                {simplefinMutation.isPending ? 'Connecting…' : 'Connect'}
              </PrimaryButton>
              <GhostButton onClick={() => { setPanel(null); setError(null); setSetupToken(''); }}>
                Cancel
              </GhostButton>
            </ButtonRow>
          </>
        )}

        {panel === 'gocardless' && (
          <>
            <p style={{ marginBottom: '16px', fontSize: '14px', color: 'var(--text-muted)' }}>
              Enter your bank&apos;s GoCardless institution ID. You&apos;ll be redirected to authorize access.
            </p>
            <InputRow>
              <Label htmlFor="gc-institution">Institution ID</Label>
              <Input
                id="gc-institution"
                type="text"
                placeholder="e.g. MONZO_MONZGB2L"
                value={institutionId}
                onChange={(e) => setInstitutionId(e.target.value)}
              />
            </InputRow>
            {error && <ErrorBanner style={{ marginTop: '12px' }}>{error}</ErrorBanner>}
            <ButtonRow>
              <PrimaryButton
                $loading={gocardlessMutation.isPending}
                disabled={gocardlessMutation.isPending || !institutionId.trim()}
                onClick={() => gocardlessMutation.mutate(institutionId.trim())}
              >
                {gocardlessMutation.isPending ? 'Redirecting…' : 'Authorize'}
              </PrimaryButton>
              <GhostButton onClick={() => { setPanel(null); setError(null); setInstitutionId(''); }}>
                Cancel
              </GhostButton>
            </ButtonRow>
          </>
        )}
      </Card>
    </Page>
  );
}
