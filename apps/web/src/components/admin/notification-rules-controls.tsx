'use client';

/**
 * G-1002 — interactive controls for notification rules admin.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2 } from 'lucide-react';

import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';
import {
  createNotificationRuleAction,
  deleteNotificationRuleAction,
  toggleNotificationRuleAction,
  type NotificationRulesActionState,
} from '@/app/(dashboard)/admin/notification-rules-actions';
import type {
  NotificationChannel,
  NotificationRule,
  NotificationRuleEvent,
  NotificationTemplate,
} from '@/lib/api/notifications-rules.server';

const EVENTS: NotificationRuleEvent[] = ['create', 'update', 'delete', 'threshold', 'schedule'];
const CHANNELS: NotificationChannel[] = ['email', 'in_app', 'push', 'webhook', 'sms'];

function Feedback({ state }: { state: NotificationRulesActionState | null }) {
  if (!state || state.status === 'idle') return null;
  return (
    <p
      role={state.status === 'error' ? 'alert' : 'status'}
      className={state.status === 'error' ? 'text-sm text-destructive' : 'text-sm text-emerald-700'}
    >
      {state.message}
    </p>
  );
}

export function CreateNotificationRuleDialog({ templates }: { templates: NotificationTemplate[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<NotificationRulesActionState | null>(null);
  const [name, setName] = useState('');
  const [entityType, setEntityType] = useState('student');
  const [event, setEvent] = useState<NotificationRuleEvent>('create');
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [channels, setChannels] = useState<NotificationChannel[]>(['in_app']);

  const toggleChannel = (channel: NotificationChannel, checked: boolean) => {
    setChannels((prev) => (checked ? [...prev, channel] : prev.filter((c) => c !== channel)));
  };

  const reset = () => {
    setName('');
    setEntityType('student');
    setEvent('create');
    setTemplateId(templates[0]?.id ?? '');
    setChannels(['in_app']);
    setFeedback(null);
  };

  const handleCreate = () => {
    startTransition(async () => {
      const result = await createNotificationRuleAction({
        name,
        entityType,
        event,
        templateId,
        channels,
        isActive: true,
      });
      setFeedback(result);
      if (result.status === 'success') {
        setOpen(false);
        reset();
        router.refresh();
      }
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[44px]"
        data-testid="create-notification-rule"
      >
        <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
        New rule
      </Button>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create notification rule</DialogTitle>
          <DialogDescription>
            Rules fire when an entity event matches. Emergency comms bypass quiet hours.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rule-name">Name</Label>
            <Input
              id="rule-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Student enrollment alert"
              data-testid="rule-name-input"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rule-entity">Entity type</Label>
            <Input
              id="rule-entity"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              placeholder="student"
              data-testid="rule-entity-input"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rule-event">Event</Label>
            <Select value={event} onValueChange={(v) => setEvent(v as NotificationRuleEvent)}>
              <SelectTrigger id="rule-event" data-testid="rule-event-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVENTS.map((ev) => (
                  <SelectItem key={ev} value={ev}>
                    {ev}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rule-template">Template</Label>
            {templates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No templates yet. Create one via the API first.
              </p>
            ) : (
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger id="rule-template" data-testid="rule-template-select">
                  <SelectValue placeholder="Choose template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} ({t.channel})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Channels</legend>
            {CHANNELS.map((channel) => (
              <label key={channel} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={channels.includes(channel)}
                  onCheckedChange={(checked) => toggleChannel(channel, checked === true)}
                  data-testid={`rule-channel-${channel}`}
                />
                {channel.replace('_', ' ')}
              </label>
            ))}
          </fieldset>
          <Feedback state={feedback} />
        </div>
        <DialogFooter>
          <Button
            type="button"
            onClick={handleCreate}
            disabled={pending || templates.length === 0 || channels.length === 0}
            className="min-h-[44px]"
            data-testid="rule-create-submit"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RuleRowActions({ rule }: { rule: NotificationRule }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<NotificationRulesActionState | null>(null);

  const handleToggle = (checked: boolean) => {
    startTransition(async () => {
      const result = await toggleNotificationRuleAction(rule.id, checked);
      setFeedback(result);
      if (result.status === 'success') router.refresh();
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteNotificationRuleAction(rule.id);
      setFeedback(result);
      if (result.status === 'success') router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Switch
          checked={rule.isActive}
          onCheckedChange={handleToggle}
          disabled={pending}
          aria-label={`${rule.isActive ? 'Pause' : 'Activate'} ${rule.name}`}
          data-testid={`rule-toggle-${rule.id}`}
          className="min-h-[24px] min-w-[44px]"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleDelete}
          disabled={pending}
          aria-label={`Delete ${rule.name}`}
          data-testid={`rule-delete-${rule.id}`}
          className="min-h-[44px] min-w-[44px]"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <Feedback state={feedback} />
    </div>
  );
}

export function NotificationRulesTable({ rules }: { rules: NotificationRule[] }) {
  if (rules.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground" role="status">
        No rules yet. Create your first event-driven delivery rule.
      </p>
    );
  }

  return (
    <Table aria-label="Notification rules">
      <TableHeader>
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableHead className="font-semibold">Rule</TableHead>
          <TableHead className="font-semibold">Trigger</TableHead>
          <TableHead className="font-semibold">Channels</TableHead>
          <TableHead className="text-end font-semibold">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rules.map((rule) => (
          <TableRow key={rule.id} data-testid="notification-rule-row">
            <TableCell>
              <p className="font-medium">{rule.name}</p>
              <p className="text-xs text-muted-foreground">{rule.isActive ? 'Active' : 'Paused'}</p>
            </TableCell>
            <TableCell className="text-sm">
              {rule.entityType} · {rule.event}
            </TableCell>
            <TableCell className="text-sm">{rule.channels.join(', ')}</TableCell>
            <TableCell className="text-end">
              <RuleRowActions rule={rule} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
