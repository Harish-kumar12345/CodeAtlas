// backend/features/notes/notes.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const service = require("./service");
const revisionService = require("../revision/service");
const db = require("../db");

test("notes: sanitizeText escapes html tags safely", () => {
  const dirty = '<script>alert("hack")</script>';
  const clean = service.sanitizeText(dirty);
  assert.equal(clean.includes("<script>"), false);
  assert.ok(clean.includes("&lt;script&gt;"));
});

test("notes: rejects notes that exceed maximum length", async () => {
  const hugeNote = "x".repeat(service.MAX_NOTE_LENGTH + 1);
  await assert.rejects(
    async () => {
      await service.saveNote("user-1", {
        problemSlug: "test-problem",
        noteMarkdown: hugeNote,
      });
    },
    { message: /maximum length/ }
  );
});

test("notes: saves, updates, filters by tag and respects ownership", async () => {
  await db.ensureInitialized();
  const userA = `user-a-${Date.now()}`;
  const userB = `user-b-${Date.now()}`;

  // User A creates note
  const note1 = await service.saveNote(userA, {
    problemSlug: "course-schedule",
    problemTitle: "Course Schedule",
    noteMarkdown: "Use topological sort with in-degrees array.",
    tags: ["graph", "topological-sort"],
    isFavourite: true,
  });

  assert.ok(note1.id);
  assert.equal(note1.problem_slug, "course-schedule");

  // User A updates note
  const updatedNote = await service.saveNote(userA, {
    problemSlug: "course-schedule",
    problemTitle: "Course Schedule",
    noteMarkdown: "Updated: Use Kahn algorithm for cycle detection.",
    tags: ["graph", "bfs"],
    isFavourite: true,
  });
  assert.equal(updatedNote.id, note1.id); // Same record updated

  // Filter by tag
  const graphNotes = await service.getNotes(userA, { tag: "graph" });
  assert.equal(graphNotes.length, 1);

  const missingTagNotes = await service.getNotes(userA, { tag: "dynamic-programming" });
  assert.equal(missingTagNotes.length, 0);

  // User B cannot see User A's note
  const userBNotes = await service.getNotes(userB);
  assert.equal(userBNotes.length, 0);

  // User B cannot delete User A's note
  const deleteRes = await service.deleteNote(userB, note1.id);
  assert.equal(deleteRes, false);

  // User A can delete
  const deleteSuccess = await service.deleteNote(userA, note1.id);
  assert.equal(deleteSuccess, true);
});

test("notes: addToRevision automatically schedules problem for spaced repetition", async () => {
  await db.ensureInitialized();
  const userC = `user-c-${Date.now()}`;

  await service.saveNote(userC, {
    problemSlug: "trapping-rain-water",
    problemTitle: "Trapping Rain Water",
    noteMarkdown: "Two pointers approach from left and right boundaries.",
    addToRevision: true,
  });

  const revItems = await revisionService.getAllItems(userC);
  assert.equal(revItems.length, 1);
  assert.equal(revItems[0].problem_slug, "trapping-rain-water");
});
