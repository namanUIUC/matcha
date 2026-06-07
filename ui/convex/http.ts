import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { registerCareerProfileRoutes } from "./careerProfiles/endpoints";

const http = httpRouter();

auth.addHttpRoutes(http);
registerCareerProfileRoutes(http);

export default http;
