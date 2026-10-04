// CommonJS so `tsconfigRootDir` can anchor `project` to this package; a bare
// relative path resolves against the process cwd and breaks root-level eslint.
module.exports = {
  extends: '../../../.eslintrc.json',
  // This config file is not part of the package tsconfig; skip typed linting of it.
  ignorePatterns: ['/.eslintrc.cjs'],
  parserOptions: {
    project: './tsconfig.eslint.json',
    tsconfigRootDir: __dirname,
  },
};
