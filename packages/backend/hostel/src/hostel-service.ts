/**
 * Hostel service — occupancy shell operations.
 */
import { NotFoundError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type { HostelRepository } from './hostel-repository.js';
import type { CreateAssignmentInput, CreateHostelInput } from './schemas.js';

export class HostelService {
  constructor(private readonly repository: HostelRepository) {}

  async createHostel(tenantId: string, input: CreateHostelInput) {
    return this.repository.createHostel({
      id: uuidv4(),
      tenantId,
      name: input.name,
      code: input.code,
      address: input.address ?? null,
      capacity: input.capacity ?? 0,
      status: 'active',
    });
  }

  async listHostels(tenantId: string) {
    return this.repository.listHostels(tenantId);
  }

  async getHostel(tenantId: string, id: string) {
    const hostel = await this.repository.findHostelById(id, tenantId);
    if (!hostel) {
      throw new NotFoundError(`Hostel with id '${id}' not found`);
    }
    return hostel;
  }

  async createAssignment(tenantId: string, input: CreateAssignmentInput) {
    return this.repository.createAssignment({
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      bedId: input.bedId,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      isActive: input.isActive ?? true,
    });
  }

  async listAssignments(tenantId: string) {
    return this.repository.listAssignments(tenantId);
  }

  async listLeaves(tenantId: string) {
    return this.repository.listLeaves(tenantId);
  }

  async listVisitors(tenantId: string) {
    return this.repository.listVisitors(tenantId);
  }
}
