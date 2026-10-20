import base from './vite.config.ts';

// The command tests in tests/ run Stryker on fixture repositories, which is too slow to repeat for
// every mutant.
export default {
  ...base,
  test: {
    ...base.test,
    include: ['src/**/*.test.ts'],
  },
};
