'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
} from '@proctira/ui/components';
import { useHydrated } from '@/hooks/useHydrated';

import {
  addMessMenuAction,
  createMessPlanAction,
  subscribeMessAction,
} from '../../campus-ops-actions';
import type { Hostel, HostelMessPlan } from '@/lib/api/hostel';

const MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function MessOpsForms({
  hostels,
  plans,
}: {
  hostels: Hostel[];
  plans: HostelMessPlan[];
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onCreatePlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const hostelId = String(fd.get('hostelId') ?? '').trim();
    const name = String(fd.get('name') ?? '').trim();
    const mealCountRaw = String(fd.get('mealCount') ?? '').trim();
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await createMessPlanAction({
        hostelId,
        name,
        mealCount: mealCountRaw ? Number(mealCountRaw) : undefined,
      });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to create plan');
        return;
      }
      setMessage(result.message ?? 'Plan created.');
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  function onAddMenu(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const planId = String(fd.get('planId') ?? '').trim();
    const weekday = Number(fd.get('weekday'));
    const meal = String(fd.get('meal') ?? '') as (typeof MEALS)[number];
    const itemName = String(fd.get('itemName') ?? '').trim();
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await addMessMenuAction({ planId, weekday, meal, itemName });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to add menu item');
        return;
      }
      setMessage(result.message ?? 'Menu item added.');
      (event.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  function onSubscribe(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const planId = String(fd.get('planId') ?? '').trim();
    const studentId = String(fd.get('studentId') ?? '').trim();
    const startDate = String(fd.get('startDate') ?? '').trim();
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const result = await subscribeMessAction({ planId, studentId, startDate });
      if (result.status === 'error') {
        setError(result.message ?? 'Failed to subscribe');
        return;
      }
      setMessage(result.message ?? 'Subscribed.');
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New mess plan</CardTitle>
          <CardDescription>Plan × meals for a hostel.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            noValidate
            onSubmit={onCreatePlan}
            aria-label="Create mess plan"
            data-testid="hostel-mess-plan-form"
            data-hydrated={hydrated ? 'true' : 'false'}
          >
            <FormField id="mess-hostel" label="Hostel" required>
              <select
                id="mess-hostel"
                name="hostelId"
                className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue=""
              >
                <option value="" disabled>
                  Select hostel…
                </option>
                {hostels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} ({h.code})
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="mess-name" label="Plan name" required>
              <Input id="mess-name" name="name" className="h-11 min-h-11" />
            </FormField>
            <FormField id="mess-meals" label="Meals per day">
              <Input
                id="mess-meals"
                name="mealCount"
                type="number"
                min="1"
                max="6"
                defaultValue={3}
                className="h-11 min-h-11"
              />
            </FormField>
            <Button type="submit" disabled={pending} className="min-h-11">
              {pending ? 'Saving…' : 'Create plan'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Weekly menu item</CardTitle>
          <CardDescription>One dish for a weekday meal.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            noValidate
            onSubmit={onAddMenu}
            aria-label="Add mess menu item"
            data-testid="hostel-mess-menu-form"
            data-hydrated={hydrated ? 'true' : 'false'}
          >
            <FormField id="menu-plan" label="Plan" required>
              <select
                id="menu-plan"
                name="planId"
                className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue=""
              >
                <option value="" disabled>
                  Select plan…
                </option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="menu-day" label="Weekday" required>
              <select
                id="menu-day"
                name="weekday"
                className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue="1"
              >
                {WEEKDAYS.map((label, index) => (
                  <option key={label} value={index}>
                    {label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="menu-meal" label="Meal" required>
              <select
                id="menu-meal"
                name="meal"
                className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue="lunch"
              >
                {MEALS.map((meal) => (
                  <option key={meal} value={meal}>
                    {meal}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="menu-item" label="Dish" required>
              <Input id="menu-item" name="itemName" className="h-11 min-h-11" />
            </FormField>
            <Button type="submit" disabled={pending} className="min-h-11">
              {pending ? 'Saving…' : 'Add menu item'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Subscribe resident</CardTitle>
          <CardDescription>Link a student to a mess plan.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 md:grid-cols-3"
            noValidate
            onSubmit={onSubscribe}
            aria-label="Subscribe student to mess"
            data-testid="hostel-mess-subscribe-form"
            data-hydrated={hydrated ? 'true' : 'false'}
          >
            <FormField id="sub-plan" label="Plan" required>
              <select
                id="sub-plan"
                name="planId"
                className="flex h-11 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                defaultValue=""
              >
                <option value="" disabled>
                  Select plan…
                </option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField id="sub-student" label="Student UUID" required>
              <Input id="sub-student" name="studentId" className="h-11 min-h-11" />
            </FormField>
            <FormField id="sub-start" label="Start date" required>
              <Input id="sub-start" name="startDate" type="date" className="h-11 min-h-11" />
            </FormField>
            <div className="md:col-span-3">
              <Button type="submit" disabled={pending} className="min-h-11">
                {pending ? 'Saving…' : 'Subscribe'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {error ? (
        <p className="text-sm text-destructive lg:col-span-2" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="text-sm text-muted-foreground lg:col-span-2" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
