import { v } from "convex/values";
import { query } from "../_generated/server";

export const getByPhone = query({
  args: { phoneNumber: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("careerProfiles")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .unique();
  },
});

export const getById = query({
  args: { profileId: v.id("careerProfiles") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.profileId);
  },
});
