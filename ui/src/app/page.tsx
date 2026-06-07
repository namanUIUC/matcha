"use client";

import { useRef, useState } from "react";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useAction,
  useMutation,
  useQuery,
} from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  MapPin,
  Sparkles,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignInPage } from "@/components/SignInPage";
import { api } from "../../convex/_generated/api";

const MATCHA_PHONE = "+1 415 908 5001";

export default function Home() {
  return (
    <>
      <AuthLoading>
        <div className="flex min-h-screen w-screen items-center justify-center bg-gradient-to-b from-white to-gray-50">
          <Loader2 className="w-6 h-6 animate-spin text-casuro-dark" />
        </div>
      </AuthLoading>
      <Unauthenticated>
        <SignInPage />
      </Unauthenticated>
      <Authenticated>
        <HomeDashboard />
      </Authenticated>
    </>
  );
}

function HomeDashboard() {
  const { signOut } = useAuthActions();
  const data = useQuery(api.careerProfiles.me.getMyRecommendations);

  return (
    <div className="min-h-screen w-screen bg-gradient-to-b from-white to-gray-50">
      <header className="max-w-3xl mx-auto px-6 pt-10 pb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-casuro-dark">Matcha</h1>
          <p className="text-xs text-casuro-dark/60 mt-0.5">Powered by casuro.ai</p>
        </div>
        <Button
          variant="ghost"
          onClick={() => void signOut()}
          className="text-sm text-casuro-dark/70 hover:text-casuro-dark"
        >
          Sign out
        </Button>
      </header>

      <main className="max-w-3xl mx-auto px-6 pb-16 space-y-6">
        {data === undefined ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-casuro-dark" />
          </div>
        ) : data === null ? (
          <EmptyCard
            title="You're signed in"
            body="Couldn't read your session — try signing out and back in."
          />
        ) : !data.profile ? (
          <NoProfileCard />
        ) : (
          <>
            <ProfileCard profile={data.profile} />
            <RecommendationsSection
              recommendations={data.recommendations}
              hasProfile
            />
          </>
        )}
      </main>
    </div>
  );
}

function NoProfileCard() {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-8 shadow-sm text-center space-y-3">
      <h2 className="text-lg font-medium text-casuro-dark">
        Let's discover your next role
      </h2>
      <p className="text-sm text-casuro-dark/70">
        Call Matcha to start your career interview. We'll match you with roles
        once we've chatted.
      </p>
      <a
        href={`tel:${MATCHA_PHONE.replace(/\s/g, "")}`}
        className="inline-flex h-11 items-center justify-center rounded-full bg-casuro-dark text-white px-6 text-sm font-medium hover:bg-casuro-dark/90"
      >
        Call {MATCHA_PHONE}
      </a>
    </div>
  );
}

type EnrichStatus =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "parsing" }
  | { kind: "done" }
  | { kind: "error"; message: string };

function EnrichProfileButton() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<EnrichStatus>({ kind: "idle" });
  const generateUploadUrl = useMutation(
    api.careerProfiles.enrich.generateResumeUploadUrl,
  );
  const enrichFromResume = useAction(
    api.careerProfiles.enrich.enrichFromResume,
  );

  const busy = status.kind === "uploading" || status.kind === "parsing";

  async function handleFile(file: File) {
    setStatus({ kind: "uploading" });
    try {
      const uploadUrl = await generateUploadUrl({});
      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/pdf" },
        body: file,
      });
      if (!uploadRes.ok) {
        throw new Error(`Upload failed (${uploadRes.status})`);
      }
      const { storageId } = (await uploadRes.json()) as {
        storageId: string;
      };

      setStatus({ kind: "parsing" });
      await enrichFromResume({
        storageId: storageId as Parameters<typeof enrichFromResume>[0]["storageId"],
      });
      setStatus({ kind: "done" });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const label =
    status.kind === "uploading"
      ? "Uploading…"
      : status.kind === "parsing"
        ? "Parsing…"
        : status.kind === "done"
          ? "Profile updated"
          : status.kind === "error"
            ? "Try again"
            : "Enrich with resume";

  const icon = busy ? (
    <Loader2 className="w-3.5 h-3.5 animate-spin" />
  ) : status.kind === "done" ? (
    <CheckCircle2 className="w-3.5 h-3.5" />
  ) : status.kind === "error" ? (
    <AlertCircle className="w-3.5 h-3.5" />
  ) : (
    <Upload className="w-3.5 h-3.5" />
  );

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        title={
          status.kind === "error"
            ? status.message
            : "Upload a PDF resume to fill in your profile"
        }
        className="rounded-full border-casuro-dark/15 bg-white text-xs font-medium text-casuro-dark/80 hover:bg-casuro-muted hover:text-casuro-dark"
      >
        {icon}
        {label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleFile(file);
        }}
      />
    </>
  );
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm text-center space-y-2">
      <h2 className="text-lg font-medium text-casuro-dark">{title}</h2>
      <p className="text-sm text-casuro-dark/70">{body}</p>
    </div>
  );
}

type ProfileFragment = {
  name?: string;
  skills?: string[];
  preferredRoles?: string[];
  locationPreferences?: string[];
  workPreferences?: string[];
};

function ProfileCard({ profile }: { profile: ProfileFragment }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-3 gap-3">
        <h2 className="text-lg font-medium text-casuro-dark">
          {profile.name ? `Hi, ${profile.name}` : "Your profile"}
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-casuro-dark/50 hidden sm:inline">
            From your last call
          </span>
          <EnrichProfileButton />
        </div>
      </div>
      <ProfileRow label="Skills" items={profile.skills} />
      <ProfileRow label="Preferred roles" items={profile.preferredRoles} />
      <ProfileRow label="Location" items={profile.locationPreferences} />
      <ProfileRow label="Work preferences" items={profile.workPreferences} />
    </div>
  );
}

function ProfileRow({ label, items }: { label: string; items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <div className="w-32 shrink-0 text-casuro-dark/60">{label}</div>
      <div className="flex-1 flex flex-wrap gap-1.5">
        {items.map((it) => (
          <span
            key={it}
            className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-casuro-dark/80"
          >
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}

type JobRecommendation = {
  _id: string;
  _creationTime: number;
  score: number;
  reasons: string[];
  job: {
    _id: string;
    title: string;
    company: string;
    location: string;
    remoteType?: string;
    description?: string;
  } | null;
};

function RecommendationsSection({
  recommendations,
  hasProfile,
}: {
  recommendations: JobRecommendation[];
  hasProfile: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-casuro-dark/70" />
        <h2 className="text-sm font-medium text-casuro-dark">
          Recommended for you
        </h2>
        <span className="text-xs text-casuro-dark/50">
          {recommendations.length} matches
        </span>
      </div>

      {recommendations.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm text-center">
          <p className="text-sm text-casuro-dark/70">
            {hasProfile
              ? "Matcha hasn't sent over any jobs yet. They'll appear here once your interview is finished."
              : "Sign in and complete a call to see matches."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {recommendations.map((rec) => (
            <JobCard key={rec._id} rec={rec} />
          ))}
        </ul>
      )}
    </div>
  );
}

function JobCard({ rec }: { rec: JobRecommendation }) {
  if (!rec.job) return null;
  return (
    <li className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
      <div className="space-y-0.5">
        <h3 className="font-medium text-casuro-dark">{rec.job.title}</h3>
        <p className="text-sm text-casuro-dark/70">{rec.job.company}</p>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-casuro-dark/60 mt-2">
        <MapPin className="w-3.5 h-3.5" />
        <span>
          {rec.job.location}
          {rec.job.remoteType ? ` · ${rec.job.remoteType}` : ""}
        </span>
      </div>

      {rec.job.description && (
        <p className="text-sm text-casuro-dark/80 mt-3">
          {rec.job.description}
        </p>
      )}

      {rec.reasons.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          {rec.reasons.map((r) => (
            <span
              key={r}
              className="inline-flex items-center rounded-full bg-casuro-muted px-2.5 py-0.5 text-[11px] text-casuro-dark/70"
            >
              {r}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
