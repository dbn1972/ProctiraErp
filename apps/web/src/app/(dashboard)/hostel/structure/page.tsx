/**
 * Hostel structure — blocks, rooms, beds (Server Component).
 */
import Link from 'next/link';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listHostelBeds, listHostelBlocks, listHostelRooms, listHostels } from '@/lib/api/hostel';
import { NewBedForm, NewBlockForm, NewRoomForm } from '../_components/structure-forms';

export const dynamic = 'force-dynamic';

export default async function HostelStructurePage() {
  await requireSession();
  const [hostels, blocks, rooms, beds] = await Promise.all([
    listHostels(),
    listHostelBlocks(),
    listHostelRooms(),
    listHostelBeds(),
  ]);

  const hostelById = new Map(hostels.map((h) => [h.id, h]));
  const blockById = new Map(blocks.map((b) => [b.id, b]));

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Structure</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage blocks, rooms, and beds via `/hostel/blocks`, `/hostel/rooms`, `/hostel/beds`.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/hostel">Back to hostel</Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <NewBlockForm hostels={hostels} />
        <NewRoomForm blocks={blocks} />
        <NewBedForm rooms={rooms} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Blocks</CardTitle>
            <CardDescription>
              {blocks.length === 0
                ? 'No blocks yet.'
                : `${blocks.length} block${blocks.length === 1 ? '' : 's'}.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {blocks.length === 0 ? (
              <p className="text-sm text-muted-foreground" role="status">
                No blocks yet.
              </p>
            ) : (
              <ul className="divide-y divide-border" role="list">
                {blocks.map((block) => {
                  const hostel = hostelById.get(block.hostelId);
                  return (
                    <li key={block.id} className="py-3 first:pt-0 last:pb-0">
                      <p className="text-sm font-medium text-foreground">{block.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {hostel ? `${hostel.name} · ` : ''}floor {block.floor}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rooms</CardTitle>
            <CardDescription>
              {rooms.length === 0
                ? 'No rooms yet.'
                : `${rooms.length} room${rooms.length === 1 ? '' : 's'}.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {rooms.length === 0 ? (
              <p className="text-sm text-muted-foreground" role="status">
                No rooms yet.
              </p>
            ) : (
              <ul className="divide-y divide-border" role="list">
                {rooms.map((room) => {
                  const block = blockById.get(room.blockId);
                  return (
                    <li key={room.id} className="py-3 first:pt-0 last:pb-0">
                      <p className="text-sm font-medium text-foreground">Room {room.roomNumber}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {block ? `${block.name} · ` : ''}capacity {room.capacity}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Beds</CardTitle>
            <CardDescription>
              {beds.length === 0
                ? 'No beds yet.'
                : `${beds.length} bed${beds.length === 1 ? '' : 's'}.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {beds.length === 0 ? (
              <p className="text-sm text-muted-foreground" role="status">
                No beds yet.
              </p>
            ) : (
              <ul className="divide-y divide-border" role="list">
                {beds.map((bed) => {
                  const room = rooms.find((r) => r.id === bed.roomId);
                  return (
                    <li key={bed.id} className="py-3 first:pt-0 last:pb-0">
                      <p className="text-sm font-medium text-foreground">Bed {bed.bedLabel}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {room ? `room ${room.roomNumber} · ` : ''}
                        {bed.isAvailable ? 'available' : 'unavailable'}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
