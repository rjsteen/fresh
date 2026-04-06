import React from 'react';
import { useQuery } from '@tanstack/react-query';
import styled from 'styled-components';
import { format } from 'date-fns';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('device_token')}` };
}

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Page = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[6]};
  max-width: 860px;
`;

const PageTitle = styled.h2`
  font-size: ${({ theme }) => theme.font.size.xl};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  color: ${({ theme }) => theme.color.text};
`;

const CardRow = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: ${({ theme }) => theme.space[4]};
`;

const Card = styled.div`
  background: ${({ theme }) => theme.color.surface};
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: ${({ theme }) => theme.space[5]};
`;

const CardLabel = styled.div`
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  color: ${({ theme }) => theme.color.textMuted};
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: ${({ theme }) => theme.space[2]};
`;

const CardValue = styled.div`
  font-size: ${({ theme }) => theme.font.size['2xl']};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  color: ${({ theme }) => theme.color.text};
  letter-spacing: -0.5px;
`;

const MobileCallout = styled.div`
  background: ${({ theme }) => theme.color.green50};
  border: 1px solid ${({ theme }) => theme.color.green100};
  border-radius: ${({ theme }) => theme.radius.xl};
  padding: ${({ theme }) => theme.space[8]};
  text-align: center;
`;

const CalloutTitle = styled.h3`
  font-size: ${({ theme }) => theme.font.size.lg};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.color.text};
  margin-bottom: ${({ theme }) => theme.space[2]};
`;

const CalloutBody = styled.p`
  font-size: ${({ theme }) => theme.font.size.base};
  color: ${({ theme }) => theme.color.textMuted};
  max-width: 420px;
  margin: 0 auto;
  line-height: ${({ theme }) => theme.font.lineHeight.relaxed};
`;

const SyncTable = styled.table`
  width: 100%;
  border-collapse: collapse;

  th {
    font-size: ${({ theme }) => theme.font.size.xs};
    font-weight: ${({ theme }) => theme.font.weight.semibold};
    color: ${({ theme }) => theme.color.textMuted};
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: ${({ theme }) => `${theme.space[2]} ${theme.space[3]}`};
    text-align: left;
    border-bottom: 1.5px solid ${({ theme }) => theme.color.border};
  }

  td {
    padding: ${({ theme }) => `${theme.space[3]} ${theme.space[3]}`};
    font-size: ${({ theme }) => theme.font.size.sm};
    color: ${({ theme }) => theme.color.text};
    border-bottom: 1px solid ${({ theme }) => theme.color.border};
  }

  tbody tr:last-child td {
    border-bottom: none;
  }
`;

const StatusBadge = styled.span<{ $status: string }>`
  display: inline-block;
  padding: 2px ${({ theme }) => theme.space[2]};
  border-radius: ${({ theme }) => theme.radius.full};
  font-size: ${({ theme }) => theme.font.size.xs};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  background: ${({ $status, theme }) =>
    $status === 'active' ? theme.color.green50 : theme.color.dangerBg};
  color: ${({ $status, theme }) =>
    $status === 'active' ? theme.color.green700 : theme.color.danger};
  border: 1px solid ${({ $status, theme }) =>
    $status === 'active' ? theme.color.green100 : `${theme.color.danger}33`};
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface SyncJob {
  id: string;
  connection_type: string;
  status: string;
  last_synced_at: string | null;
  sync_schedule: string;
}

export function Dashboard() {
  const { data: jobs = [], isLoading } = useQuery<SyncJob[]>({
    queryKey: ['sync-jobs'],
    queryFn: async () => {
      const res = await fetch(`${API}/api/v1/sync/jobs`, { headers: authHeaders() });
      if (!res.ok) throw new Error('Failed to fetch sync jobs');
      return res.json();
    },
  });

  const activeJobs = jobs.filter((j) => j.status === 'active');

  return (
    <Page>
      <PageTitle>Dashboard</PageTitle>

      <CardRow>
        <Card>
          <CardLabel>Connected Banks</CardLabel>
          <CardValue>{isLoading ? '–' : jobs.length}</CardValue>
        </Card>
        <Card>
          <CardLabel>Active Syncs</CardLabel>
          <CardValue>{isLoading ? '–' : activeJobs.length}</CardValue>
        </Card>
      </CardRow>

      <MobileCallout>
        <CalloutTitle>Your data lives on your device</CalloutTitle>
        <CalloutBody>
          Transactions, balances, and budgets are stored in an encrypted database on your phone.
          Open the Fresh mobile app to view and manage your finances.
        </CalloutBody>
      </MobileCallout>

      {jobs.length > 0 && (
        <Card>
          <CardLabel style={{ marginBottom: '12px' }}>Sync Jobs</CardLabel>
          <SyncTable>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Status</th>
                <th>Last Synced</th>
                <th>Schedule</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>{job.connection_type === 'gocardless' ? 'GoCardless' : 'SimpleFIN'}</td>
                  <td><StatusBadge $status={job.status}>{job.status}</StatusBadge></td>
                  <td>{job.last_synced_at ? format(new Date(job.last_synced_at), 'MMM d, h:mm a') : '—'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{job.sync_schedule}</td>
                </tr>
              ))}
            </tbody>
          </SyncTable>
        </Card>
      )}
    </Page>
  );
}
