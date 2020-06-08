const { parse } = require('es-module-lexer');
function spliceString(source, withSlice, start, end) {
    return source.slice(0, start) + (withSlice || '') + source.slice(end);
}
export async function scanCodeImportsExports(code) {
    const [imports] = await parse(code);
    return imports.filter((imp) => {
        //imp.d = -2 = import.meta.url = we can skip this for now
        if (imp.d === -2) {
            return false;
        }
        // imp.d > -1 === dynamic import
        if (imp.d > -1) {
            const importStatement = code.substring(imp.s, imp.e);
            const importSpecifierMatch = importStatement.match(/^\s*['"](.*)['"]\s*$/m);
            return !!importSpecifierMatch;
        }
        return true;
    });
}
export async function transformEsmImports(_code, replaceImport) {
    const imports = await scanCodeImportsExports(_code);
    let rewrittenCode = _code;
    for (const imp of imports.reverse()) {
        let spec = rewrittenCode.substring(imp.s, imp.e);
        if (imp.d > -1) {
            const importSpecifierMatch = spec.match(/^\s*['"](.*)['"]\s*$/m);
            spec = importSpecifierMatch[1];
        }
        let rewrittenImport = replaceImport(spec);
        if (imp.d > -1) {
            rewrittenImport = JSON.stringify(rewrittenImport);
        }
        rewrittenCode = spliceString(rewrittenCode, rewrittenImport, imp.s, imp.e);
    }
    return rewrittenCode;
}
