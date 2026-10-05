/**
 * @vitest-environment jsdom
 *
 * PRC-M106 — moderation action failures are announced; a successful reply
 * clears the textarea.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  createDiscussionAction: vi.fn(),
  createDiscussionPostAction: vi.fn(),
  hidePostAction: vi.fn(),
  lockDiscussionAction: vi.fn(),
  pinPostAction: vi.fn(),
}));
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('../depth-actions', () => actions);

import { DiscussionModeration } from './discussion-forms';

const posts = [{ id: 'p1', body: 'Hello', hidden: false, pinned: false }];

describe('DiscussionModeration (PRC-M106)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('announces a failed lock and does not refresh', async () => {
    actions.lockDiscussionAction.mockResolvedValue({ status: 'error', message: 'Forbidden' });
    render(<DiscussionModeration threadId="t1" locked={false} posts={posts} />);
    fireEvent.click(screen.getByRole('button', { name: 'Lock thread' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Forbidden'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([
    ['Pin', 'pinPostAction'],
    ['Hide', 'hidePostAction'],
  ] as const)('announces a failed %s', async (label, fn) => {
    actions[fn].mockResolvedValue({ status: 'error', message: `${label} failed` });
    render(<DiscussionModeration threadId="t1" locked={false} posts={posts} />);
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(`${label} failed`));
  });

  it('clears the reply on success and keeps it on failure', async () => {
    actions.createDiscussionPostAction.mockResolvedValueOnce({
      status: 'error',
      message: 'Thread is locked',
    });
    render(<DiscussionModeration threadId="t1" locked={false} posts={posts} />);
    const box = screen.getByLabelText('Reply') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'My reply' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Thread is locked'));
    expect(box.value).toBe('My reply');

    actions.createDiscussionPostAction.mockResolvedValueOnce({ status: 'success', id: 'p2' });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Reply posted.'));
    expect(box.value).toBe('');
    expect(refresh).toHaveBeenCalled();
  });
});
