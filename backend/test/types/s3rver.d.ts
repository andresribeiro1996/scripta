// s3rver ships no types. Declared here rather than pulled in as `any`, so
// the test file is still typechecked against the surface it actually uses.
// Only the members this repo's tests touch are declared.
declare module "s3rver" {
  interface S3rverOptions {
    port?: number;
    address?: string;
    silent?: boolean;
    directory?: string;
    configureBuckets?: Array<{ name: string; configs?: unknown[] }>;
  }

  export default class S3rver {
    constructor(options: S3rverOptions);
    run(): Promise<unknown>;
    close(): Promise<unknown>;
  }
}
