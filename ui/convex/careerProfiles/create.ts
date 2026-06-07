import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

const profileFields = {
  name: v.optional(v.string()),
  phoneNumber: v.optional(v.string()),
  skills: v.optional(v.array(v.string())),
  experience: v.optional(v.array(v.string())),
  education: v.optional(v.array(v.string())),
  interests: v.optional(v.array(v.string())),
  preferredRoles: v.optional(v.array(v.string())),
  locationPreferences: v.optional(v.array(v.string())),
  workPreferences: v.optional(v.array(v.string())),
  summary: v.optional(v.string()),
  missingFields: v.optional(v.array(v.string())),
} as const;

export const upsertProfile = internalMutation({
  args: profileFields,
  handler: async (ctx, args) => {
    if (args.phoneNumber) {
      const existing = await ctx.db
        .query("careerProfiles")
        .withIndex("by_phone", (q) => q.eq("phoneNumber", args.phoneNumber))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, args);
        return existing._id;
      }
    }
    return await ctx.db.insert("careerProfiles", args);
  },
});
