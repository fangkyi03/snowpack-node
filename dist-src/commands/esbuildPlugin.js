import { startService } from 'esbuild';
import path from 'path';
import { checkIsPreact } from './build-util';
import chalk from 'chalk';
let esbuildService = null;
export function esbuildPlugin() {
    return {
        async build({ contents, filePath }) {
            esbuildService = esbuildService || (await startService());
            const isPreact = checkIsPreact(filePath, contents);
            const { js, warnings } = await esbuildService.transform(contents, {
                loader: path.extname(filePath).substr(1),
                jsxFactory: isPreact ? 'h' : undefined,
                jsxFragment: isPreact ? 'Fragment' : undefined,
            });
            for (const warning of warnings) {
                console.error(chalk.bold('! ') + filePath);
                console.error('  ' + warning.text);
            }
            return { result: js || '' };
        },
    };
}
export function stopEsbuild() {
    esbuildService && esbuildService.stop();
}
