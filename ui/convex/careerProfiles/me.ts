import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "../_generated/server";

/**
 * Resolve the signed-in user's CareerProfile (joined by phone number) and
 * the JobRecommendations rows persisted for that profile. Recommendations are
 * hydrated with their parent Job document so the UI can render in one pass.
 *
 * Returns `null` when not authenticated, and an empty list (with `profile`
 * possibly null) when the user hasn't been through the agent interview yet.
 */
export const getMyRecommendations = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const user = await ctx.db.get(userId);
    if (!user || !user.phone) {
      return { profile: null, recommendations: [] };
    }

    const profile = await ctx.db
      .query("careerProfiles")
      .withIndex("by_phone", (q) => q.eq("phoneNumber", user.phone))
      .unique();

    if (!profile) {
      return { profile: null, recommendations: [] };
    }

    const recs = await ctx.db
      .query("jobRecommendations")
      .withIndex("by_profile", (q) => q.eq("careerProfileId", profile._id))
      .order("desc")
      .take(3);

    const hydrated = await Promise.all(
      recs.map(async (r) => ({
        _id: r._id,
        _creationTime: r._creationTime,
        score: r.score,
        reasons: r.reasons ?? [],
        job: await ctx.db.get(r.jobId),
      })),
    );

    return {
      profile,
      recommendations: hydrated.filter((r) => r.job !== null),
    };
  },
});
