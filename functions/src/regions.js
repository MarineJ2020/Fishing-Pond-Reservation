import * as functions from 'firebase-functions';

// Firestore lives in asia-southeast1 (Singapore), so functions run there to keep
// every database round trip local. Keep the client's FUNCTIONS_REGION
// (lib/firebase.ts) and the seoRender rewrites in firebase.json in step.
export const REGION = 'asia-southeast1';

// Transition only: browser-facing functions also stay in us-central1 so tabs
// still running the previous build (which calls us-central1) keep working.
// Drop LEGACY_REGION once old clients have refreshed; firestore/pubsub triggers
// run in REGION alone so they never fire twice.
const LEGACY_REGION = 'us-central1';

export const regional = functions.region(REGION);
// maxInstances caps cost if someone floods a function (limits are per region).
// Note runWith() mutates a shared builder, so per-function options use a fresh one.
const DEFAULT_MAX_INSTANCES = 20;
export const browserFacing = functions.region(REGION, LEGACY_REGION).runWith({ maxInstances: DEFAULT_MAX_INSTANCES });
export const browserFacingWith = (options) => functions.region(REGION, LEGACY_REGION)
    .runWith({ maxInstances: DEFAULT_MAX_INSTANCES, ...options });
