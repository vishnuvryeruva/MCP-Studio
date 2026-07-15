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
import { FunctionModulesService } from '../services/function-modules.service';
import { CreateFunctionModuleDto } from '../dto/create-function-module.dto';
import { UpdateFunctionModuleDto } from '../dto/update-function-module.dto';

@Controller('admin/function-modules')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permission.MANAGE_FUNCTION_MODULES)
export class FunctionModulesController {
  constructor(private readonly functionModulesService: FunctionModulesService) {}

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.functionModulesService.findAll(user.organizationId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.functionModulesService.findOneOrThrow(user.organizationId, id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateFunctionModuleDto) {
    return this.functionModulesService.create(user.organizationId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateFunctionModuleDto,
  ) {
    return this.functionModulesService.update(user.organizationId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.functionModulesService.remove(user.organizationId, id);
  }
}
