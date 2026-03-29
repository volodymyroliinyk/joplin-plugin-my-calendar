import * as fs from 'fs';
import * as path from 'path';
import Module = require('module');

const REPO_ROOT = path.resolve(__dirname, '../..');
const MAIN_SRC_DIR = path.join(REPO_ROOT, 'src/main');
const FORBIDDEN_BUILTINS = ['http', 'https', 'fs', 'net', 'tls', 'child_process'] as const;
const ALLOWED_FILES = new Set([
    path.normalize(path.join(MAIN_SRC_DIR, 'services/automatedIcsImportService.ts')),
]);

function walkTsFiles(dir: string): string[] {
    const out: string[] = [];

    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...walkTsFiles(fullPath));
            continue;
        }
        if (!entry.isFile()) continue;
        if (!fullPath.endsWith('.ts')) continue;
        out.push(fullPath);
    }

    return out.sort();
}

function escapeForRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('mobile startup safety', () => {
    afterEach(() => {
        jest.restoreAllMocks();
        jest.resetModules();
    });

    test('automatedIcsImportService import does not eagerly load desktop-only Node modules', () => {
        const moduleAny = Module as any;
        const originalLoad = moduleAny._load;
        const loadedRequests: string[] = [];

        moduleAny._load = function (request: string, parent: NodeModule | null, isMain: boolean) {
            loadedRequests.push(request);
            return originalLoad.call(this, request, parent, isMain);
        };

        try {
            jest.isolateModules(() => {
                require('../../src/main/services/automatedIcsImportService');
            });
        } finally {
            moduleAny._load = originalLoad;
        }

        expect(loadedRequests).not.toContain('http');
        expect(loadedRequests).not.toContain('https');
    });

    test('mobile-shared source files do not use forbidden top-level Node built-in imports', () => {
        const files = walkTsFiles(MAIN_SRC_DIR).filter((filePath) => !ALLOWED_FILES.has(path.normalize(filePath)));
        const violations: string[] = [];

        for (const filePath of files) {
            const relPath = path.relative(REPO_ROOT, filePath).replace(/\\/g, '/');
            const source = fs.readFileSync(filePath, 'utf8');

            for (const builtin of FORBIDDEN_BUILTINS) {
                const builtinPattern = escapeForRegex(builtin);
                const topLevelImport = new RegExp(String.raw`^\s*import\s+.+\s+from\s+['"]${builtinPattern}['"]`, 'm');
                const topLevelBareImport = new RegExp(String.raw`^\s*import\s+['"]${builtinPattern}['"]`, 'm');
                const topLevelRequire = new RegExp(String.raw`^\s*(?:const|let|var)\s+.+=\s+require\(\s*['"]${builtinPattern}['"]\s*\)`, 'm');

                if (topLevelImport.test(source) || topLevelBareImport.test(source) || topLevelRequire.test(source)) {
                    violations.push(`${relPath}: top-level ${builtin} import is not mobile-safe`);
                }
            }
        }

        expect(violations).toEqual([]);
    });
});
