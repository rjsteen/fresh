import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'db/index': 'src/db/index.ts',
    'ml/index': 'src/ml/index.ts',
    'channels/index': 'src/channels/index.ts',
    'budget/index': 'src/budget/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
});
