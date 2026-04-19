/**
 * Minimal React Native mock for Vitest + jsdom.
 * Maps RN components to HTML equivalents so React Testing Library can render them.
 */
import React from 'react';

// Strip RN-specific props that are invalid on DOM elements
function domProps({ children: _children, testID, style: _s, numberOfLines: _nl, contentContainerStyle: _ccs, ...rest }: Record<string, unknown>) {
  return { 'data-testid': testID, ...rest };
}

const passThrough =
  (tag: string) =>
  (props: Record<string, unknown>) =>
    React.createElement(tag, domProps(props), props.children as React.ReactNode);

export const View = passThrough('div');
export const Text = passThrough('span');
export const ScrollView = passThrough('div');
export const SafeAreaView = passThrough('div');
export const Pressable = passThrough('button');
export const TouchableOpacity = ({
  children,
  onPress,
  disabled,
  testID,
  style: _s,
  ...rest
}: Record<string, unknown>) => {
  void rest;
  return React.createElement(
    'button',
    { onClick: onPress as React.MouseEventHandler, disabled: disabled as boolean, 'data-testid': testID },
    children as React.ReactNode
  );
};
export const TextInput = ({
  value,
  onChangeText,
  placeholder,
  testID,
  style: _s,
}: Record<string, unknown>) =>
  React.createElement('input', {
    value: value as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      (onChangeText as (v: string) => void)?.(e.target.value),
    placeholder: placeholder as string,
    'data-testid': testID,
  });
export const Modal = ({
  children,
  visible,
}: {
  children: React.ReactNode;
  visible?: boolean;
}) => (visible !== false ? React.createElement('div', null, children) : null);
export const FlatList = ({
  data,
  renderItem,
  keyExtractor,
  ListEmptyComponent,
}: {
  data: unknown[];
  renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
  keyExtractor?: (item: unknown, index: number) => string;
  ListEmptyComponent?: React.ReactNode;
}) => {
  void keyExtractor;
  if (!data || data.length === 0) return React.createElement('div', null, ListEmptyComponent);
  return React.createElement('div', null, data.map((item, index) => renderItem({ item, index })));
};
export const ActivityIndicator = () => React.createElement('div', { 'aria-label': 'loading' });
export const StyleSheet = {
  create: <T extends object>(styles: T) => styles,
  flatten: (style: unknown) => style,
};
export const Alert = {
  alert: (
    _title: string,
    _msg: string,
    buttons?: Array<{ text: string; onPress?: () => void; style?: string }>
  ) => {
    // In tests, auto-confirm by calling the destructive button's onPress
    const destructive = buttons?.find((b) => b.style === 'destructive');
    destructive?.onPress?.();
  },
};
export const Linking = {
  openURL: vi.fn(),
};
export const Platform = { OS: 'ios', select: (o: Record<string, unknown>) => o.ios };
