import { Plugin } from 'rollup';
/**
 * rollup-plugin-remote-cdn
 *
 * Load import URLs from a remote CDN, sitting behind a local cache. The local
 * cache acts as a go-between for the resolve & load step: when we get back a
 * successful CDN resolution, we save the file to the local cache and then tell
 * rollup that it's safe to load from the cache in the `load()` hook.
 */
export declare function rollupPluginDependencyCache({ installTypes, log, }: {
    installTypes: boolean;
    log: (url: string) => void;
}): Plugin;
