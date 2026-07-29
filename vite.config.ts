// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: "ssr" },
      // Workers AI and Email Sending are remote-only bindings, so the dev
      // server normally opens a proxy session and refuses to start without a
      // Cloudflare login ("Failed to fetch auth token: 400 Bad Request").
      // `npm run dev:local` sets LOCAL_ONLY to skip that, which is enough for
      // UI work and browser QA. Spam classification and outbound email need
      // the real bindings and do not work in this mode.
      ...(process.env.LOCAL_ONLY ? { remoteBindings: false } : {}),
    }),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
});
