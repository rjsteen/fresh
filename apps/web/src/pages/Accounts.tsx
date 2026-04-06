import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import styled from 'styled-components';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('device_token')}`,
  };
}

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

const ConnectionList = styled.ul`
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[3]};
`;

const ConnectionItem = styled.li`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${({ theme }) => theme.space[4]};
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.lg};
  background: ${({ theme }) => theme.color.bg};
`;

const ConnectionInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const ConnectionName = styled.span`
  font-size: ${({ theme }) => theme.font.size.base};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  color: ${({ theme }) => theme.color.text};
`;

const ConnectionMeta = styled.span`
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.color.textMuted};
`;

const DisconnectButton = styled.button`
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Panel = null | 'simplefin' | 'gocardless';

interface SyncJob {
  id: string;
  connection_type: string;
  status: string;
  account_token_ref: string;
}

export function Accounts() {
  const qc = useQueryClient();
  const [panel, setPanel] = useState<Panel>(null);
  const [token, setToken] = useState('');
  const [institutionId, setInstitutionId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { data: connections = [] } = useQuery<SyncJob[]>({
    queryKey: ['sync-jobs'],
    queryFn: async () => {
      const res = await fetch(`${API}/api/v1/sync/jobs`, { headers: authHeaders() });
      if (!res.ok) throw new Error('Failed to fetch connections');
      return res.json();
    },
  });

  const simplefinMutation = useMutation({
    mutationFn: async (setupToken: string) => {
      const res = await fetch(`${API}/api/v1/connections/simplefin/claim`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ setup_token: setupToken }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to connect');
      }
      return res.json();
    },
    onSuccess: () => {
      setSuccess('SimpleFIN account connected. Your device will sync shortly.');
      setPanel(null);
      setToken('');
      qc.invalidateQueries({ queryKey: ['sync-jobs'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const gocardlessMutation = useMutation({
    mutationFn: async (instId: string) => {
      const res = await fetch(`${API}/api/v1/connections/gocardless/requisition`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ institution_id: instId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to create requisition');
      }
      return res.json() as Promise<{ link: string }>;
    },
    onSuccess: (data) => {
      window.location.href = data.link;
    },
    onError: (e: Error) => setError(e.message),
  });

  const disconnectMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API}/api/v1/connections/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Failed to disconnect');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sync-jobs'] }),
  });

  return (
    <Page>
      <PageTitle>Accounts</PageTitle>

      {success && <SuccessBanner>{success}</SuccessBanner>}

      {/* Existing connections */}
      {connections.length > 0 && (
        <Card>
          <SectionTitle>Connected banks</SectionTitle>
          <ConnectionList>
            {connections.map((c) => (
              <ConnectionItem key={c.id}>
                <ConnectionInfo>
                  <ConnectionName>
                    {c.connection_type === 'gocardless' ? 'GoCardless' : 'SimpleFIN'}
                  </ConnectionName>
                  <ConnectionMeta>{c.status}</ConnectionMeta>
                </ConnectionInfo>
                <DisconnectButton onClick={() => disconnectMutation.mutate(c.id)}>
                  Disconnect
                </DisconnectButton>
              </ConnectionItem>
            ))}
          </ConnectionList>
        </Card>
      )}

      {/* Add connection */}
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
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </InputRow>
            {error && <ErrorBanner style={{ marginTop: '12px' }}>{error}</ErrorBanner>}
            <ButtonRow>
              <PrimaryButton
                $loading={simplefinMutation.isPending}
                disabled={simplefinMutation.isPending || !token.trim()}
                onClick={() => simplefinMutation.mutate(token.trim())}
              >
                {simplefinMutation.isPending ? 'Connecting…' : 'Connect'}
              </PrimaryButton>
              <GhostButton onClick={() => { setPanel(null); setError(null); setToken(''); }}>
                Cancel
              </GhostButton>
            </ButtonRow>
          </>
        )}

        {panel === 'gocardless' && (
          <>
            <p style={{ marginBottom: '16px', fontSize: '14px', color: 'var(--text-muted)' }}>
              Enter your bank's GoCardless institution ID. You'll be redirected to authorize access.
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
