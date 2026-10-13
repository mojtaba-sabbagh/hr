const { PHASE_DEVELOPMENT_SERVER } = require('next/constants');
module.exports = phase => ({
  reactStrictMode: true,
  // Keep development recompilation from overwriting production build output.
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
});
