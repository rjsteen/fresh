import { Link } from 'react-router-dom';
import styled from 'styled-components';

const Page = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: ${({ theme }) => theme.space[4]};
  text-align: center;
`;

const Title = styled.h2`
  font-size: ${({ theme }) => theme.font.size.xl};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  color: ${({ theme }) => theme.color.text};
`;

const Body = styled.p`
  font-size: ${({ theme }) => theme.font.size.base};
  color: ${({ theme }) => theme.color.textMuted};
  max-width: 380px;
  line-height: ${({ theme }) => theme.font.lineHeight.relaxed};
`;

const BackLink = styled(Link)`
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.green600};
  text-decoration: none;

  &:hover { text-decoration: underline; }
`;

export function Budget() {
  return (
    <Page>
      <Title>Budgets live on your device</Title>
      <Body>
        Budget rules and tracking are managed in the Fresh mobile app, where your
        transaction data is stored.
      </Body>
      <BackLink to="/dashboard">← Back to dashboard</BackLink>
    </Page>
  );
}
