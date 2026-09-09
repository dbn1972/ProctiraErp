'use client';

import { useHydrated } from '@/hooks/useHydrated';
import { Button, FormField, Input } from '@proctira/ui/components';

export function OpacSearchForm({ defaultQuery }: { defaultQuery: string }) {
  const hydrated = useHydrated();

  return (
    <form
      method="get"
      className="flex flex-wrap items-end gap-3"
      aria-label="Search the library catalogue"
      data-testid="library-opac-form"
      data-hydrated={hydrated ? 'true' : 'false'}
    >
      <FormField id="opac-q" label="Search">
        <Input
          id="opac-q"
          name="q"
          defaultValue={defaultQuery}
          className="h-11 min-h-11 w-full min-w-[16rem]"
          data-testid="library-opac-query"
        />
      </FormField>
      <Button type="submit" className="min-h-11" data-testid="library-opac-submit">
        Search
      </Button>
    </form>
  );
}
