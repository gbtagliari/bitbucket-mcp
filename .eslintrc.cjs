module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: 2020, sourceType: "module" },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  env: { node: true, es2020: true },
  rules: {
    // The codebase types Bitbucket payloads as `any` throughout.
    "@typescript-eslint/no-explicit-any": "off",
    // Pre-existing unused variables; reported without failing the run.
    "@typescript-eslint/no-unused-vars": "warn",
  },
  ignorePatterns: ["dist/", "node_modules/"],
};
