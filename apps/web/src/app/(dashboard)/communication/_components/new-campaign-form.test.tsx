/**
 * @vitest-environment jsdom
 *
 * PRC-M075: a scoped campaign audience must name its target; a blank grade,
 * hostel or route is a field error, not a silent widening to everyone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

const createCampaignAction = vi.fn();
const previewAudienceAction = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../actions', () => ({
  createCampaignAction: (...args: unknown[]) => createCampaignAction(...args),
  previewAudienceAction: (...args: unknown[]) => previewAudienceAction(...args),
}));

import { audienceTargetError, NewCampaignForm } from './new-campaign-form';

function fd(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.set(k, v);
  return data;
}

describe('audienceTargetError (PRC-M075)', () => {
  it('requires the target for scoped audiences', () => {
    expect(audienceTargetError('grade', fd({ grade: ' ' }))).toMatch(/grade/i);
    expect(audienceTargetError('hostel', fd({}))).toMatch(/hostel/i);
    expect(audienceTargetError('route', fd({}))).toMatch(/route/i);
    expect(audienceTargetError('grade', fd({ grade: '10' }))).toBeNull();
    expect(audienceTargetError('all', fd({}))).toBeNull();
  });
});

describe('NewCampaignForm (PRC-M075)', () => {
  beforeEach(() => {
    createCampaignAction.mockReset();
    previewAudienceAction.mockReset();
  });

  it('blocks scope=grade with a blank grade and creates nothing', async () => {
    render(<NewCampaignForm hostelOptions={[]} routeOptions={[]} />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Notice' } });
    fireEvent.change(screen.getByLabelText(/Audience scope/), { target: { value: 'grade' } });
    await act(async () => {
      fireEvent.submit(screen.getByTestId('communication-campaign-form'));
    });
    expect(screen.getByRole('alert').textContent).toMatch(/grade/i);
    expect(createCampaignAction).not.toHaveBeenCalled();
  });
});
