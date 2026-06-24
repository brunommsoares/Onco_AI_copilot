module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
  },
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  ignorePatterns: [
    'node_modules/',
    'logs/',
    'tmp_server*.log'
  ],
  rules: {
    'no-undef': 'error',
    'no-unreachable': 'error',
    'no-unused-vars': ['warn', {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_'
    }]
  }
};
