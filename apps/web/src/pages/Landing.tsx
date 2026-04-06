import React from 'react';
import { Link } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';

const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const Page = styled.div`
  min-height: 100vh;
  background: ${({ theme }) => theme.color.bg};
  display: flex;
  flex-direction: column;
`;

const Nav = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: ${({ theme }) => `${theme.space[5]} ${theme.space[10]}`};
  border-bottom: 1px solid ${({ theme }) => theme.color.border};
`;

const WordMark = styled.span`
  font-size: ${({ theme }) => theme.font.size['2xl']};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  color: ${({ theme }) => theme.color.green600};
  letter-spacing: -0.5px;
`;

const NavActions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space[3]};
  align-items: center;
`;

const NavLink = styled(Link)`
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  color: ${({ theme }) => theme.color.textSub};
  text-decoration: none;

  &:hover {
    color: ${({ theme }) => theme.color.text};
  }
`;

const NavCta = styled(Link)`
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.color.textInvert};
  background: ${({ theme }) => theme.color.green500};
  padding: ${({ theme }) => `${theme.space[2]} ${theme.space[5]}`};
  border-radius: ${({ theme }) => theme.radius.md};
  text-decoration: none;
  transition: ${({ theme }) => theme.transition.fast};

  &:hover {
    background: ${({ theme }) => theme.color.green600};
    box-shadow: ${({ theme }) => theme.shadow.md};
    transform: translateY(-1px);
  }
`;

const Hero = styled.section`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: ${({ theme }) => `${theme.space[24]} ${theme.space[6]}`};
  gap: ${({ theme }) => theme.space[6]};
  animation: ${fadeUp} 0.4s ease both;
`;

const Eyebrow = styled.p`
  font-size: ${({ theme }) => theme.font.size.xs};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.color.green500};
`;

const Headline = styled.h1`
  font-size: clamp(2.5rem, 6vw, 4rem);
  font-weight: ${({ theme }) => theme.font.weight.bold};
  color: ${({ theme }) => theme.color.text};
  letter-spacing: -1.5px;
  line-height: 1.1;
  max-width: 680px;
`;

const Sub = styled.p`
  font-size: ${({ theme }) => theme.font.size.lg};
  color: ${({ theme }) => theme.color.textMuted};
  max-width: 520px;
  line-height: ${({ theme }) => theme.font.lineHeight.relaxed};
`;

const Actions = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space[3]};
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
`;

const PrimaryButton = styled(Link)`
  font-size: ${({ theme }) => theme.font.size.base};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.color.textInvert};
  background: ${({ theme }) => theme.color.green500};
  padding: ${({ theme }) => `${theme.space[3]} ${theme.space[7]}`};
  border-radius: ${({ theme }) => theme.radius.md};
  text-decoration: none;
  transition: ${({ theme }) => theme.transition.fast};

  &:hover {
    background: ${({ theme }) => theme.color.green600};
    box-shadow: ${({ theme }) => theme.shadow.lg};
    transform: translateY(-1px);
  }
`;

const SecondaryButton = styled(Link)`
  font-size: ${({ theme }) => theme.font.size.base};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  color: ${({ theme }) => theme.color.textSub};
  text-decoration: none;
  padding: ${({ theme }) => `${theme.space[3]} ${theme.space[5]}`};

  &:hover {
    color: ${({ theme }) => theme.color.text};
  }
`;

const Features = styled.section`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: ${({ theme }) => theme.space[4]};
  max-width: 860px;
  width: 100%;
  margin: 0 auto;
  padding: 0 ${({ theme }) => theme.space[6]} ${({ theme }) => theme.space[20]};
`;

const FeatureCard = styled.div`
  background: ${({ theme }) => theme.color.surface};
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.xl};
  padding: ${({ theme }) => theme.space[6]};
`;

const FeatureTitle = styled.h3`
  font-size: ${({ theme }) => theme.font.size.base};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.color.text};
  margin-bottom: ${({ theme }) => theme.space[2]};
`;

const FeatureDesc = styled.p`
  font-size: ${({ theme }) => theme.font.size.sm};
  color: ${({ theme }) => theme.color.textMuted};
  line-height: ${({ theme }) => theme.font.lineHeight.relaxed};
`;

const FEATURES = [
  {
    title: 'Zero server data',
    desc: 'Your transactions never leave your device. The server only stores sync schedules and model versions.',
  },
  {
    title: 'On-device AI',
    desc: 'Transaction categorization and anomaly detection run locally via ONNX — no data sent to train.',
  },
  {
    title: 'US & EU banks',
    desc: 'Connect US accounts via SimpleFIN and European accounts via GoCardless Bank Account Data.',
  },
  {
    title: 'Encrypted at rest',
    desc: 'Your local database is encrypted with AES-256 using a key that never leaves your device.',
  },
];

export function Landing() {
  return (
    <Page>
      <Nav>
        <WordMark>Fresh</WordMark>
        <NavActions>
          <NavLink to="/login">Sign in</NavLink>
          <NavCta to="/signup">Get started</NavCta>
        </NavActions>
      </Nav>

      <Hero>
        <Eyebrow>Privacy-first finance</Eyebrow>
        <Headline>Your money, on your device.</Headline>
        <Sub>
          Fresh connects to your bank accounts and keeps everything local. No transaction
          data ever reaches our servers.
        </Sub>
        <Actions>
          <PrimaryButton to="/signup">Get started</PrimaryButton>
          <SecondaryButton to="/login">Sign in →</SecondaryButton>
        </Actions>
      </Hero>

      <Features>
        {FEATURES.map((f) => (
          <FeatureCard key={f.title}>
            <FeatureTitle>{f.title}</FeatureTitle>
            <FeatureDesc>{f.desc}</FeatureDesc>
          </FeatureCard>
        ))}
      </Features>
    </Page>
  );
}
