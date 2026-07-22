import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permission } from '../../common/enums/permission.enum';
import type { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { SapDestinationsService } from '../services/sap-destinations.service';
import { CreateSapDestinationDto } from '../dto/create-sap-destination.dto';
import { UpdateSapDestinationDto } from '../dto/update-sap-destination.dto';
import { TestSapConnectionDto } from '../dto/test-sap-connection.dto';

@Controller('admin/sap-destinations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permission.MANAGE_SAP_DESTINATIONS)
export class SapDestinationsController {
  constructor(private readonly sapDestinationsService: SapDestinationsService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.sapDestinationsService.findAll(user.organizationId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sapDestinationsService.findOneSafe(user.organizationId, id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSapDestinationDto) {
    return this.sapDestinationsService.create(user.organizationId, user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSapDestinationDto,
  ) {
    return this.sapDestinationsService.update(user.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sapDestinationsService.remove(user.organizationId, id);
  }

  @Post(':id/test-connection')
  testConnection(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: TestSapConnectionDto,
  ) {
    return this.sapDestinationsService.testConnection(user.organizationId, id, dto.path);
  }
}
