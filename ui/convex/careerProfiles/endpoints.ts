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
  const secret = process.env.MATCHA_INGEST_SECRET;
  if (secret && request.headers.get("x-matcha-secret") !== secret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

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
    missingFields: missingFields && missingFields.length > 0
      ? missingFields
      : undefined,
  };

  const profileId = await ctx.runMutation(
    internal.careerProfiles.create.upsertProfile,
    args,
  );

  return new Response(JSON.stringify({ profileId }), {
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
}
