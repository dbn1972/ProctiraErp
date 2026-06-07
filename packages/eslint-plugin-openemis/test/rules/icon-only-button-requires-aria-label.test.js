"use strict";

const { RuleTester } = require("eslint");
const rule = require("../../src/rules/icon-only-button-requires-aria-label");

const ruleTester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
});

ruleTester.run("icon-only-button-requires-aria-label", rule, {
  valid: [
    // ── Accessible name via aria-label ────────────────────────────────────
    {
      code: '<Button aria-label="Delete row"><TrashIcon /></Button>',
    },
    {
      code: '<IconButton aria-label="Open menu"><MenuIcon /></IconButton>',
    },
    // aria-labelledby satisfies the rule
    {
      code: '<Button aria-labelledby="lbl-1"><TrashIcon /></Button>',
    },
    // title attribute satisfies the rule
    {
      code: '<Button title="Delete"><TrashIcon /></Button>',
    },
    // Visually-hidden text label as a child satisfies the rule
    {
      code: '<Button><TrashIcon /><span className="sr-only">Delete</span></Button>',
    },
    {
      code: '<IconButton><svg /><span className="visually-hidden">Open menu</span></IconButton>',
    },
    // Buttons with visible text content are not icon-only
    {
      code: "<Button><TrashIcon />Delete</Button>",
    },
    {
      code: "<Button>Delete</Button>",
    },
    // Self-closing button is not icon-only (no children) — no false positive
    {
      code: "<Button />",
    },
    // Non-button components with an icon child are ignored
    {
      code: "<div><TrashIcon /></div>",
    },
    {
      code: "<MyCard><TrashIcon /></MyCard>",
    },
    // aria-label via a JSXExpressionContainer string literal
    {
      code: '<IconButton aria-label={"Close"}><XIcon /></IconButton>',
    },
    // aria-label via a template literal with content
    {
      code:
        "<IconButton aria-label={`Close ${name}`}><XIcon /></IconButton>",
    },
    // aria-label via a t() call (treated as present)
    {
      code:
        "<IconButton aria-label={t('actions.delete')}><TrashIcon /></IconButton>",
    },
    // Element with non-icon JSX child is not icon-only (child has visible text)
    {
      code: "<Button><Spinner />Loading</Button>",
    },
    // Lucide-imported icon flagged via import (ensures import tracking works
    // for renamed imports — but here aria-label is present so it's valid).
    {
      code:
        "import { Trash as Bin } from 'lucide-react';\n" +
        '<IconButton aria-label="Delete"><Bin /></IconButton>',
    },
    // data-icon-only opt-in: a custom component that DOES have a label.
    {
      code:
        '<button data-icon-only aria-label="Close"><XIcon /></button>',
    },
    // Configurable: extra component "Toolbar.Button" with label is valid.
    {
      code: '<Toolbar.Button aria-label="Bold"><BoldIcon /></Toolbar.Button>',
      options: [{ components: ["Toolbar.Button"] }],
    },
  ],

  invalid: [
    // ── Plain icon-only Button ────────────────────────────────────────────
    {
      code: "<Button><TrashIcon /></Button>",
      errors: [{ messageId: "missingAccessibleName" }],
    },
    // IconButton is also covered
    {
      code: "<IconButton><MenuIcon /></IconButton>",
      errors: [{ messageId: "missingAccessibleName" }],
    },
    // Whitespace around the icon should not change the verdict
    {
      code: "<Button>  <TrashIcon />\n</Button>",
      errors: [{ messageId: "missingAccessibleName" }],
    },
    // A bare aria-label boolean attribute (no value) is not enough
    {
      code: "<Button aria-label><TrashIcon /></Button>",
      errors: [{ messageId: "missingAccessibleName" }],
    },
    // Empty-string aria-label is not enough
    {
      code: '<Button aria-label=""><TrashIcon /></Button>',
      errors: [{ messageId: "missingAccessibleName" }],
    },
    // aria-label={undefined} is not enough
    {
      code: "<Button aria-label={undefined}><TrashIcon /></Button>",
      errors: [{ messageId: "missingAccessibleName" }],
    },
    // Self-closing svg child counts as icon
    {
      code: "<Button><svg /></Button>",
      errors: [{ messageId: "missingAccessibleName" }],
    },
    // Lucide-imported icon (not matching `Icon$`) should still be flagged
    // because we tracked the import source.
    {
      code:
        "import { Trash } from 'lucide-react';\n" +
        "<IconButton><Trash /></IconButton>",
      errors: [{ messageId: "missingAccessibleName" }],
    },
    // Heroicons subpath import
    {
      code:
        "import { XMarkIcon } from '@heroicons/react/24/outline';\n" +
        "<Button><XMarkIcon /></Button>",
      errors: [{ messageId: "missingAccessibleName" }],
    },
    // Renamed import from lucide-react still flagged (import tracking)
    {
      code:
        "import { Trash as Bin } from 'lucide-react';\n" +
        "<IconButton><Bin /></IconButton>",
      errors: [{ messageId: "missingAccessibleName" }],
    },
    // data-icon-only opt-in flags a non-Button native element
    {
      code: "<button data-icon-only><XIcon /></button>",
      errors: [{ messageId: "missingAccessibleName" }],
    },
    // Configurable extra component is flagged when no label
    {
      code: "<Toolbar.Button><BoldIcon /></Toolbar.Button>",
      options: [{ components: ["Toolbar.Button"] }],
      errors: [{ messageId: "missingAccessibleName" }],
    },
    // Visually-hidden span with NO text content does not count as a label
    {
      code:
        '<Button><TrashIcon /><span className="sr-only" /></Button>',
      errors: [{ messageId: "missingAccessibleName" }],
    },
    // Fragment of icons is treated as icon-only
    {
      code: "<Button><><TrashIcon /></></Button>",
      errors: [{ messageId: "missingAccessibleName" }],
    },
  ],
});

console.log("✅ icon-only-button-requires-aria-label rule tests passed");
