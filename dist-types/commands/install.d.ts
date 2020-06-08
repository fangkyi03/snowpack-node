import { SnowpackConfig } from '../config.js';
import { InstallTarget } from '../scan-imports.js';
import { CommandOptions, ImportMap } from '../util.js';
interface InstallOptions {
    lockfile: ImportMap | null;
    logError: (msg: string) => void;
    logUpdate: (msg: string) => void;
}
export declare function install(installTargets: InstallTarget[], { lockfile, logError, logUpdate }: InstallOptions, config: SnowpackConfig): Promise<boolean | undefined>;
export declare function command({ cwd, config, lockfile, pkgManifest }: CommandOptions): Promise<void>;
export {};
