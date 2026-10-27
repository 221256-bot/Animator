import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createPlanEndpointHandler } from './server/aiPlanner.js';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'animation-planner-api',
      configureServer(server) {
        server.middlewares.use(
          '/api/generate-plan',
          createPlanEndpointHandler(),
        );
      },
    },
  ],
});
