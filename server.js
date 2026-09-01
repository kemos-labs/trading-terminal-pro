// Bootstrap — delegates to server/app.ts composition root (Phase 8 decomposition)

const PORT = parseInt(process.env.PORT || '3001', 10);

async function main() {
  const fixtureScenario = process.env.E2E_FIXTURE_SCENARIO;
  if (fixtureScenario) {
    const { installProviderBoundaryFixtures } = await import('./server/testing/providerBoundaryFixtures.js');
    installProviderBoundaryFixtures(fixtureScenario);
  }
  const { buildServer } = await import('./server/app.js');
  const fastify = await buildServer();
  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Server running at http://localhost:${PORT}`);
}

main().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});
