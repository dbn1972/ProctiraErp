'use client';

/**
 * Create report-card template form.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  Button,
  Input,
  Label,
  Textarea,
} from '@proctira/ui/components';

import {
  createReportCardTemplateAction,
  type ActionState,
} from '../actions';

const DEFAULT_CONTENT = `<article>
  <h1>{{studentName}} — Report Card</h1>
  <p>{{academicPeriod}}</p>
  {{#if includeGradeSummary}}
  <section>{{gradeSummary}}</section>
  {{/if}}
  {{#if includeComments}}
  <section>{{teacherComments}}</section>
  {{/if}}
</article>`;

export function ReportCardTemplateForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [templateContent, setTemplateContent] = useState(DEFAULT_CONTENT);
  const [isDefault, setIsDefault] = useState(false);
  const [includeLogo, setIncludeLogo] = useState(true);
  const [includeGradeSummary, setIncludeGradeSummary] = useState(true);
  const [includeComments, setIncludeComments] = useState(true);
  const [isPending, setIsPending] = useState(false);
  const [state, setState] = useState<ActionState<{ templateId: string }> | null>(
    null,
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsPending(true);
    setState(null);
    try {
      const result = await createReportCardTemplateAction({
        name,
        templateContent,
        isDefault,
        includeLogo,
        includeGradeSummary,
        includeComments,
      });
      setState(result);
      if (result.status === 'success') {
        router.refresh();
        setName('');
        setTemplateContent(DEFAULT_CONTENT);
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="template-name">Name</Label>
        <Input
          id="template-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Primary term report"
          required
          maxLength={255}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="template-content">Template content</Label>
        <Textarea
          id="template-content"
          value={templateContent}
          onChange={(e) => setTemplateContent(e.target.value)}
          rows={8}
          required
          className="font-mono text-xs"
        />
        <p className="text-[11px] text-muted-foreground">
          HTML / Handlebars layout used when generating PDFs.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">Options</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          Set as default template
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeLogo}
            onChange={(e) => setIncludeLogo(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          Include institution logo
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeGradeSummary}
            onChange={(e) => setIncludeGradeSummary(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          Include grade summary
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeComments}
            onChange={(e) => setIncludeComments(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          Include teacher comments
        </label>
      </fieldset>

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
        {isPending ? 'Saving…' : 'Create template'}
      </Button>
    </form>
  );
}
