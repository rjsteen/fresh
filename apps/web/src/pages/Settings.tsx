import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';

const Page = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[6]};
  max-width: 540px;
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

const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
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

export function Settings() {
  const navigate = useNavigate();
  const email = localStorage.getItem('user_email') ?? '—';

  function handleSignOut() {
    localStorage.removeItem('device_token');
    localStorage.removeItem('user_email');
    navigate('/');
  }

  return (
    <Page>
      <PageTitle>Settings</PageTitle>

      <Card>
        <Row>
          <div>
            <RowLabel>Account</RowLabel>
            <RowSub>{email}</RowSub>
          </div>
        </Row>
        <Row>
          <div>
            <RowLabel>Sign out</RowLabel>
            <RowSub>Removes your session from this browser.</RowSub>
          </div>
          <DangerButton onClick={handleSignOut}>Sign out</DangerButton>
        </Row>
      </Card>

      <Card>
        <Row>
          <div>
            <RowLabel>Data & privacy</RowLabel>
            <RowSub>
              Your financial data is stored only on your device. Fresh servers never
              store transactions, balances, or bank credentials.
            </RowSub>
          </div>
        </Row>
      </Card>
    </Page>
  );
}
