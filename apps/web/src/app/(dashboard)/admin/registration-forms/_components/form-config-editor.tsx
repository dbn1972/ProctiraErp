'use client';

/**
 * Upsert registration form configuration (JSON fields editor).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  Button,
  Input,
  Label,
  Textarea,
} from '@proctira/ui/components';
import type { FormConfiguration } from '@/lib/api/form-configurations';

import {
  upsertFormConfigurationAction,
  type ActionState,
} from '../actions';

const SAMPLE_FIELDS = `[
  {
    "id": "previousSchool",
    "label": "Previous school",
    "type": "text",
    "required": false
  },
  {
    "id": "specialNeeds",
    "label": "Special needs notes",
    "type": "textarea",
    "required": false
  }
]`;

interface FormConfigEditorProps {
  initial?: FormConfiguration | null;
}

export function FormConfigEditor({ initial }: FormConfigEditorProps) {
  const router = useRouter();
  const [institutionTypeId, setInstitutionTypeId] = useState(
    initial?.institutionTypeId ?? '',
  );
  const [fieldsJson, setFieldsJson] = useState(
    initial?.fields
      ? JSON.stringify(initial.fields, null, 2)
      : SAMPLE_FIELDS,
  );
  const [isPending, setIsPending] = useState(false);
  const [state, setState] = useState<ActionState<FormConfiguration> | null>(
    null,
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsPending(true);
    setState(null);
    try {
      const result = await upsertFormConfigurationAction({
        institutionTypeId,
        fieldsJson,
      });
      setState(result);
      if (result.status === 'success') {
        router.refresh();
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="institutionTypeId">Institution type ID</Label>
        <Input
          id="institutionTypeId"
          value={institutionTypeId}
          onChange={(e) => setInstitutionTypeId(e.target.value)}
          placeholder="Institution type UUID or code"
          required
          className="font-mono text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="fieldsJson">Fields (JSON)</Label>
        <Textarea
          id="fieldsJson"
          value={fieldsJson}
          onChange={(e) => setFieldsJson(e.target.value)}
          rows={12}
          required
          className="font-mono text-xs"
        />
        <p className="text-[11px] text-muted-foreground">
          Each field needs{' '}
          <code className="text-[10px]">id</code>,{' '}
          <code className="text-[10px]">label</code>,{' '}
          <code className="text-[10px]">type</code>, and{' '}
          <code className="text-[10px]">required</code>. Types: text, number,
          date, select, checkbox, textarea, file.
        </p>
      </div>

      {state?.status === 'error' ? (
        <p className="text-sm text-destructive" role="alert">
          {state.message}
        </p>
      ) : null}
      {state?.status === 'success' ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          {state.message}
        </p>
      ) : null}

      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? 'Saving…' : 'Save configuration'}
      </Button>
    </form>
  );
}
