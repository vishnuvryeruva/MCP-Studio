import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  HasMany,
  Model,
  Table,
} from 'sequelize-typescript';
import { Organization } from './organization.model';
import { User } from './user.model';
import { FunctionModule } from './function-module.model';

@Table({
  tableName: 'sap_destinations',
  timestamps: true,
  indexes: [{ unique: true, fields: ['organizationId', 'name'] }],
})
export class SapDestination extends Model {
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

  // Human-friendly name for this destination within MCP Studio (unique per org).
  @Column({ type: DataType.STRING, allowNull: false })
  declare name: string;

  @Column({ type: DataType.STRING, allowNull: true })
  declare description: string | null;

  // Base URL of the SAP system. For on-prem access via SAP Cloud Connector this is
  // the *virtual host* mapped in the connector (e.g. http://192.168.171.41:8000),
  // not a public URL.
  @Column({ type: DataType.STRING, allowNull: false })
  declare url: string;

  // Optional SAP Cloud Connector Location ID. When set (or when the app-wide default
  // is configured), outbound calls route through the BTP Connectivity service with
  // proxyType "OnPremise" to reach the on-prem ABAP system. Null = direct/Internet call.
  @Column({ type: DataType.STRING, allowNull: true })
  declare cloudConnectorLocationId: string | null;

  // AES-256-GCM encrypted "iv:authTag:ciphertext" hex string. Never store SAP_USER/SAP_PWD in plaintext.
  @Column({ type: DataType.TEXT, allowNull: false })
  declare encryptedSapUser: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare encryptedSapPassword: string;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: true })
  declare isActive: boolean;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare createdByUserId: string;

  @BelongsTo(() => User)
  declare createdBy: User;

  @HasMany(() => FunctionModule)
  declare functionModules: FunctionModule[];
}
