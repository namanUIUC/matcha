/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as careerProfiles_create from "../careerProfiles/create.js";
import type * as careerProfiles_demoJobs from "../careerProfiles/demoJobs.js";
import type * as careerProfiles_endpoints from "../careerProfiles/endpoints.js";
import type * as careerProfiles_enrich from "../careerProfiles/enrich.js";
import type * as careerProfiles_jobs from "../careerProfiles/jobs.js";
import type * as careerProfiles_me from "../careerProfiles/me.js";
import type * as careerProfiles_read from "../careerProfiles/read.js";
import type * as careerProfiles_recommendJobs from "../careerProfiles/recommendJobs.js";
import type * as http from "../http.js";
import type * as tasks from "../tasks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  "careerProfiles/create": typeof careerProfiles_create;
  "careerProfiles/demoJobs": typeof careerProfiles_demoJobs;
  "careerProfiles/endpoints": typeof careerProfiles_endpoints;
  "careerProfiles/enrich": typeof careerProfiles_enrich;
  "careerProfiles/jobs": typeof careerProfiles_jobs;
  "careerProfiles/me": typeof careerProfiles_me;
  "careerProfiles/read": typeof careerProfiles_read;
  "careerProfiles/recommendJobs": typeof careerProfiles_recommendJobs;
  http: typeof http;
  tasks: typeof tasks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
