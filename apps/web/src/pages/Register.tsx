import { useState } from 'react';
import { Link } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';
import { z } from 'zod';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

// ---------------------------------------------------------------------------
// Validation schema — mirrors backend User registration_changeset
// ---------------------------------------------------------------------------

const registerSchema = z
  .object({
    email: z
      .string()
      .min(1, 'Email is required')
      .regex(/^[^\s]+@[^\s]+$/, 'Must be a valid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
    region: z.enum(['us', 'eu'], { message: 'Region must be US or EU' }),
    timezone: z.string().min(1, 'Timezone is required'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type RegisterFields = z.infer<typeof registerSchema>;
type FieldErrors = Partial<Record<keyof RegisterFields, string>>;

// ---------------------------------------------------------------------------
// Timezone options — derived from the browser's IANA list when available
// ---------------------------------------------------------------------------

const TIMEZONES: string[] = (() => {
  try {
    return (Intl as { supportedValuesOf?: (key: string) => string[] })
      .supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
})();

const FALLBACK_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'America/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Helsinki',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Australia/Sydney',
];

const tzOptions = TIMEZONES.length > 0 ? TIMEZONES : FALLBACK_TIMEZONES;

const detectedTimezone = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
})();

// ---------------------------------------------------------------------------
// Animations
// ---------------------------------------------------------------------------

const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
`;

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

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
  max-width: 420px;
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

const Input = styled.input<{ $invalid?: boolean }>`
  width: 100%;
  padding: ${({ theme }) => `${theme.space[3]} ${theme.space[4]}`};
  border: 1.5px solid
    ${({ theme, $invalid }) => ($invalid ? theme.color.danger : theme.color.border)};
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.color.surface};
  color: ${({ theme }) => theme.color.text};
  font-size: ${({ theme }) => theme.font.size.base};
  transition: ${({ theme }) => theme.transition.fast};
  box-sizing: border-box;

  &::placeholder {
    color: ${({ theme }) => theme.color.textMuted};
  }

  &:hover {
    border-color: ${({ theme, $invalid }) =>
      $invalid ? theme.color.danger : theme.color.green300};
  }

  &:focus {
    outline: none;
    border-color: ${({ theme, $invalid }) =>
      $invalid ? theme.color.danger : theme.color.green400};
    box-shadow: ${({ theme }) => theme.shadow.focus};
  }
`;

const Select = styled.select<{ $invalid?: boolean }>`
  width: 100%;
  padding: ${({ theme }) => `${theme.space[3]} ${theme.space[4]}`};
  border: 1.5px solid
    ${({ theme, $invalid }) => ($invalid ? theme.color.danger : theme.color.border)};
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.color.surface};
  color: ${({ theme }) => theme.color.text};
  font-size: ${({ theme }) => theme.font.size.base};
  transition: ${({ theme }) => theme.transition.fast};
  cursor: pointer;

  &:focus {
    outline: none;
    border-color: ${({ theme, $invalid }) =>
      $invalid ? theme.color.danger : theme.color.green400};
    box-shadow: ${({ theme }) => theme.shadow.focus};
  }
`;

const FieldError = styled.span`
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.color.danger};
  font-weight: ${({ theme }) => theme.font.weight.regular};
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
  letter-spacing: 0.01em;

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.color.green600};
    box-shadow: ${({ theme }) => theme.shadow.md};
    transform: translateY(-1px);
  }

  &:active:not(:disabled) {
    background: ${({ theme }) => theme.color.green700};
    transform: translateY(0);
  }
`;

const FooterNote = styled.p`
  margin-top: ${({ theme }) => theme.space[6]};
  text-align: center;
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.color.textMuted};
  line-height: ${({ theme }) => theme.font.lineHeight.relaxed};

  a {
    color: ${({ theme }) => theme.color.green600};
    text-decoration: none;
    &:hover {
      text-decoration: underline;
    }
  }
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Register() {
  const [fields, setFields] = useState<RegisterFields>({
    email: '',
    password: '',
    confirmPassword: '',
    region: 'us',
    timezone: detectedTimezone,
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function set<K extends keyof RegisterFields>(key: K, value: RegisterFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
    // Clear the field error as soon as the user starts correcting it
    if (fieldErrors[key]) {
      setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);

    const result = registerSchema.safeParse(fields);
    if (!result.success) {
      const errs: FieldErrors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof RegisterFields;
        if (!errs[key]) errs[key] = issue.message;
      }
      setFieldErrors(errs);
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch(`${API}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: fields.email,
          password: fields.password,
          region: fields.region,
          timezone: fields.timezone,
        }),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        // Surface field-level errors from the server (e.g. "email has already been taken")
        if (body.errors && typeof body.errors === 'object') {
          const serverFieldErrors: FieldErrors = {};
          for (const [k, msgs] of Object.entries(body.errors)) {
            const key = k as keyof RegisterFields;
            serverFieldErrors[key] = Array.isArray(msgs) ? msgs[0] : String(msgs);
          }
          setFieldErrors(serverFieldErrors);
        } else {
          throw new Error(body.error ?? 'Registration failed');
        }
        return;
      }

      const { token } = await resp.json();
      localStorage.setItem('device_token', token);

      await fetch(`${API}/api/v1/devices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: `${navigator.platform} Browser`,
          platform: 'web',
        }),
      });

      window.location.href = '/dashboard';
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Unknown error');
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

        <Form onSubmit={handleSubmit} noValidate>
          <FieldGroup>
            Email
            <Input
              type="email"
              value={fields.email}
              placeholder="you@example.com"
              onChange={(e) => set('email', e.target.value)}
              autoComplete="email"
              $invalid={!!fieldErrors.email}
            />
            {fieldErrors.email && <FieldError>{fieldErrors.email}</FieldError>}
          </FieldGroup>

          <FieldGroup>
            Password
            <Input
              type="password"
              value={fields.password}
              placeholder="••••••••"
              onChange={(e) => set('password', e.target.value)}
              autoComplete="new-password"
              $invalid={!!fieldErrors.password}
            />
            {fieldErrors.password && <FieldError>{fieldErrors.password}</FieldError>}
          </FieldGroup>

          <FieldGroup>
            Confirm password
            <Input
              type="password"
              value={fields.confirmPassword}
              placeholder="••••••••"
              onChange={(e) => set('confirmPassword', e.target.value)}
              autoComplete="new-password"
              $invalid={!!fieldErrors.confirmPassword}
            />
            {fieldErrors.confirmPassword && (
              <FieldError>{fieldErrors.confirmPassword}</FieldError>
            )}
          </FieldGroup>

          <FieldGroup>
            Region
            <Select
              value={fields.region}
              onChange={(e) => set('region', e.target.value as 'us' | 'eu')}
              $invalid={!!fieldErrors.region}
            >
              <option value="us">United States (SimpleFIN)</option>
              <option value="eu">Europe (GoCardless)</option>
            </Select>
            {fieldErrors.region && <FieldError>{fieldErrors.region}</FieldError>}
          </FieldGroup>

          <FieldGroup>
            Timezone
            <Select
              value={fields.timezone}
              onChange={(e) => set('timezone', e.target.value)}
              $invalid={!!fieldErrors.timezone}
            >
              {tzOptions.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
            {fieldErrors.timezone && <FieldError>{fieldErrors.timezone}</FieldError>}
          </FieldGroup>

          {serverError && <ErrorBanner>{serverError}</ErrorBanner>}

          <SubmitButton type="submit" disabled={loading} $loading={loading}>
            {loading ? 'Creating account…' : 'Create account'}
          </SubmitButton>
        </Form>

        <FooterNote>
          Already have an account? <Link to="/login">Sign in</Link>
          <br />
          Your data is encrypted and stored only on this device.
        </FooterNote>
      </Card>
    </Page>
  );
}
