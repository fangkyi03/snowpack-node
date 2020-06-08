import { CancelableRequest, Response } from 'got';
import { SnowpackConfig, BuildScript } from './config';
export declare const PIKA_CDN = "https://cdn.pika.dev";
export declare const GLOBAL_CACHE_DIR: any;
export declare const RESOURCE_CACHE: string;
export declare const BUILD_CACHE: string;
export declare const PROJECT_CACHE_DIR: any;
export declare const DEV_DEPENDENCIES_DIR: string;
export declare const BUILD_DEPENDENCIES_DIR: string;
export declare const HAS_CDN_HASH_REGEX: RegExp;
export interface ImportMap {
    imports: {
        [packageName: string]: string;
    };
}
export interface CommandOptions {
    cwd: string;
    config: SnowpackConfig;
    lockfile: ImportMap | null;
    pkgManifest: any;
}
export declare function isYarn(cwd: string): boolean;
export declare function readLockfile(cwd: string): Promise<ImportMap | null>;
export declare function writeLockfile(loc: string, importMap: ImportMap): Promise<void>;
export declare function fetchCDNResource(resourceUrl: string, responseType?: 'text' | 'json' | 'buffer'): Promise<CancelableRequest<Response>>;
export declare function isTruthy<T>(item: T | false | null | undefined): item is T;
/**
 * Given a package name, look for that package's package.json manifest.
 * Return both the manifest location (if believed to exist) and the
 * manifest itself (if found).
 *
 * NOTE: You used to be able to require() a package.json file directly,
 * but now with export map support in Node v13 that's no longer possible.
 */
export declare function resolveDependencyManifest(dep: string, cwd: string): any[];
/**
 * If Rollup erred parsing a particular file, show suggestions based on its
 * file extension (note: lowercase is fine).
 */
export declare const MISSING_PLUGIN_SUGGESTIONS: {
    [ext: string]: string;
};
export declare function openInBrowser(port: number, browser: string): Promise<true | undefined>;
export declare function checkLockfileHash(dir: string): Promise<boolean>;
export declare function updateLockfileHash(dir: string): Promise<void>;
export declare function clearCache(): Promise<[void, void, any]>;
/**
 * Given an import string and a list of scripts, return the mount script that matches the import.
 *
 * `mount ./src --to /_dist_` and `mount src --to /_dist_` match `src/components/Button`
 * `mount src --to /_dist_` does not match `package/components/Button`
 */
export declare function findMatchingMountScript(scripts: BuildScript[], spec: string): BuildScript | null | undefined;
