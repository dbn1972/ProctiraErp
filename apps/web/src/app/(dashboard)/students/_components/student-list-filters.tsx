'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, RefreshCw } from 'lucide-react';

import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@proctira/ui/components';

interface StudentListFiltersProps {
  filterOptions: {
    institutions: { id: string; name: string }[];
    grades: { id: string; name: string }[];
  };
  initialValues: {
    search: string;
    institutionId: string;
    gradeId: string;
    status: string;
  };
}

// Status is now handled by StudentStatusTabs — not shown here.

/** Client component that synchronizes filters with the URL query string. */
export function StudentListFilters({
  filterOptions,
  initialValues,
}: StudentListFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== 'ALL' && value !== '') {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    // Reset pagination on any filter change.
    if (key !== 'page') params.delete('page');
    startTransition(() => {
      router.replace(`/students?${params.toString()}`);
    });
  }

  function onSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setParam('search', String(formData.get('search') ?? '').trim());
  }

  function onReset() {
    startTransition(() => {
      router.replace('/students');
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        onSubmit={onSearchSubmit}
        role="search"
        className="min-w-[220px] flex-1"
      >
        <Label htmlFor="student-search" className="sr-only">
          Search students
        </Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="student-search"
            name="search"
            type="search"
            defaultValue={initialValues.search}
            placeholder="Search by name, national ID, or admission no."
            className="ps-8"
          />
        </div>
      </form>

      <FilterSelect
        id="filter-institution"
        label="All institutions"
        value={initialValues.institutionId || 'ALL'}
        onChange={(value) => setParam('institutionId', value)}
        options={[
          { value: 'ALL', label: 'All institutions' },
          ...filterOptions.institutions.map((i) => ({ value: i.id, label: i.name })),
        ]}
      />

      <FilterSelect
        id="filter-grade"
        label="All grades"
        value={initialValues.gradeId || 'ALL'}
        onChange={(value) => setParam('gradeId', value)}
        options={[
          { value: 'ALL', label: 'All grades' },
          ...filterOptions.grades.map((g) => ({ value: g.id, label: g.name })),
        ]}
      />

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onReset}
        disabled={isPending}
        className="ms-auto shrink-0"
      >
        <RefreshCw className="me-1.5 h-3.5 w-3.5" aria-hidden="true" />
        Reset
      </Button>
    </div>
  );
}

interface FilterSelectProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}

function FilterSelect({ id, label, value, onChange, options }: FilterSelectProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label={label} className="w-[180px]">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
