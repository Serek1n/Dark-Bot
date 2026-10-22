const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'data/**', 'web/public/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-useless-escape': 'off',
      'no-control-regex': 'off',
      'no-prototype-builtins': 'off',
      'no-async-promise-executor': 'off'
    }
  },
  // the word filter deliberately matches invisible and combining characters
  { files: ['bot/utils/profanity.js'], rules: { 'no-irregular-whitespace': 'off', 'no-misleading-character-class': 'off' } },
  { files: ['test_harness/**'], rules: { 'no-unused-vars': 'off', 'no-undef': 'off' } }
];
