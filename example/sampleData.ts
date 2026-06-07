import type { CandidateProfile, Job, Transcript } from "../src/types.js";

// A small catalog in your real shape. (In production you'd load these from your
// DB / API.) Compensation is intentionally missing on one job to exercise the
// "unknown comp is not a filter failure" path.
export const SAMPLE_JOBS: Job[] = [
  {
    id: "9f3a2c10-4e7b-4d12-9a55-1b8c7e0d3f44",
    title: "Senior Product Engineer",
    company: "Casuro",
    description:
      "<h2>About the role</h2><p>We're hiring a Senior Product Engineer to own end-to-end delivery of our hiring workflows — from collaborative editing in TipTap to the Convex backend that powers real-time scoring.</p><h2>What we're looking for</h2><ul><li>5+ years of full-stack TypeScript</li><li>Comfort with real-time/collaborative systems</li><li>Bias for shipping</li></ul>",
    location: "San Francisco, CA",
    locationType: "hybrid",
    department: "Engineering",
    employmentType: "full_time",
    compensation: { label: "Estimated Base Salary", min: 180000, max: 230000, currency: "USD", period: "per year" },
    status: "live",
  },
  {
    id: "1a2b3c4d-0000-4000-8000-aaaaaaaaaaaa",
    title: "Senior Full-Stack Engineer (Remote)",
    company: "Northwind Labs",
    description:
      "<p>Fully remote senior full-stack role. Stack is React, Node, and Postgres. You'll work async with a small distributed team.</p><ul><li>4+ years building production web apps</li><li>Strong TypeScript</li><li>Self-directed</li></ul>",
    location: "Remote (US)",
    locationType: "remote",
    department: "Engineering",
    employmentType: "full_time",
    compensation: { min: 160000, max: 200000, currency: "USD", period: "per year" },
    status: "live",
  },
  {
    id: "2b3c4d5e-0000-4000-8000-bbbbbbbbbbbb",
    title: "Frontend Engineer",
    company: "Brightside",
    description:
      "<p>Build delightful UI for our consumer app. React + TypeScript. Design-minded engineers encouraged.</p><ul><li>2+ years frontend</li><li>CSS fluency</li></ul>",
    location: "New York, NY",
    locationType: "onsite",
    department: "Engineering",
    employmentType: "full_time",
    compensation: { min: 120000, max: 150000, currency: "USD", period: "per year" },
    status: "live",
  },
  {
    id: "3c4d5e6f-0000-4000-8000-cccccccccccc",
    title: "Staff Backend Engineer",
    company: "Ledgerline",
    description:
      "<p>Own our payments backend. Go and Postgres at scale. Heavy on reliability and on-call.</p><ul><li>7+ years backend</li><li>Distributed systems</li><li>Go preferred</li></ul>",
    location: "Remote (US)",
    locationType: "remote",
    department: "Engineering",
    employmentType: "full_time",
    // compensation intentionally omitted (your UI hides empty ranges).
    status: "live",
  },
  {
    id: "4d5e6f70-0000-4000-8000-dddddddddddd",
    title: "Part-Time Support Engineer",
    company: "Helply",
    description:
      "<p>Part-time customer-facing support engineering. Triage tickets, write docs, occasional scripting.</p>",
    location: "Remote (US)",
    locationType: "remote",
    department: "Support",
    employmentType: "part_time",
    compensation: { min: 50000, max: 70000, currency: "USD", period: "per year" },
    status: "live",
  },
  {
    id: "5e6f7080-0000-4000-8000-eeeeeeeeeeee",
    title: "Senior Platform Engineer",
    company: "Cloudgate",
    description:
      "<p>This role is filled.</p>",
    location: "Austin, TX",
    locationType: "onsite",
    employmentType: "full_time",
    status: "closed", // hard-filtered out (not live)
  },
];

export const SAMPLE_PROFILE: CandidateProfile = {
  name: "Priya R.",
  desiredRoles: ["Senior Product Engineer", "Full-Stack Engineer"],
  seniority: "senior",
  yearsExperience: 6,
  skills: ["TypeScript", "React", "Next.js", "Node", "Convex", "LLMs"],

  // --- Resume / experience ---
  headline: "Senior full-stack product engineer · TypeScript + AI",
  summary:
    "Product-minded full-stack engineer with 6 years shipping customer-facing web apps. " +
    "The last two years focused on building product features on top of LLMs — retrieval, " +
    "structured extraction, and eval harnesses. Most energized owning a feature end-to-end, " +
    "from UI to backend, and measuring its impact with real users.",
  workHistory: [
    {
      title: "Senior Software Engineer",
      company: "Tilework (Series B, hiring/HR SaaS)",
      dates: "2022–present",
      summary:
        "Owned the AI-assisted candidate-screening feature end-to-end: Next.js front end, " +
        "Convex backend, and an LLM scoring pipeline with an offline eval suite. Ran weekly " +
        "A/B tests on the onboarding funnel that lifted activation ~18%.",
      skills: ["TypeScript", "Next.js", "Convex", "LLMs", "Evals", "A/B testing"],
    },
    {
      title: "Full-Stack Engineer",
      company: "Brightloop (seed, consumer)",
      dates: "2019–2022",
      summary:
        "Built core product surfaces in React/Node, shipped the design system, and owned " +
        "conversion experiments on the growth surface.",
      skills: ["React", "Node", "Postgres", "Growth experiments"],
    },
  ],

  // --- Preferences (these, plus dealbreakers, drive the hard filter) ---
  // SF-based and happy to go into the office a few days a week, so she's open to
  // hybrid — this lets the strong customer-facing roles through the hard filter.
  location: { city: "San Francisco, CA", remotePreference: "any" },
  salaryExpectation: { min: 170000, currency: "USD" },
  employmentTypePreference: "full_time",
  dealbreakers: {
    fullTimeOnly: true, // drops contract/part-time/intern roles
    minSalary: 150000, // drops the disclosed-low-comp roles (e.g. SDR)
  },
};

export const SAMPLE_TRANSCRIPT: Transcript = [
  { role: "agent", text: "Thanks for joining! What are you looking for in your next role?" },
  {
    role: "user",
    text: "Senior full-stack product engineering — I love owning customer-facing features end to end. I'm in SF and happy to be hybrid, a few days in the office is great for me.",
  },
  { role: "agent", text: "Nice. Any particular kind of work you're drawn to right now?" },
  {
    role: "user",
    text: "I've been going deep on AI — building product features on top of LLMs, evals, that kind of thing. My stack is TypeScript, React/Next.js, and I've shipped on Convex. I want to keep shipping to real users, not pure infra. I also really like fast iteration — running A/B tests and conversion experiments on the frontend.",
  },
  { role: "agent", text: "And compensation expectations?" },
  { role: "user", text: "Low 200s would be great but I'm flexible above ~170 for the right product team." },
];
