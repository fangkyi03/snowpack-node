/// <reference types="node" />
import type { EventEmitter } from 'events';
import { BuildScript, SnowpackPluginBuildArgs, SnowpackPluginBuildResult } from '../config';
export declare function checkIsPreact(filePath: string, contents: string): boolean;
export declare function isDirectoryImport(fileLoc: string, spec: string): boolean;
export declare function wrapImportMeta(code: string, { hmr, env }: {
    hmr: boolean;
    env: boolean;
}): string;
export declare function wrapCssModuleResponse(url: string, code: string, ext: string, hasHmr?: boolean): Promise<string>;
export declare function wrapHtmlResponse(code: string, hasHmr?: boolean): string;
export declare function wrapEsmProxyResponse(url: string, code: string, ext: string, hasHmr?: boolean): string;
export declare type FileBuilder = (args: SnowpackPluginBuildArgs) => null | SnowpackPluginBuildResult | Promise<null | SnowpackPluginBuildResult>;
export declare function getFileBuilderForWorker(cwd: string, selectedWorker: BuildScript, messageBus: EventEmitter): FileBuilder | undefined;
export declare function generateEnvModule(mode: 'development' | 'production'): string;
