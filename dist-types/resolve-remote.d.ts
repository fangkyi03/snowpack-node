import { SnowpackConfig } from './config.js';
import { ImportMap } from './util.js';
export declare function resolveTargetsFromRemoteCDN(lockfile: ImportMap | null, pkgManifest: any, config: SnowpackConfig): Promise<ImportMap>;
