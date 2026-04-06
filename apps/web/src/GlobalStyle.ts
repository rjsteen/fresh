import { createGlobalStyle } from 'styled-components';

const GlobalStyle = createGlobalStyle`
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  html {
    font-size: 14px;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: optimizeLegibility;
  }

  body {
    font-family: ${({ theme }) => theme.font.family};
    font-size: ${({ theme }) => theme.font.size.base};
    font-weight: ${({ theme }) => theme.font.weight.regular};
    line-height: ${({ theme }) => theme.font.lineHeight.normal};
    color: ${({ theme }) => theme.color.text};
    background-color: ${({ theme }) => theme.color.bg};
  }

  /* Scrollbars — thin and on-brand */
  ::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: ${({ theme }) => theme.color.green200};
    border-radius: ${({ theme }) => theme.radius.full};
  }
  ::-webkit-scrollbar-thumb:hover {
    background: ${({ theme }) => theme.color.green300};
  }

  /* Focus visible ring — keyboard only */
  :focus-visible {
    outline: none;
    box-shadow: ${({ theme }) => theme.shadow.focus};
    border-radius: ${({ theme }) => theme.radius.sm};
  }

  a {
    color: ${({ theme }) => theme.color.green600};
    text-decoration: none;
    transition: ${({ theme }) => theme.transition.fast};

    &:hover {
      color: ${({ theme }) => theme.color.green700};
      text-decoration: underline;
    }
  }

  h1, h2, h3, h4, h5, h6 {
    font-weight: ${({ theme }) => theme.font.weight.semibold};
    line-height: ${({ theme }) => theme.font.lineHeight.tight};
    color: ${({ theme }) => theme.color.text};
  }

  input, textarea, select, button {
    font-family: inherit;
    font-size: inherit;
  }

  button {
    cursor: pointer;
    border: none;
    background: none;
  }

  img, svg {
    display: block;
    max-width: 100%;
  }

  table {
    border-collapse: collapse;
    width: 100%;
  }

  code, pre, kbd {
    font-family: ${({ theme }) => theme.font.mono};
    font-size: 0.9em;
  }
`;

export default GlobalStyle;
