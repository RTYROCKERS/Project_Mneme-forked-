/**
 * Content Generation Engine
 * Generates adaptive revision notes and quiz questions using the Gemini API,
 * personalized to the learner's profile. Generation is driven purely by the
 * concept, its description and the topic context — no external resources.
 */

const { generateJSON } = require('../config/llm');

function profileBlock(userProfile) {
  return userProfile && userProfile.trim()
    ? `Learner profile (personalize tone, depth, examples and difficulty for this learner):\n${userProfile.trim()}`
    : 'Learner profile: not provided. Use sensible defaults.';
}

function topicBlock(topicDescription) {
  return topicDescription && topicDescription.trim()
    ? `Topic context (what the learner wants from this topic):\n${topicDescription.trim()}`
    : '';
}

/**
 * Generate revision content for a concept.
 * @returns {{ type: 'revision', title, summary, key_points: [], analogy, common_mistakes: [] }}
 */
async function generateRevision(conceptName, conceptDescription, masteryScore, difficulty, userProfile = '', topicDescription = '') {
  const level = masteryScore < 0.4 ? 'beginner' : masteryScore < 0.7 ? 'intermediate' : 'advanced';

  const prompt = `
Generate a revision note for the concept: "${conceptName}"
Concept description: ${conceptDescription}
Difficulty: ${difficulty}
Student mastery level: ${level} (mastery score: ${masteryScore.toFixed(2)})

${topicBlock(topicDescription)}

${profileBlock(userProfile)}

Return ONLY valid JSON with this shape:
{
  "type": "revision",
  "title": "...",
  "summary": "2-3 sentence summary",
  "key_points": ["point 1", "point 2", "point 3", "point 4"],
  "analogy": "a relatable real-world analogy",
  "common_mistakes": ["mistake 1", "mistake 2"]
}
`.trim();

  return generateJSON(prompt, { temperature: 0.5, maxOutputTokens: 800 });
}

/**
 * Generate a set of standalone quiz questions for a concept. Used both for the
 * on-demand quiz and to seed the reusable question bank.
 * @returns {Array<{ question, options: [], correct_index, explanation }>}
 */
async function generateQuizQuestions(conceptName, conceptDescription, masteryScore, difficulty, userProfile = '', topicDescription = '', count = 4) {
  const level = masteryScore < 0.4 ? 'basic recall' : masteryScore < 0.7 ? 'applied understanding' : 'deep analysis';

  const prompt = `
Generate ${count} multiple-choice quiz questions for the concept: "${conceptName}"
Concept description: ${conceptDescription}
Difficulty: ${difficulty}
Focus on: ${level}

${topicBlock(topicDescription)}

${profileBlock(userProfile)}

Return ONLY a valid JSON array (no wrapper object):
[
  {
    "question": "...",
    "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
    "correct_index": 0,
    "explanation": "Why the answer is correct"
  }
]
`.trim();

  const result = await generateJSON(prompt, { temperature: 0.4, maxOutputTokens: 1200 });
  const questions = Array.isArray(result) ? result : result?.questions || [];
  return questions
    .filter((q) => q && q.question && Array.isArray(q.options))
    .map((q) => ({
      question: String(q.question).trim(),
      options: q.options.map((o) => String(o)),
      correct_index: Number.isInteger(q.correct_index) ? q.correct_index : 0,
      explanation: String(q.explanation || '').trim(),
    }));
}

/**
 * Generate a full quiz payload for a concept (kept for the standalone quiz mode).
 * @returns {{ type: 'quiz', concept, questions: [...] }}
 */
async function generateQuiz(conceptName, conceptDescription, masteryScore, difficulty, userProfile = '', topicDescription = '') {
  const questions = await generateQuizQuestions(conceptName, conceptDescription, masteryScore, difficulty, userProfile, topicDescription, 5);
  return { type: 'quiz', concept: conceptName, questions };
}

module.exports = { generateRevision, generateQuiz, generateQuizQuestions };
