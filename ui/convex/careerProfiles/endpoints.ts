import { HttpRouter } from "convex/server";
import { internal } from "../_generated/api";
import { httpAction } from "../_generated/server";

const ALLOWED_MISSING_FIELDS = new Set([
  "name",
  "skills",
  "experience",
  "education",
  "interests",
  "preferred_roles",
  "location_preferences",
  "work_preferences",
]);

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length > 0 ? Array.from(new Set(out)) : undefined;
}

const handleCreateCareerProfile = httpAction(async (ctx, request) => {
  console.log("[career-profile] request received", {
    method: request.method,
    hasSecretHeader: !!request.headers.get("x-matcha-secret"),
    contentType: request.headers.get("content-type"),
  });

  const secret = process.env.MATCHA_INGEST_SECRET;
  if (secret && request.headers.get("x-matcha-secret") !== secret) {
    console.warn("[career-profile] rejected: bad/missing x-matcha-secret");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch (err) {
    console.error("[career-profile] invalid JSON body", err);
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  console.log("[career-profile] payload keys", Object.keys(payload));
  console.log("[career-profile] phone_number", payload.phone_number);

  const missingFieldsRaw = asStringArray(payload.missing_fields);
  const missingFields = missingFieldsRaw?.filter((f) =>
    ALLOWED_MISSING_FIELDS.has(f),
  );

  const args = {
    name: asString(payload.name),
    phoneNumber: asString(payload.phone_number),
    skills: asStringArray(payload.skills),
    experience: asStringArray(payload.experience),
    education: asStringArray(payload.education),
    interests: asStringArray(payload.interests),
    preferredRoles: asStringArray(payload.preferred_roles),
    locationPreferences: asStringArray(payload.location_preferences),
    workPreferences: asStringArray(payload.work_preferences),
    summary: asString(payload.summary),
    missingFields:
      missingFields && missingFields.length > 0 ? missingFields : undefined,
  };
  console.log("[career-profile] normalized args", {
    phoneNumber: args.phoneNumber,
    name: args.name,
    hasSkills: !!args.skills,
    hasPreferredRoles: !!args.preferredRoles,
  });

  const profileId = await ctx.runMutation(
    internal.careerProfiles.create.upsertProfile,
    args,
  );
  console.log("[career-profile] upserted", { profileId });

  return new Response(JSON.stringify({ profileId }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

const handleRecommendJobs = httpAction(async (ctx, request) => {
  console.log("[recommend-jobs] request received", {
    method: request.method,
    hasSecretHeader: !!request.headers.get("x-matcha-secret"),
  });

  const secret = process.env.MATCHA_INGEST_SECRET;
  if (secret && request.headers.get("x-matcha-secret") !== secret) {
    console.warn("[recommend-jobs] rejected: bad/missing x-matcha-secret");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch (err) {
    console.error("[recommend-jobs] invalid JSON body", err);
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const phoneNumber = asString(payload.phone_number);
  if (!phoneNumber) {
    console.warn("[recommend-jobs] rejected: missing phone_number");
    return new Response(JSON.stringify({ error: "Missing phone_number" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const topNRaw = payload.top_n;
  const topN =
    typeof topNRaw === "number" && topNRaw > 0 && topNRaw <= 10
      ? Math.floor(topNRaw)
      : 3;

  console.log("[recommend-jobs] invoking action", { phoneNumber, topN });
  const result = await ctx.runAction(
    internal.careerProfiles.recommendJobs.recommendJobs,
    { phoneNumber, topN },
  );
  console.log("[recommend-jobs] action returned", {
    profileFound: result.profileFound,
    exhausted: result.exhausted,
    count: result.recommendations.length,
  });

  if (!result.profileFound) {
    return new Response(
      JSON.stringify({ error: "Profile not found for phone_number" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

export function registerCareerProfileRoutes(http: HttpRouter) {
  http.route({
    path: "/api/career-profile",
    method: "POST",
    handler: handleCreateCareerProfile,
  });
  http.route({
    path: "/api/recommend-jobs",
    method: "POST",
    handler: handleRecommendJobs,
  });
}
