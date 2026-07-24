export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_DATABASE ?? 'mygo_fm_bridge',
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? '',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  },
  credentialsEncryptionKey: process.env.CREDENTIALS_ENCRYPTION_KEY ?? '',
  sap: {
    // Default SAP Cloud Connector Location ID (from the BTP subaccount's Cloud
    // Connector). Used when a SapDestination doesn't specify its own. When set,
    // outbound calls route through the Connectivity service to the on-prem system.
    defaultCloudConnectorLocationId:
      process.env.SAP_CLOUD_CONNECTOR_LOCATION_ID ?? '',
  },
});
