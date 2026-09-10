'use strict';

const { RuleTester } = require('eslint');
const rule = require('./no-physical-margin-padding');

const ruleTester = new RuleTester({
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
});

ruleTester.run('no-physical-margin-padding', rule, {
  valid: [
    // Logical equivalents are fine
    { code: '<div className="ms-4 me-2 ps-3 pe-1" />' },
    { code: '<div className="text-start text-end" />' },
    { code: '<div className="border-s-2 border-e-4" />' },
    { code: '<div className="start-0 end-0" />' },
    // Non-directional classes are fine
    { code: '<div className="mt-4 mb-2 pt-3 pb-1" />' },
    { code: '<div className="mx-auto my-4" />' },
    { code: '<div className="p-4 m-2" />' },
    { code: '<div className="text-center text-sm text-red-500" />' },
    { code: '<div className="border-2 border-t-4 border-b-0" />' },
    { code: '<div className="top-0 bottom-0" />' },
    // Responsive logical utilities are fine
    { code: '<div className="sm:ms-4 md:me-2 lg:ps-3" />' },
    // Template literals with logical classes
    { code: '<div className={`ms-4 ${active ? "me-2" : "me-0"}`} />' },
    // Function calls with logical classes
    { code: '<div className={cn("ms-4", "pe-2")} />' },
  ],

  invalid: [
    // Basic physical margin-left
    {
      code: '<div className="ml-4" />',
      output: '<div className="ms-4" />',
      errors: [{ messageId: 'physicalClass' }],
    },
    // Basic physical margin-right
    {
      code: '<div className="mr-2" />',
      output: '<div className="me-2" />',
      errors: [{ messageId: 'physicalClass' }],
    },
    // Basic physical padding-left
    {
      code: '<div className="pl-3" />',
      output: '<div className="ps-3" />',
      errors: [{ messageId: 'physicalClass' }],
    },
    // Basic physical padding-right
    {
      code: '<div className="pr-1" />',
      output: '<div className="pe-1" />',
      errors: [{ messageId: 'physicalClass' }],
    },
    // text-left
    {
      code: '<div className="text-left" />',
      output: '<div className="text-start" />',
      errors: [{ messageId: 'physicalClass' }],
    },
    // text-right
    {
      code: '<div className="text-right" />',
      output: '<div className="text-end" />',
      errors: [{ messageId: 'physicalClass' }],
    },
    // left-* positioning
    {
      code: '<div className="left-0" />',
      output: '<div className="start-0" />',
      errors: [{ messageId: 'physicalClass' }],
    },
    // right-* positioning
    {
      code: '<div className="right-4" />',
      output: '<div className="end-4" />',
      errors: [{ messageId: 'physicalClass' }],
    },
    // border-l
    {
      code: '<div className="border-l-2" />',
      output: '<div className="border-s-2" />',
      errors: [{ messageId: 'physicalClass' }],
    },
    // border-r
    {
      code: '<div className="border-r" />',
      output: '<div className="border-e" />',
      errors: [{ messageId: 'physicalClass' }],
    },
    // Multiple physical classes in one string
    {
      code: '<div className="ml-4 pr-2 text-left" />',
      output: '<div className="ms-4 pe-2 text-start" />',
      errors: [
        { messageId: 'physicalClass' },
        { messageId: 'physicalClass' },
        { messageId: 'physicalClass' },
      ],
    },
    // Responsive prefix with physical class
    {
      code: '<div className="sm:ml-4" />',
      output: '<div className="sm:ms-4" />',
      errors: [{ messageId: 'physicalClass' }],
    },
    // Hover state prefix with physical class
    {
      code: '<div className="hover:mr-2" />',
      output: '<div className="hover:me-2" />',
      errors: [{ messageId: 'physicalClass' }],
    },
    // Combined responsive + state prefix
    {
      code: '<div className="md:hover:pl-4" />',
      output: '<div className="md:hover:ps-4" />',
      errors: [{ messageId: 'physicalClass' }],
    },
    // Negative values
    {
      code: '<div className="-ml-2" />',
      output: '<div className="-ms-2" />',
      errors: [{ messageId: 'physicalClass' }],
    },
    // Arbitrary values
    {
      code: '<div className="ml-[10px]" />',
      output: '<div className="ms-[10px]" />',
      errors: [{ messageId: 'physicalClass' }],
    },
    // In cn() function call
    {
      code: '<div className={cn("ml-4", "p-2")} />',
      output: '<div className={cn("ms-4", "p-2")} />',
      errors: [{ messageId: 'physicalClass' }],
    },
    // In template literal
    {
      code: '<div className={`ml-4 p-2`} />',
      output: '<div className={`ms-4 p-2`} />',
      errors: [{ messageId: 'physicalClass' }],
    },
    // In conditional expression
    {
      code: '<div className={active ? "ml-4" : "mr-4"} />',
      output: '<div className={active ? "ms-4" : "me-4"} />',
      errors: [{ messageId: 'physicalClass' }, { messageId: 'physicalClass' }],
    },
  ],
});

console.log('All tests passed!');
