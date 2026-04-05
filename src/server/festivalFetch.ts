import { createFestivalApp } from "./festivalApp";

let app: ReturnType<typeof createFestivalApp> | null = null;

function getApp() {
  if (!app) {
    app = createFestivalApp("/api");
  }
  return app;
}

/** Next.js Route Handler entry: forwards Request to the Hono app mounted at /api. */
export function festivalApiFetch(request: Request): Response | Promise<Response> {
  return getApp().fetch(request);
}
