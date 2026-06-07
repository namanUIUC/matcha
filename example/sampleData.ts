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

// ---------------------------------------------------------------------------
// Sample candidates
// ---------------------------------------------------------------------------
// A diverse set used by `npm run compare` to exercise the recommender. They're
// intentionally varied in domain, location/remote preference, employment-type
// flexibility, and salary floor — covering distinct matching cases for review.

export interface SampleCandidate {
  /** One-line description shown in the comparison report. */
  description: string;
  profile: CandidateProfile;
  transcript: Transcript;
}

// 1. Full-stack product engineer + AI. Hybrid-OK. Wants product, NOT infra —
//    tests that a topically-similar backend role is correctly excluded.
const priya: SampleCandidate = {
  description:
    "Senior full-stack product engineer (TS/React/Next/Convex) with 2 yrs of AI/LLM product work. SF, hybrid-OK, full-time, $170k+. Wants customer-facing product, explicitly not pure infra.",
  profile: {
    name: "Priya R.",
    desiredRoles: ["Senior Product Engineer", "Full-Stack Engineer"],
    seniority: "senior",
    yearsExperience: 6,
    skills: ["TypeScript", "React", "Next.js", "Node", "Convex", "LLMs"],
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
    location: { city: "San Francisco, CA", remotePreference: "any" },
    salaryExpectation: { min: 170000, currency: "USD" },
    employmentTypePreference: "full_time",
    dealbreakers: { fullTimeOnly: true, minSalary: 150000 },
  },
  transcript: [
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
  ],
};

// 2. Product designer with light front-end. Hybrid-OK. Should match the two
//    design roles (one remote, one onsite).
const maya: SampleCandidate = {
  description:
    "Senior product designer (Figma, design systems, research) who can prototype in React. SF, hybrid-OK, full-time, $140k+. Wants to own product design end-to-end.",
  profile: {
    name: "Maya L.",
    desiredRoles: ["Senior Product Designer", "Design Engineer"],
    seniority: "senior",
    yearsExperience: 7,
    skills: ["Figma", "Design systems", "User research", "Prototyping", "HTML/CSS", "React"],
    headline: "Senior product designer · systems + research",
    summary:
      "Product designer with 7 years across B2B SaaS. Owns design end-to-end: research, " +
      "design systems, high-fidelity prototypes, and shipping alongside engineers. Comfortable " +
      "enough in code to prototype in React.",
    workHistory: [
      {
        title: "Senior Product Designer",
        company: "Northstar (Series B SaaS)",
        dates: "2020–present",
        summary:
          "Built and owned the design system, ran weekly user research, and led the redesign " +
          "of the core dashboard end-to-end with engineering.",
        skills: ["Figma", "Design systems", "User research"],
      },
      {
        title: "Product Designer",
        company: "Loopcraft",
        dates: "2017–2020",
        summary: "Designed consumer onboarding flows and prototyped interactions in code.",
        skills: ["Figma", "Prototyping", "HTML/CSS"],
      },
    ],
    location: { city: "San Francisco, CA", remotePreference: "any" },
    salaryExpectation: { min: 150000, currency: "USD" },
    employmentTypePreference: "full_time",
    dealbreakers: { fullTimeOnly: true, minSalary: 140000 },
  },
  transcript: [
    { role: "agent", text: "What kind of role are you after?" },
    {
      role: "user",
      text: "Senior product design — I want to own the whole thing: research, the design system, and shipping with engineers. I'm in SF and fine going hybrid.",
    },
    { role: "agent", text: "How technical do you like to get?" },
    {
      role: "user",
      text: "I work in Figma mostly, but I can get into React to make a prototype real. I love sitting right next to engineering.",
    },
    { role: "agent", text: "Comp?" },
    { role: "user", text: "Around 150 and up depending on the team." },
  ],
};

// 3. Staff backend/data engineer who LIKES infra and on-call. Remote-only. The
//    mirror image of Priya — a clear, unambiguous infra match.
const dev: SampleCandidate = {
  description:
    "Staff backend/data engineer (Go, Postgres, Snowflake, dbt). Remote-only, full-time, $180k+. Enjoys infra, pipelines, and on-call; avoids front-end/product UI.",
  profile: {
    name: "Dev P.",
    desiredRoles: ["Staff Backend Engineer", "Data Engineer", "Platform Engineer"],
    seniority: "staff",
    yearsExperience: 9,
    skills: ["Go", "Postgres", "Snowflake", "dbt", "Distributed systems", "Airflow"],
    headline: "Staff backend/data engineer · pipelines at scale",
    summary:
      "Nine years building backend and data infrastructure. Owns real-time pipelines, data " +
      "modeling, and reliability/on-call. Energized by hard systems problems; not interested " +
      "in front-end or product UI work.",
    workHistory: [
      {
        title: "Staff Data Engineer",
        company: "Quanta (fintech)",
        dates: "2019–present",
        summary:
          "Built the analytics pipeline on Snowflake + dbt, owned a real-time scoring service " +
          "in Go, and ran the on-call rotation.",
        skills: ["Go", "Snowflake", "dbt", "Distributed systems"],
      },
      {
        title: "Backend Engineer",
        company: "Mileform",
        dates: "2015–2019",
        summary: "Payments backend in Go and Postgres at scale.",
        skills: ["Go", "Postgres"],
      },
    ],
    location: { city: "Austin, TX", remotePreference: "remote" },
    salaryExpectation: { min: 190000, currency: "USD" },
    employmentTypePreference: "full_time",
    dealbreakers: { remoteOnly: true, fullTimeOnly: true, minSalary: 180000 },
  },
  transcript: [
    { role: "agent", text: "What are you looking for?" },
    {
      role: "user",
      text: "Staff-level backend or data infra, fully remote. I like the hard systems stuff — pipelines, scoring services, reliability. On-call is fine, I'm good at it.",
    },
    { role: "agent", text: "Anything you want to avoid?" },
    {
      role: "user",
      text: "Front-end and pure product UI work — not my thing. Keep me in the backend.",
    },
    { role: "agent", text: "Comp?" },
    { role: "user", text: "180 and up." },
  ],
};

// 4. Enterprise AE, not technical. Hybrid-OK. Tests that "Solutions Engineer"
//    (technical sales) is not confused with a pure closing role.
const sara: SampleCandidate = {
  description:
    "Enterprise account executive, mid-market SaaS. Hybrid-OK, full-time, $150k+. Strong closer, explicitly not technical — a trap for the 'Solutions Engineer' role.",
  profile: {
    name: "Sara K.",
    desiredRoles: ["Account Executive", "Senior Account Executive", "Founding AE"],
    seniority: "senior",
    yearsExperience: 8,
    skills: ["Enterprise sales", "Pipeline generation", "Negotiation", "SaaS", "Salesforce"],
    headline: "Enterprise AE · mid-market SaaS closer",
    summary:
      "Eight years in SaaS sales, the last four owning full-cycle mid-market deals. Built the " +
      "outbound playbook as an early sales hire and consistently hit 120%+ of quota.",
    workHistory: [
      {
        title: "Account Executive",
        company: "Brightfunnel (Series C)",
        dates: "2020–present",
        summary:
          "Owned the full mid-market sales cycle, built the outbound playbook as the 2nd AE " +
          "hire, and closed 130% of quota in 2023.",
        skills: ["Enterprise sales", "Negotiation"],
      },
      {
        title: "SDR → AE",
        company: "Hatchways",
        dates: "2016–2020",
        summary: "Generated outbound pipeline, promoted to AE.",
        skills: ["Pipeline generation"],
      },
    ],
    location: { city: "Denver, CO", remotePreference: "any" },
    salaryExpectation: { min: 160000, currency: "USD" },
    employmentTypePreference: "full_time",
    dealbreakers: { fullTimeOnly: true, minSalary: 150000 },
  },
  transcript: [
    { role: "agent", text: "What's next for you?" },
    {
      role: "user",
      text: "A senior or founding AE seat at an early company where I can build the sales motion. I've done the 0-to-1 playbook thing before and loved it.",
    },
    { role: "agent", text: "How technical are the products you've sold?" },
    {
      role: "user",
      text: "Mid-market SaaS, not deeply technical. I'm a closer and a relationship person — I lean on sales engineers for the technical depth.",
    },
    { role: "agent", text: "Comp?" },
    { role: "user", text: "OTE 220+ ideally; base flexible above 150." },
  ],
};

// 5. Senior PM in the hiring/assessments domain. Hybrid-OK. Tests that a PM is
//    matched to the PM role, not to engineering roles on "product" overlap.
const jordan: SampleCandidate = {
  description:
    "Senior product manager for B2B/assessment products. SF, hybrid-OK, full-time, $160k+. Roadmap owner, technical-enough but not an engineer.",
  profile: {
    name: "Jordan M.",
    desiredRoles: ["Product Manager", "Senior Product Manager"],
    seniority: "senior",
    yearsExperience: 7,
    skills: ["Product strategy", "Roadmapping", "User research", "Analytics", "SQL", "B2B SaaS"],
    headline: "Senior PM · B2B SaaS, assessment & workflow products",
    summary:
      "Seven years in product. Owned roadmaps for B2B workflow tools, partnered daily with " +
      "engineering and design, and shipped measurable outcomes. Talks to customers weekly.",
    workHistory: [
      {
        title: "Senior Product Manager",
        company: "Gradely (HR tech)",
        dates: "2019–present",
        summary:
          "Owned the assessments product line, defined vision with eng/design, and lifted " +
          "completion rate 25%.",
        skills: ["Roadmapping", "Analytics"],
      },
      {
        title: "Product Manager",
        company: "Taskloop",
        dates: "2016–2019",
        summary: "Owned core workflow features for a B2B SaaS.",
        skills: ["Product strategy"],
      },
    ],
    location: { city: "San Francisco, CA", remotePreference: "any" },
    salaryExpectation: { min: 170000, currency: "USD" },
    employmentTypePreference: "full_time",
    dealbreakers: { fullTimeOnly: true, minSalary: 160000 },
  },
  transcript: [
    { role: "agent", text: "What role are you targeting?" },
    {
      role: "user",
      text: "Senior PM for a B2B product, ideally something in hiring or assessments — that's my domain. Hybrid in SF is great.",
    },
    { role: "agent", text: "How do you work with engineering?" },
    {
      role: "user",
      text: "Very closely — I define the vision with eng and design and stay in the weeds on outcomes. I'm not an engineer, but I'm technical enough to keep up.",
    },
    { role: "agent", text: "Comp?" },
    { role: "user", text: "170 and up." },
  ],
};

// 6. Mid-career marketer, REMOTE, open to contract OR full-time, low salary
//    floor. Tests employment-type flexibility — the contract content role
//    survives the filter only because she didn't set fullTimeOnly.
const alex: SampleCandidate = {
  description:
    "Lifecycle + content marketer, mid-career. Remote-only, open to contract or full-time, $80k+. Tests the contract/part-time path through the filter.",
  profile: {
    name: "Alex R.",
    desiredRoles: ["Lifecycle Marketing Manager", "Content Marketer"],
    seniority: "mid",
    yearsExperience: 4,
    skills: ["Lifecycle marketing", "Email", "Customer.io", "SEO", "Content", "Copywriting"],
    headline: "Lifecycle + content marketer",
    summary:
      "Four years in B2B SaaS marketing. Runs lifecycle email and in-app flows, owns the blog " +
      "and SEO content engine, and ships weekly experiments.",
    workHistory: [
      {
        title: "Lifecycle Marketing Specialist",
        company: "Sendwell",
        dates: "2021–present",
        summary:
          "Owns onboarding/activation/retention email and in-app flows in Customer.io; runs " +
          "weekly experiments.",
        skills: ["Lifecycle marketing", "Customer.io", "Email"],
      },
      {
        title: "Content Marketer",
        company: "Bloomwrite",
        dates: "2019–2021",
        summary: "Ran the blog and SEO content engine; published 2+ pieces a week.",
        skills: ["Content", "SEO", "Copywriting"],
      },
    ],
    location: { city: "Remote (US)", remotePreference: "remote" },
    salaryExpectation: { min: 90000, currency: "USD" },
    employmentTypePreference: "any",
    dealbreakers: { remoteOnly: true, minSalary: 80000 },
  },
  transcript: [
    { role: "agent", text: "What are you looking for?" },
    {
      role: "user",
      text: "Remote lifecycle or content marketing. I'm open to either a full-time role or a contract — flexible on that for the right team.",
    },
    { role: "agent", text: "Where do you do your best work?" },
    {
      role: "user",
      text: "Email lifecycle in Customer.io and SEO content. I like running experiments and watching the numbers move.",
    },
    { role: "agent", text: "Comp?" },
    { role: "user", text: "80k+ for full-time, or an hourly rate that works out similar for contract." },
  ],
};

export const SAMPLE_CANDIDATES: SampleCandidate[] = [
  priya,
  maya,
  dev,
  sara,
  jordan,
  alex,
];

// Back-compat single-candidate exports used by `npm run demo`.
export const SAMPLE_PROFILE: CandidateProfile = priya.profile;
export const SAMPLE_TRANSCRIPT: Transcript = priya.transcript;
