import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { describe, expect, it } from 'vitest';

import tailwindConfig from '../../tailwind.config';

describe('shared Button CSS generation', () => {
  it('emits every selector required by the accent variant', async () => {
    const result = await postcss([tailwindcss(tailwindConfig)]).process('@tailwind utilities;', {
      from: undefined,
    });
    const selectors = new Set<string>();
    result.root.walkRules((rule) => {
      for (const selector of rule.selectors) selectors.add(selector);
    });

    expect(selectors).toContain('.bg-\\[hsl\\(var\\(--accent\\)\\)\\]');
    expect(selectors).toContain('.text-\\[hsl\\(var\\(--accent-foreground\\)\\)\\]');
    expect(selectors).toContain('.hover\\:bg-\\[hsl\\(var\\(--accent\\)\\)\\]\\/90:hover');
    // Tailwind JIT scans the app + packages/ui source tree: ~0.5s locally but
    // >5s under the parallel turbo Unit Tests job, so the default timeout flakes.
  }, 60_000);
});
