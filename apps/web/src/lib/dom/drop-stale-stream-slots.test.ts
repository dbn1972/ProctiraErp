/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';

import { DROP_STALE_STREAM_SLOTS_SCRIPT } from './drop-stale-stream-slots';

function install() {
  window.eval(DROP_STALE_STREAM_SLOTS_SCRIPT);
}

describe('drop stale Next stream slots', () => {
  it('removes a hidden S: slot once the same test id is visible', () => {
    document.body.innerHTML = `
      <div hidden id="S:0">
        <a data-testid="open-structures" href="/fees/structures">Manage structures</a>
      </div>
      <main>
        <a data-testid="open-structures" href="/fees/structures">Manage structures</a>
      </main>
    `;

    install();

    expect(document.getElementById('S:0')).toBeNull();
    expect(document.querySelectorAll('[data-testid="open-structures"]')).toHaveLength(1);
    expect(document.querySelector('main [data-testid="open-structures"]')).not.toBeNull();
  });

  it('keeps a slot while only some of its test ids have been revealed', () => {
    document.body.innerHTML = `
      <div hidden id="S:3">
        <a data-testid="open-structures" href="/fees/structures">Manage structures</a>
        <a data-testid="open-reports" href="/fees/reports">Open reports</a>
      </div>
      <main>
        <a data-testid="open-structures" href="/fees/structures">Manage structures</a>
      </main>
    `;

    install();

    expect(document.getElementById('S:3')).not.toBeNull();
    expect(document.querySelectorAll('[data-testid="open-reports"]')).toHaveLength(1);
  });

  it('keeps an in-flight slot that is still the only copy', () => {
    document.body.innerHTML = `
      <div hidden id="S:1">
        <div data-testid="scaffold-mode-banner">Scaffold</div>
      </div>
    `;

    install();

    expect(document.getElementById('S:1')).not.toBeNull();
    expect(document.querySelectorAll('[data-testid="scaffold-mode-banner"]')).toHaveLength(1);
  });

  it('drops a slot inserted after the cleaner is installed', async () => {
    document.body.innerHTML = `<main><div data-testid="scaffold-mode-banner">Scaffold</div></main>`;
    install();

    const slot = document.createElement('div');
    slot.hidden = true;
    slot.id = 'S:2';
    slot.innerHTML = `<div data-testid="scaffold-mode-banner">Scaffold</div>`;
    document.body.appendChild(slot);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.getElementById('S:2')).toBeNull();
    expect(document.querySelectorAll('[data-testid="scaffold-mode-banner"]')).toHaveLength(1);
  });
});
