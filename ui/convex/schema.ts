import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,
  tasks: defineTable({
    text: v.string(),
    isCompleted: v.boolean(),
  }),

  // Career profile collected during the Matcha phone interview.
  // Mirrors CareerProfile in agent-py/src/career_profile.py.
  careerProfiles: defineTable({
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
  }).index("by_phone", ["phoneNumber"]),
});
