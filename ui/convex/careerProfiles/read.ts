import { v } from "convex/values";
import { internalQuery, query } from "../_generated/server";

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

// Same shape as `getByPhone` but registered as internal so server-side actions
// can fetch the profile without exposing the lookup through the public API.
export const _getByPhoneInternal = internalQuery({
  args: { phoneNumber: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("careerProfiles")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
      .unique();
  },
});
