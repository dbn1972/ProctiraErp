"use strict";

const { RuleTester } = require("eslint");
const rule = require("./img-requires-dimensions");

const ruleTester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
});

ruleTester.run("img-requires-dimensions", rule, {
  valid: [
    // Explicit width/height + loading="lazy".
    {
      code: '<img src="/a.png" alt="A" width={64} height={64} loading="lazy" />',
    },
    // String dimensions also allowed.
    {
      code: '<img src="/a.png" alt="A" width="64" height="64" loading="lazy" />',
    },
    // Hero images can omit `loading`.
    {
      code: '<img src="/a.png" alt="A" width={1200} height={600} priority />',
    },
    {
      code: '<img src="/a.png" alt="A" width={1200} height={600} fetchpriority="high" />',
    },
    {
      code: '<img src="/a.png" alt="A" width={1200} height={600} data-hero />',
    },
    // Style object covers both width and height.
    {
      code: '<img src="/a.png" alt="A" style={{ width: 100, height: 100 }} loading="lazy" />',
    },
    // aria-hidden decorative images may skip both checks (default option).
    { code: '<img src="/spacer.png" aria-hidden />' },
    { code: '<img src="/spacer.png" aria-hidden="true" />' },
    // Spread attributes: cannot statically verify, so skip.
    { code: '<img src="/a.png" alt="A" {...rest} />' },
    // Custom <Img> wrapper element works the same.
    {
      code: '<Img src="/a.png" alt="A" width={64} height={64} loading="lazy" />',
    },
    // Eager loading is still an explicit choice.
    {
      code: '<img src="/a.png" alt="A" width={64} height={64} loading="eager" />',
    },
    // Non-img JSX elements are ignored.
    { code: '<div width={64} height={64} />' },
    { code: '<picture><source srcSet="/a.webp" /></picture>' },
  ],

  invalid: [
    // Missing both dimensions and loading.
    {
      code: '<img src="/a.png" alt="A" />',
      errors: [
        { messageId: "missingWidth" },
        { messageId: "missingHeight" },
        { messageId: "missingLoading" },
      ],
    },
    // Missing height only.
    {
      code: '<img src="/a.png" alt="A" width={64} loading="lazy" />',
      errors: [{ messageId: "missingHeight" }],
    },
    // Missing width only.
    {
      code: '<img src="/a.png" alt="A" height={64} loading="lazy" />',
      errors: [{ messageId: "missingWidth" }],
    },
    // Missing loading on a non-hero image.
    {
      code: '<img src="/a.png" alt="A" width={64} height={64} />',
      errors: [{ messageId: "missingLoading" }],
    },
    // Empty string width/height counts as missing.
    {
      code: '<img src="/a.png" alt="A" width="" height="" loading="lazy" />',
      errors: [
        { messageId: "missingWidth" },
        { messageId: "missingHeight" },
      ],
    },
    // Style object missing height should still fail height + loading.
    {
      code: '<img src="/a.png" alt="A" style={{ width: 100 }} />',
      errors: [
        { messageId: "missingHeight" },
        { messageId: "missingLoading" },
      ],
    },
    // Custom element <Img>.
    {
      code: '<Img src="/a.png" alt="A" />',
      errors: [
        { messageId: "missingWidth" },
        { messageId: "missingHeight" },
        { messageId: "missingLoading" },
      ],
    },
    // aria-hidden allowance disabled by config.
    {
      code: '<img src="/spacer.png" aria-hidden />',
      options: [{ allowAriaHiddenDecorative: false }],
      errors: [
        { messageId: "missingWidth" },
        { messageId: "missingHeight" },
        { messageId: "missingLoading" },
      ],
    },
    // fetchpriority that isn't "high" still requires loading.
    {
      code: '<img src="/a.png" alt="A" width={64} height={64} fetchpriority="low" />',
      errors: [{ messageId: "missingLoading" }],
    },
  ],
});

console.log("All tests passed!");
