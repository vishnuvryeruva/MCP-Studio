import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { SapDestination } from '../../models/sap-destination.model';
import { EncryptionService } from '../../common/services/encryption.service';
import { CreateSapDestinationDto } from '../dto/create-sap-destination.dto';
import { UpdateSapDestinationDto } from '../dto/update-sap-destination.dto';

@Injectable()
export class SapDestinationsService {
  constructor(
    @InjectModel(SapDestination)
    private readonly sapDestinationModel: typeof SapDestination,
    private readonly encryptionService: EncryptionService,
  ) {}

  async findAll(organizationId: string) {
    const destinations = await this.sapDestinationModel.findAll({
      where: { organizationId },
    });
    return destinations.map((d) => this.toSafeResponse(d));
  }

  async findOneOrThrow(organizationId: string, id: string): Promise<SapDestination> {
    const destination = await this.sapDestinationModel.findOne({
      where: { id, organizationId },
    });
    if (!destination) {
      throw new NotFoundException('SAP destination not found');
    }
    return destination;
  }

  async findOneSafe(organizationId: string, id: string) {
    return this.toSafeResponse(await this.findOneOrThrow(organizationId, id));
  }

  async create(organizationId: string, userId: string, dto: CreateSapDestinationDto) {
    const destination = await this.sapDestinationModel.create({
      organizationId,
      name: dto.name,
      description: dto.description ?? null,
      url: dto.url,
      encryptedSapUser: this.encryptionService.encrypt(dto.sapUser),
      encryptedSapPassword: this.encryptionService.encrypt(dto.sapPassword),
      createdByUserId: userId,
      isActive: true,
    });
    return this.toSafeResponse(destination);
  }

  async update(organizationId: string, id: string, dto: UpdateSapDestinationDto) {
    const destination = await this.findOneOrThrow(organizationId, id);
    const { sapUser, sapPassword, ...rest } = dto;
    await destination.update({
      ...rest,
      ...(sapUser ? { encryptedSapUser: this.encryptionService.encrypt(sapUser) } : {}),
      ...(sapPassword
        ? { encryptedSapPassword: this.encryptionService.encrypt(sapPassword) }
        : {}),
    });
    return this.toSafeResponse(destination);
  }

  async remove(organizationId: string, id: string) {
    const destination = await this.findOneOrThrow(organizationId, id);
    await destination.destroy();
  }

  // Decrypted credentials should only ever be read by the internal fmcall invoker, never returned over the API.
  decryptCredentials(destination: SapDestination) {
    return {
      sapUser: this.encryptionService.decrypt(destination.encryptedSapUser),
      sapPassword: this.encryptionService.decrypt(destination.encryptedSapPassword),
    };
  }

  private toSafeResponse(destination: SapDestination) {
    return {
      id: destination.id,
      organizationId: destination.organizationId,
      name: destination.name,
      description: destination.description,
      url: destination.url,
      isActive: destination.isActive,
      createdByUserId: destination.createdByUserId,
      createdAt: destination.get('createdAt'),
      updatedAt: destination.get('updatedAt'),
    };
  }
}
