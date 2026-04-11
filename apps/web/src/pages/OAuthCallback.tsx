import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import {
  exchangeDropboxCode,
  exchangeGDriveCode,
  getPendingProvider,
} from '../cloud/oauth';

const Screen = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.space[4]};
  height: 100vh;
  background: ${({ theme }) => theme.color.bg};
`;

const Message = styled.p`
  font-size: ${({ theme }) => theme.font.size.md};
  color: ${({ theme }) => theme.color.textMuted};
`;

const ErrorMessage = styled.p`
  font-size: ${({ theme }) => theme.font.size.base};
  color: ${({ theme }) => theme.color.danger};
  max-width: 400px;
  text-align: center;
`;

const BackLink = styled.button`
  background: none;
  border: none;
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  color: ${({ theme }) => theme.color.green600};
  cursor: pointer;

  &:hover {
    color: ${({ theme }) => theme.color.green700};
    text-decoration: underline;
  }
`;

export function OAuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const oauthError = searchParams.get('error');

    if (oauthError) {
      setError(`Provider denied access: ${oauthError}`);
      return;
    }

    if (!code || !state) {
      setError('Missing code or state parameter in callback URL.');
      return;
    }

    const provider = getPendingProvider();
    if (!provider) {
      setError('Unknown provider — please start the connection flow from Settings again.');
      return;
    }

    const exchange = provider === 'dropbox'
      ? exchangeDropboxCode(code, state)
      : exchangeGDriveCode(code, state);

    exchange
      .then(() => navigate('/settings', { replace: true }))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Token exchange failed.');
      });
  // Run once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <Screen>
        <ErrorMessage>{error}</ErrorMessage>
        <BackLink onClick={() => navigate('/settings', { replace: true })}>
          Back to Settings
        </BackLink>
      </Screen>
    );
  }

  return (
    <Screen>
      <Message>Connecting to cloud storage…</Message>
    </Screen>
  );
}
