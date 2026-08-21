import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FunctionModule } from '../../models/function-module.model';
import type { DestinationTransport } from '../../models/sap-destination.model';
import { ToolIndexService } from '../../tool-index/tool-index.service';
import type { OverlapWarning } from '../../tool-index/tool-index.service';
import { SapDestinationsService } from './sap-destinations.service';
import { CreateFunctionModuleDto } from '../dto/create-function-module.dto';
import { UpdateFunctionModuleDto } from '../dto/update-function-module.dto';

// The saved row, plus any advisory warnings about it. Spread rather than nested
// so existing callers that just read the function module keep working.
export type SavedFunctionModule = Record<string, unknown> & {
  overlapWarnings: OverlapWarning[];
};

@Injectable()
export class FunctionModulesService {
  constructor(
    @InjectModel(FunctionModule)
    private readonly functionModuleModel: typeof FunctionModule,
    private readonly sapDestinationsService: SapDestinationsService,
    private readonly toolIndexService: ToolIndexService,
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

  async create(organizationId: string, dto: CreateFunctionModuleDto): Promise<SavedFunctionModule> {
    // Ensures the FM can only be whitelisted against a destination the admin actually owns.
    const destination = await this.sapDestinationsService.findOneOrThrow(
      organizationId,
      dto.sapDestinationId,
    );
    this.assertAddressable(destination.transport, dto.fmcallUrl);
    const created = await this.functionModuleModel.create({
      ...dto,
      // A CAP-backed module is reached by name, so any URL supplied for it would be
      // dead configuration that later reads as if it were in use.
      fmcallUrl: destination.transport === 'cap_facade' ? null : dto.fmcallUrl,
      organizationId,
    });
    return this.withOverlapWarnings(organizationId, created);
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateFunctionModuleDto,
  ): Promise<SavedFunctionModule> {
    const functionModule = await this.findOneOrThrow(organizationId, id);
    const destination = await this.sapDestinationsService.findOneOrThrow(
      organizationId,
      dto.sapDestinationId ?? functionModule.sapDestinationId,
    );
    const fmcallUrl = dto.fmcallUrl ?? functionModule.fmcallUrl ?? undefined;
    this.assertAddressable(destination.transport, fmcallUrl);
    const updated = await functionModule.update({
      ...dto,
      ...(destination.transport === 'cap_facade' ? { fmcallUrl: null } : {}),
    });
    return this.withOverlapWarnings(organizationId, updated);
  }

  private assertAddressable(transport: DestinationTransport, fmcallUrl?: string): void {
    if (transport !== 'cap_facade' && !fmcallUrl?.trim()) {
      throw new BadRequestException(
        'This destination calls SAP directly, so the function module needs an fmcall URL.',
      );
    }
  }

  async remove(organizationId: string, id: string) {
    const functionModule = await this.findOneOrThrow(organizationId, id);
    await this.toolIndexService.forget(id);
    await functionModule.destroy();
  }

  // Two whitelist entries that read the same way give the model no basis for
  // choosing between them, and the choice can differ from turn to turn. Flag it
  // at save time — while the admin still has the wording in front of them —
  // rather than letting it surface later as an inconsistent answer.
  private async withOverlapWarnings(
    organizationId: string,
    functionModule: FunctionModule,
  ): Promise<SavedFunctionModule> {
    const siblings = await this.functionModuleModel.findAll({ where: { organizationId } });
    const overlapWarnings = await this.toolIndexService.findOverlaps(functionModule, siblings);
    return {
      ...functionModule.toJSON<Record<string, unknown>>(),
      overlapWarnings,
    };
  }
}
