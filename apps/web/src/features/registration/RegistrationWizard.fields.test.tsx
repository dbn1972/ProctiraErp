/**
 * @vitest-environment jsdom
 *
 * PRC-L071 — the optional schema fields nationalId, addressLine2 and
 * postalCode have inputs and their values land in the wizard draft.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LiveRegion } from '@proctira/ui-components';
import { RegistrationWizard } from './RegistrationWizard';

function type(testId: string, value: string) {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('<RegistrationWizard /> optional identity and address fields', () => {
  it('captures nationalId, addressLine2 and postalCode in the draft', () => {
    render(
      <>
        <LiveRegion />
        <RegistrationWizard />
      </>,
    );
    expect(screen.getByLabelText('National ID (optional)')).toBeInTheDocument();
    type('firstName', 'Asha');
    type('lastName', 'Rao');
    type('dateOfBirth', '2015-04-01');
    type('nationalId', 'NID-12345');
    fireEvent.click(screen.getByTestId('next-button'));

    expect(screen.getByTestId('step-contact')).toBeInTheDocument();
    type('guardianFirstName', 'Ravi');
    type('guardianLastName', 'Rao');
    type('guardianRelationship', 'Father');
    type('phone', '+91 98765 43210');
    type('email', 'guardian@example.com');
    type('addressLine1', '12 Main Road');
    type('addressLine2', 'Flat 4B');
    type('city', 'Pune');
    type('postalCode', '411001');
    type('country', 'India');
    fireEvent.click(screen.getByTestId('next-button'));
    expect(screen.getByTestId('step-pane-school-selection')).toBeInTheDocument();

    // Back through the steps: values are re-read from the wizard draft.
    fireEvent.click(screen.getByTestId('back-button'));
    expect(screen.getByTestId('addressLine2')).toHaveValue('Flat 4B');
    expect(screen.getByTestId('postalCode')).toHaveValue('411001');
    expect(screen.getByLabelText('Postal code (optional)')).toHaveAttribute(
      'autocomplete',
      'postal-code',
    );
    fireEvent.click(screen.getByTestId('back-button'));
    expect(screen.getByTestId('nationalId')).toHaveValue('NID-12345');
  });
});
