// Hand-written declaration for mobileCertPaths.mjs — this repo has no
// build step that would otherwise produce one, and both consumers that
// type-check (frontend/vite.config.ts, via tsconfig.node.json) need it.
export declare const repoRoot: string;
export declare const CERT_DIR: string;
export declare const CERT_PATH: string;
export declare const KEY_PATH: string;
export declare function mobileCertsExist(): boolean;
