import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { Organization } from './organization.model';
import { SapDestination } from './sap-destination.model';

export interface FunctionModuleParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date';
  required: boolean;
  description?: string;
}

// A whitelisted SAP fmcall URL exposed to the MCP server / Claude as a callable "tool".
@Table({
  tableName: 'function_modules',
  timestamps: true,
  indexes: [{ unique: true, fields: ['organizationId', 'name'] }],
})
export class FunctionModule extends Model {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => Organization)
  @Column({ type: DataType.UUID, allowNull: false })
  declare organizationId: string;

  @BelongsTo(() => Organization)
  declare organization: Organization;

  @ForeignKey(() => SapDestination)
  @Column({ type: DataType.UUID, allowNull: false })
  declare sapDestinationId: string;

  @BelongsTo(() => SapDestination)
  declare sapDestination: SapDestination;

  // Tool name exposed to Claude, e.g. "get_sales_last_month"
  @Column({ type: DataType.STRING, allowNull: false })
  declare name: string;

  // Tool description exposed to Claude, used to pick the right tool for a user's request
  @Column({ type: DataType.TEXT, allowNull: false })
  declare description: string;

  // Underlying SAP function module name, e.g. "BAPI_SALESORDER_GETLIST"
  @Column({ type: DataType.STRING, allowNull: false })
  declare fmName: string;

  // Path/URL appended to the destination base URL to invoke the FM
  @Column({ type: DataType.STRING, allowNull: false })
  declare fmcallUrl: string;

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: [] })
  declare parameters: FunctionModuleParam[];

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare isEnabled: boolean;
}
