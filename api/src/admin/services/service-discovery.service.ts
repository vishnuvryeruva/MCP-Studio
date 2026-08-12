import { Injectable, Logger } from '@nestjs/common';
import { SapDestination } from '../../models/sap-destination.model';
import { SapDestinationsService } from './sap-destinations.service';

export interface DiscoveredService {
  id: string;
  title: string;
  description: string;
  // Path (relative to the destination base URL) used to call the service.
  servicePath: string;
  metadataPath: string;
  technicalName: string;
  version: string;
}

export interface DiscoveryResult {
  services: DiscoveredService[];
  catalogPath: string | null;
  message: string;
}

// SAP Gateway's standard OData service catalogs. v2 is preferred; the unversioned
// path is the documented fallback for systems where v2 isn't available.
const CATALOG_PATHS = [
  "/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/ServiceCollection?$format=json",
  '/sap/opu/odata/IWFND/CATALOGSERVICE/ServiceCollection?$format=json',
];

// Only OData services registered in SAP Gateway are discoverable over HTTP.
// Raw RFC/BAPI function modules and custom ICF handlers have no standard
// HTTP catalog, so those must still be whitelisted manually.
@Injectable()
export class ServiceDiscoveryService {
  private readonly logger = new Logger(ServiceDiscoveryService.name);

  constructor(private readonly sapDestinationsService: SapDestinationsService) {}

  async discover(organizationId: string, sapDestinationId: string): Promise<DiscoveryResult> {
    const destination = await this.sapDestinationsService.findOneOrThrow(
      organizationId,
      sapDestinationId,
    );

    const failures: string[] = [];
    for (const catalogPath of CATALOG_PATHS) {
      try {
        const response = await this.sapDestinationsService.callSap(destination, catalogPath);
        const services = this.parseCatalog(response.data, destination);
        return {
          services,
          catalogPath,
          message: services.length
            ? `Found ${services.length} OData service(s) in the SAP Gateway catalog.`
            : 'The SAP Gateway catalog responded but listed no services.',
        };
      } catch (err) {
        const detail = this.errorDetail(err);
        failures.push(`${catalogPath} → ${detail}`);
        this.logger.warn(`Catalog lookup failed for destination ${destination.id}: ${detail}`);
      }
    }

    return {
      services: [],
      catalogPath: null,
      message:
        'Could not read the SAP Gateway service catalog. It may not be activated on this system ' +
        `(activate it in transaction /IWFND/MAINT_SERVICE), or the SAP user may lack authorization. Tried: ${failures.join('; ')}`,
    };
  }

  // The catalog is a standard OData ServiceCollection; entries live under d.results.
  // Field availability varies by SAP release, so every field is read defensively.
  private parseCatalog(data: unknown, destination: SapDestination): DiscoveredService[] {
    const results = (data as { d?: { results?: unknown[] } } | undefined)?.d?.results;
    if (!Array.isArray(results)) {
      return [];
    }

    return results
      .map((entry) => {
        const row = entry as Record<string, unknown>;
        const serviceUrl = this.asString(row.ServiceUrl);
        const rawPath = this.toPath(serviceUrl, destination);
        if (!rawPath) return null;
        // Keep the trailing slash: SAP Gateway 30x-redirects the slash-less form, and
        // a redirect through the connectivity proxy loses the Proxy-Authorization
        // header, which surfaces later as a confusing HTTP 407.
        const servicePath = rawPath.endsWith('/') ? rawPath : `${rawPath}/`;

        return {
          id: this.asString(row.ID) || servicePath,
          title: this.asString(row.Title) || this.asString(row.TechnicalServiceName) || servicePath,
          description: this.asString(row.Description),
          servicePath,
          metadataPath: `${servicePath.replace(/\/$/, '')}/$metadata`,
          technicalName: this.asString(row.TechnicalServiceName),
          version: this.asString(row.TechnicalServiceVersion),
        };
      })
      .filter((service): service is DiscoveredService => service !== null)
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  // Catalog entries may return absolute URLs pointing at the SAP host. We store paths
  // relative to the destination so calls keep routing through the configured destination
  // (and its Cloud Connector) rather than a host the catalog happens to advertise.
  private toPath(serviceUrl: string, destination: SapDestination): string {
    if (!serviceUrl) return '';
    if (serviceUrl.startsWith('/')) return serviceUrl;
    try {
      return new URL(serviceUrl).pathname;
    } catch {
      this.logger.warn(
        `Unparseable ServiceUrl "${serviceUrl}" in catalog for destination ${destination.id}`,
      );
      return '';
    }
  }

  private asString(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private errorDetail(err: unknown): string {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status) return `HTTP ${status}`;
    const cause = (err as { cause?: { response?: { status?: number } } })?.cause?.response?.status;
    if (cause) return `HTTP ${cause}`;
    return err instanceof Error ? err.message : 'Unknown error';
  }
}
