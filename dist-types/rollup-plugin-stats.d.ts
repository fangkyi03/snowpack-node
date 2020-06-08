import { OutputOptions, OutputBundle } from 'rollup';
export declare type DependencyStats = {
    size: number;
    gzip: number;
    brotli?: number;
    delta?: number;
};
declare type DependencyStatsMap = {
    [filePath: string]: DependencyStats;
};
declare type DependencyType = 'direct' | 'common';
export declare type DependencyStatsOutput = Record<DependencyType, DependencyStatsMap>;
export declare function rollupPluginDependencyStats(cb: (dependencyInfo: DependencyStatsOutput) => void): {
    name: string;
    generateBundle(options: OutputOptions, bundle: OutputBundle): void;
    writeBundle(options: OutputOptions, bundle: OutputBundle): void;
};
export {};
