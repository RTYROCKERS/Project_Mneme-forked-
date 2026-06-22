/**
 * Content Generation Engine
 * Generates adaptive revision notes or quiz questions using GPT-4o.
 */

const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Generate revision content for a concept.
 * @returns {{ type: 'revision', title, summary, key_points: [], analogy, common_mistakes: [] }}
 */
async function generateRevision(conceptName, conceptDescription, masteryScore, difficulty) {
  const level = masteryScore < 0.4 ? 'beginner' : masteryScore < 0.7 ? 'intermediate' : 'advanced';

  const prompt = `
Generate a revision note for the concept: "${conceptName}"
Description: ${conceptDescription}
Difficulty: ${difficulty}
Student mastery level: ${level} (mastery score: ${masteryScore.toFixed(2)})

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

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5,
    max_tokens: 800,
  });

  const raw = response.choices[0].message.content.trim();
  const json = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(json);
}

/**
 * Generate quiz questions for a concept.
 * @returns {{ type: 'quiz', questions: [{ question, options: [], correct_index, explanation }] }}
 */
async function generateQuiz(conceptName, conceptDescription, masteryScore, difficulty) {
  const count = 5;
  const level = masteryScore < 0.4 ? 'basic recall' : masteryScore < 0.7 ? 'applied understanding' : 'deep analysis';

  const prompt = `
Generate ${count} multiple-choice quiz questions for: "${conceptName}"
Description: ${conceptDescription}
Difficulty: ${difficulty}
Focus on: ${level}

Return ONLY valid JSON:
{
  "type": "quiz",
  "concept": "${conceptName}",
  "questions": [
    {
      "question": "...",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "correct_index": 0,
      "explanation": "Why the answer is correct"
    }
  ]
}
`.trim();

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.4,
    max_tokens: 1200,
  });

  const raw = response.choices[0].message.content.trim();
  const json = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(json);
}

module.exports = { generateRevision, generateQuiz };
