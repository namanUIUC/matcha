import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
} from "../_generated/server";
import { DEMO_JOBS } from "./demoJobs";

export const listAllJobs = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("jobs").collect();
  },
});

export const listRecommendedJobIds = internalQuery({
  args: { careerProfileId: v.id("careerProfiles") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("jobRecommendations")
      .withIndex("by_profile", (q) =>
        q.eq("careerProfileId", args.careerProfileId),
      )
      .collect();
    return rows.map((r) => r.jobId);
  },
});

export const seedDemoJobsIfEmpty = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("jobs").take(1);
    if (existing.length > 0) return { seeded: false };
    for (const job of DEMO_JOBS) {
      await ctx.db.insert("jobs", job);
    }
    return { seeded: true, count: DEMO_JOBS.length };
  },
});

// Wipe both `jobs` and `jobRecommendations` and reinsert the current
// `DEMO_JOBS` set. Public so we can invoke it with `npx convex run` after
// editing the demo dataset; safe to remove or gate behind auth once the
// jobs/recommendations are sourced from real data.
export const resetDemoJobs = mutation({
  args: {},
  handler: async (ctx) => {
    let deletedRecs = 0;
    while (true) {
      const batch = await ctx.db.query("jobRecommendations").take(100);
      if (batch.length === 0) break;
      for (const row of batch) {
        await ctx.db.delete(row._id);
        deletedRecs += 1;
      }
    }
    let deletedJobs = 0;
    while (true) {
      const batch = await ctx.db.query("jobs").take(100);
      if (batch.length === 0) break;
      for (const row of batch) {
        await ctx.db.delete(row._id);
        deletedJobs += 1;
      }
    }
    for (const job of DEMO_JOBS) {
      await ctx.db.insert("jobs", job);
    }
    return {
      deletedRecs,
      deletedJobs,
      reseeded: DEMO_JOBS.length,
    };
  },
});

export const saveRecommendations = internalMutation({
  args: {
    careerProfileId: v.id("careerProfiles"),
    items: v.array(
      v.object({
        jobId: v.id("jobs"),
        score: v.number(),
        reasons: v.optional(v.array(v.string())),
      }),
    ),
  },
  handler: async (ctx, args) => {
    for (const item of args.items) {
      await ctx.db.insert("jobRecommendations", {
        careerProfileId: args.careerProfileId,
        jobId: item.jobId,
        score: item.score,
        reasons: item.reasons,
      });
    }
    return args.items.length;
  },
});
