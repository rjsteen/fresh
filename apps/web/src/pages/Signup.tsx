import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const Page = styled.div`
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${({ theme }) => theme.color.bg};
  padding: ${({ theme }) => theme.space[6]};
`;

const Card = styled.div`
  width: 100%;
  max-width: 400px;
  background: ${({ theme }) => theme.color.surface};
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.xl};
  padding: ${({ theme }) => theme.space[10]};
  box-shadow: ${({ theme }) => theme.shadow.lg};
  animation: ${fadeUp} 0.3s ease both;
`;

const BrandMark = styled.div`
  margin-bottom: ${({ theme }) => theme.space[8]};
  text-align: center;
`;

const WordMark = styled.h1`
  font-size: ${({ theme }) => theme.font.size['3xl']};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  color: ${({ theme }) => theme.color.green600};
  letter-spacing: -1px;
  line-height: 1;
  margin-bottom: ${({ theme }) => theme.space[2]};
`;

const Tagline = styled.p`
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.textMuted};
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[4]};
`;

const FieldGroup = styled.label`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[1]};
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

  &::placeholder { color: ${({ theme }) => theme.color.textMuted}; }
  &:hover { border-color: ${({ theme }) => theme.color.green300}; }
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

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.color.green400};
    box-shadow: ${({ theme }) => theme.shadow.focus};
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

const SubmitButton = styled.button<{ $loading?: boolean }>`
  margin-top: ${({ theme }) => theme.space[2]};
  width: 100%;
  padding: ${({ theme }) => `${theme.space[3]} ${theme.space[4]}`};
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

const FooterNote = styled.p`
  margin-top: ${({ theme }) => theme.space[6]};
  text-align: center;
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.color.textMuted};

  a {
    color: ${({ theme }) => theme.color.green600};
    text-decoration: none;
    &:hover { text-decoration: underline; }
  }
`;

export function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [region, setRegion] = useState<'us' | 'eu'>('us');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const resp = await fetch(`${API}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, region }),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error ?? 'Registration failed');
      }

      const { token } = await resp.json();
      localStorage.setItem('device_token', token);

      await fetch(`${API}/api/v1/devices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: `${navigator.platform} Browser`, platform: 'web' }),
      });

      window.location.href = '/accounts';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Page>
      <Card>
        <BrandMark>
          <WordMark>Fresh</WordMark>
          <Tagline>Create your account</Tagline>
        </BrandMark>

        <Form onSubmit={handleSubmit}>
          <FieldGroup>
            Email
            <Input
              type="email"
              value={email}
              placeholder="you@example.com"
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </FieldGroup>

          <FieldGroup>
            Password
            <Input
              type="password"
              value={password}
              placeholder="••••••••"
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              minLength={8}
            />
          </FieldGroup>

          <FieldGroup>
            Region
            <Select value={region} onChange={(e) => setRegion(e.target.value as 'us' | 'eu')}>
              <option value="us">United States (SimpleFIN)</option>
              <option value="eu">Europe (GoCardless)</option>
            </Select>
          </FieldGroup>

          {error && <ErrorBanner>{error}</ErrorBanner>}

          <SubmitButton type="submit" disabled={loading} $loading={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </SubmitButton>
        </Form>

        <FooterNote>
          Already have an account? <Link to="/login">Sign in</Link>
        </FooterNote>
      </Card>
    </Page>
  );
}
