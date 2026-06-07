"use strict";

const noPhysicalMarginPadding = require("./rules/no-physical-margin-padding");
const errorEnvelope = require("./rules/error-envelope");
const noHardcodedI18nMessage = require("./rules/no-hardcoded-i18n-message");
const imgRequiresDimensions = require("./rules/img-requires-dimensions");
const iconOnlyButtonRequiresAriaLabel = require("./rules/icon-only-button-requires-aria-label");
const noHardcodedBrandStrings = require("./rules/no-hardcoded-brand-strings");

module.exports = {
  rules: {
    "no-physical-margin-padding": noPhysicalMarginPadding,
    "error-envelope": errorEnvelope,
    "no-hardcoded-i18n-message": noHardcodedI18nMessage,
    "img-requires-dimensions": imgRequiresDimensions,
    "icon-only-button-requires-aria-label": iconOnlyButtonRequiresAriaLabel,
    "no-hardcoded-brand-strings": noHardcodedBrandStrings,
  },
  configs: {
    recommended: {
      plugins: ["proctira"],
      rules: {
        "proctira/no-physical-margin-padding": "warn",
        "proctira/img-requires-dimensions": [
          "warn",
          { allowAriaHiddenDecorative: true },
        ],
        "proctira/icon-only-button-requires-aria-label": "error",
        "proctira/no-hardcoded-brand-strings": "warn",
      },
    },
    accessibility: {
      plugins: ["proctira"],
      rules: {
        "proctira/icon-only-button-requires-aria-label": "error",
        "proctira/img-requires-dimensions": [
          "warn",
          { allowAriaHiddenDecorative: true },
        ],
      },
    },
    "dod-backend": {
      plugins: ["proctira"],
      rules: {
        "proctira/error-envelope": "error",
        "proctira/no-hardcoded-i18n-message": "warn",
      },
    },
    "brand-neutrality": {
      plugins: ["proctira"],
      rules: {
        "proctira/no-hardcoded-brand-strings": "error",
      },
    },
  },
};
