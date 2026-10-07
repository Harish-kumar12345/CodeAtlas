// Companion Feature Flags Helper
function isFeatureEnabled(featureName) {
  const envKey = `FEATURE_${featureName.toUpperCase()}`;
  return process.env[envKey] === "true";
}

function getAllFeatureFlags() {
  return {
    revision: isFeatureEnabled("revision"),
    contests: isFeatureEnabled("contests"),
    badges: isFeatureEnabled("badges"),
    mock: isFeatureEnabled("mock"),
    hints: isFeatureEnabled("hints"),
    digest: isFeatureEnabled("digest"),
    notes: isFeatureEnabled("notes"),
  };
}

module.exports = {
  isFeatureEnabled,
  getAllFeatureFlags,
};
