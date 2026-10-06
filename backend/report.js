const PDFDocument = require("pdfkit");

function buildPdfReport(username, profile, platforms, history = []) {
  const document = new PDFDocument({ size: "A4", margin: 48 });
  const chunks = [];
  document.on("data", (chunk) => chunks.push(chunk));
  const complete = new Promise((resolve) => document.on("end", () => resolve(Buffer.concat(chunks))));

  document.fontSize(24).fillColor("#7c6aff").text("LeetMatric report");
  document.moveDown(.3).fontSize(14).fillColor("#222").text(`@${username}`);
  document.moveDown().fontSize(11).fillColor("#555").text("Coding profile overview");
  document.moveDown();

  const difficulty = profile.analytics.difficulty;
  const solved = difficulty.reduce((sum, item) => sum + item.solved, 0);
  document.fontSize(16).fillColor("#222").text("LeetCode");
  document.fontSize(11).text(`Problems solved: ${solved}`);
  document.text(`Current streak: ${profile.analytics.streaks.current} days`);
  document.text(`Longest streak: ${profile.analytics.streaks.longest} days`);
  document.text(`Global rank: ${profile.matchedUser.profile.ranking || "—"}`);
  document.moveDown(.5);
  difficulty.forEach((item) => document.text(`${item.difficulty}: ${item.solved} solved, ${item.acceptanceRate}% acceptance`));

  document.moveDown();
  document.fontSize(16).fillColor("#222").text("Other platforms");
  Object.values(platforms).forEach((platform) => {
    const status = platform.available ? "available" : platform.error;
    document.fontSize(11).text(`${platform.provider}: ${status}`);
  });
  document.moveDown();
  document.fontSize(16).text("Progress history");
  if (history.length) history.forEach((entry) => document.fontSize(10).text(`${entry.date}: ${entry.totalSolved} solved`));
  else document.fontSize(11).fillColor("#555").text("No daily snapshot history yet.");
  document.end();
  return complete;
}

module.exports = { buildPdfReport };
