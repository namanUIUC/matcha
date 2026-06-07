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

  // Demo job postings used to bootstrap recommendations. Seeded lazily from
  // `careerProfiles/demoJobs.ts` on first run of the recommend-jobs action.
  jobs: defineTable({
    externalId: v.string(),
    title: v.string(),
    company: v.string(),
    location: v.string(),
    remoteType: v.optional(v.string()),
    skills: v.optional(v.array(v.string())),
    description: v.optional(v.string()),
    roleCategory: v.optional(v.string()),
    experienceLevel: v.optional(v.string()),
  }).index("by_external_id", ["externalId"]),

  // Per-profile job recommendations. We persist whatever was recommended so
  // subsequent calls (e.g. "show me more") can exclude what's already been
  // surfaced and only return fresh matches.
  jobRecommendations: defineTable({
    careerProfileId: v.id("careerProfiles"),
    jobId: v.id("jobs"),
    score: v.number(),
    reasons: v.optional(v.array(v.string())),
  })
    .index("by_profile", ["careerProfileId"])
    .index("by_profile_and_job", ["careerProfileId", "jobId"]),
});
