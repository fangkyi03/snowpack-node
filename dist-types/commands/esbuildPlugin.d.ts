import { SnowpackPluginBuildResult } from '../config';
export declare function esbuildPlugin(): {
    build({ contents, filePath }: {
        contents: any;
        filePath: any;
    }): Promise<SnowpackPluginBuildResult>;
};
export declare function stopEsbuild(): void;
