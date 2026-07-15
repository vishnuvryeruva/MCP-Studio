import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FunctionModule } from '../../models/function-module.model';
import { SapDestinationsService } from './sap-destinations.service';
import { CreateFunctionModuleDto } from '../dto/create-function-module.dto';
import { UpdateFunctionModuleDto } from '../dto/update-function-module.dto';

@Injectable()
export class FunctionModulesService {
  constructor(
    @InjectModel(FunctionModule)
    private readonly functionModuleModel: typeof FunctionModule,
    private readonly sapDestinationsService: SapDestinationsService,
  ) {}

  findAll(organizationId: string) {
    return this.functionModuleModel.findAll({ where: { organizationId } });
  }

  async findOneOrThrow(organizationId: string, id: string): Promise<FunctionModule> {
    const functionModule = await this.functionModuleModel.findOne({
      where: { id, organizationId },
    });
    if (!functionModule) {
      throw new NotFoundException('Function module not found');
    }
    return functionModule;
  }

  async create(organizationId: string, dto: CreateFunctionModuleDto) {
    // Ensures the FM can only be whitelisted against a destination the admin actually owns.
    await this.sapDestinationsService.findOneOrThrow(organizationId, dto.sapDestinationId);
    return this.functionModuleModel.create({ ...dto, organizationId });
  }

  async update(organizationId: string, id: string, dto: UpdateFunctionModuleDto) {
    const functionModule = await this.findOneOrThrow(organizationId, id);
    if (dto.sapDestinationId) {
      await this.sapDestinationsService.findOneOrThrow(organizationId, dto.sapDestinationId);
    }
    return functionModule.update(dto);
  }

  async remove(organizationId: string, id: string) {
    const functionModule = await this.findOneOrThrow(organizationId, id);
    await functionModule.destroy();
  }
}
