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

// How MCP Studio reaches the function module.
//
// 'direct_fmcall' calls the ABAP fmcall service itself, tunnelling through the
// BTP Connectivity service and Cloud Connector with a backend SAP user.
//
// 'cap_facade' posts to a generic CAP service (the `/integration/execute` action)
// that performs the fmcall on our behalf. Auth is XSUAA client credentials and the
// Cloud Connector hop belongs to the CAP app, so none of the on-premise proxy
// handling applies.
export type DestinationTransport = 'direct_fmcall' | 'cap_facade';

export const DESTINATION_TRANSPORTS: DestinationTransport[] = ['direct_fmcall', 'cap_facade'];

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

  // Stored as a plain string rather than a PG enum so adding a transport later is an
  // application change, not a type migration on a database shared with another app.
  @Column({ type: DataType.STRING, allowNull: false, defaultValue: 'direct_fmcall' })
  declare transport: DestinationTransport;

  // For 'direct_fmcall', the base URL of the SAP system: with Cloud Connector this is
  // the *virtual host* mapped in the connector (e.g. http://192.168.171.41:8000), not
  // a public URL. For 'cap_facade', the base URL of the deployed CAP application.
  @Column({ type: DataType.STRING, allowNull: false })
  declare url: string;

  // Optional SAP Cloud Connector Location ID. When set (or when the app-wide default
  // is configured), outbound calls route through the BTP Connectivity service with
  // proxyType "OnPremise" to reach the on-prem ABAP system. Null = direct/Internet call.
  @Column({ type: DataType.STRING, allowNull: true })
  declare cloudConnectorLocationId: string | null;

  // AES-256-GCM encrypted "iv:authTag:ciphertext" hex string. Never store SAP_USER/SAP_PWD
  // in plaintext. Null for 'cap_facade' destinations, which hold no backend credentials —
  // the CAP app owns the SAP user.
  @Column({ type: DataType.TEXT, allowNull: true })
  declare encryptedSapUser: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare encryptedSapPassword: string | null;

  // ── 'cap_facade' only ──────────────────────────────────────────────────────────
  // Action path on the CAP service that executes a function module by name.
  @Column({ type: DataType.STRING, allowNull: true })
  declare capExecutePath: string | null;

  // XSUAA OAuth token endpoint (…/oauth/token) from the CAP app's service binding.
  @Column({ type: DataType.STRING, allowNull: true })
  declare capTokenUrl: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  declare capClientId: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare encryptedCapClientSecret: string | null;

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
