import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { FunctionModuleEmbedding } from '../models/function-module-embedding.model';
import { LlmModule } from '../llm/llm.module';
import { ToolIndexService } from './tool-index.service';

// Shared by both sides of the whitelist: admin writes (overlap warnings on save)
// and chat reads (shortlisting tools for a question).
@Module({
  imports: [SequelizeModule.forFeature([FunctionModuleEmbedding]), LlmModule],
  providers: [ToolIndexService],
  exports: [ToolIndexService],
})
export class ToolIndexModule {}
