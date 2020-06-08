import type HttpProxy from 'http-proxy';
import { Plugin as RollupPlugin } from 'rollup';
declare type ScriptType = 'mount' | 'run' | 'build' | 'bundle';
export declare type EnvVarReplacements = Record<string, string | number | true>;
export declare type SnowpackPluginBuildArgs = {
    contents: string;
    filePath: string;
    isDev: boolean;
};
export declare type SnowpackPluginTransformArgs = {
    contents: string;
    urlPath: string;
    isDev: boolean;
};
export declare type SnowpackPluginBuildResult = {
    result: string;
    resources?: {
        css?: string;
    };
};
export declare type SnowpackPluginTransformResult = {
    result: string;
    resources?: {
        css?: string;
    };
};
export declare type SnowpackPlugin = {
    defaultBuildScript?: string;
    knownEntrypoints?: string[];
    build?: (args: SnowpackPluginBuildArgs) => null | SnowpackPluginBuildResult | Promise<null | SnowpackPluginBuildResult>;
    transform?: (args: SnowpackPluginTransformArgs) => null | SnowpackPluginTransformResult | Promise<null | SnowpackPluginTransformResult>;
    bundle?(args: {
        srcDirectory: string;
        destDirectory: string;
        jsFilePaths: Set<string>;
        log: (msg: any) => void;
    }): Promise<void>;
};
export declare type BuildScript = {
    id: string;
    match: string[];
    type: ScriptType;
    cmd: string;
    watch?: string;
    plugin?: SnowpackPlugin;
    args?: any;
};
export declare type ProxyOptions = HttpProxy.ServerOptions & {
    on: Record<string, Function>;
};
export declare type Proxy = [string, ProxyOptions];
export interface SnowpackConfig {
    extends?: string;
    exclude: string[];
    knownEntrypoints: string[];
    webDependencies?: {
        [packageName: string]: string;
    };
    scripts: BuildScript[];
    plugins: SnowpackPlugin[];
    homepage?: string;
    devOptions: {
        port: number;
        out: string;
        fallback: string;
        open: string;
        bundle: boolean | undefined;
    };
    installOptions: {
        dest: string;
        env: EnvVarReplacements;
        treeshake?: boolean;
        installTypes: boolean;
        sourceMap?: boolean | 'inline';
        externalPackage: string[];
        alias: {
            [key: string]: string;
        };
        rollup: {
            plugins: RollupPlugin[];
            dedupe?: string[];
        };
    };
    proxy: Proxy[];
}
export interface CLIFlags extends Omit<Partial<SnowpackConfig['installOptions']>, 'env'> {
    help?: boolean;
    version?: boolean;
    reload?: boolean;
    config?: string;
    env?: string[];
    open?: string[];
}
export declare function loadAndValidateConfig(flags: CLIFlags, pkgManifest: any): SnowpackConfig;
export {};
