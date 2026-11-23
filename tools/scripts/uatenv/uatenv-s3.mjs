#!/usr/bin/env node
/**
 * UAT object-storage helper, run inside a one-off api-gateway container
 * (uatenv_compose run --rm --no-deps ...), so the S3_* settings come from the
 * container environment and nothing is printed but counts.
 *
 *   node uatenv-s3.mjs ensure   create S3_BUCKET when missing
 *   node uatenv-s3.mjs empty    delete every object in S3_BUCKET
 */
import { createRequire } from 'node:module';

// The SDK lives in the gateway image's workspace, not next to this script.
const require = createRequire('/app/packages/shared/storage/package.json');
const {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require('@aws-sdk/client-s3');

const bucket = process.env.S3_BUCKET;
if (!bucket) {
  console.error('uatenv-s3: S3_BUCKET is not set');
  process.exit(1);
}
const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? '',
    secretAccessKey: process.env.S3_SECRET_KEY ?? '',
  },
});

async function ensure() {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`uatenv-s3: bucket ${bucket} exists`);
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`uatenv-s3: bucket ${bucket} created`);
  }
}

async function empty() {
  let deleted = 0;
  let token;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
    );
    const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key }));
    if (keys.length) {
      await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
      deleted += keys.length;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  console.log(`uatenv-s3: deleted ${deleted} object(s) from ${bucket}`);
}

const cmd = process.argv[2];
const run = cmd === 'ensure' ? ensure : cmd === 'empty' ? empty : null;
if (!run) {
  console.error('usage: uatenv-s3.mjs ensure|empty');
  process.exit(2);
}
run().catch((err) => {
  console.error(`uatenv-s3: ${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`);
  process.exit(1);
});
