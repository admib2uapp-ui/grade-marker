
import { GoogleGenAI, Type } from "@google/genai";
import { Assignment, AIResponse } from "../types";

const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

const getMimeType = (base64: string): string => {
  const match = base64.match(/^data:([^;]+);/);
  return match ? match[1] : "image/png";
};

export const analyzeAnswer = async (
  assignment: Assignment,
  studentAnswerImages: string[]
): Promise<AIResponse> => {
  const ai = getAI();

  const markingCriteriaString = assignment.markingPoints
    .map((m, i) => `${i + 1}. ${m.point} (Weight: ${m.weight})`)
    .join("\n");

  const prompt = `
    You are a professional academic grader with expertise in STEM.
    
    Task: Grade the Student's Answer (which may consist of multiple files/images provided in order) against the Marking Criteria based on the Teacher's Reference (also potentially multiple files/images).
    
    Marking Criteria:
    ${markingCriteriaString}

    STRICT GRADING RULES:
    1. SEQUENTIAL REVIEW: The files provided for both student and teacher are in logical order. Review them as a continuous piece of work.
    2. EXPLICIT FORMULA REQUIREMENT: If a marking point asks for "Stating the formula", the student MUST write the symbolic formula explicitly.
    3. SUBSTITUTION vs FORMULA: Correct numerical substitution DOES NOT satisfy a requirement to state the formula itself.
    4. ACCURACY: Check signs (+/-) and units carefully.
    5. JSON FORMAT: Output must be valid JSON matching the schema.
  `;

  // Use base64 data if available, otherwise fallback to text
  const teacherParts = assignment.teacherAnswerImagesBase64 && assignment.teacherAnswerImagesBase64.length > 0
    ? assignment.teacherAnswerImagesBase64.map(img => ({
      inlineData: {
        mimeType: getMimeType(img),
        data: img.split(',')[1]
      }
    }))
    : [{ text: "Use marking criteria as the only reference." }];

  const studentParts = studentAnswerImages.map(img => ({
    inlineData: {
      mimeType: getMimeType(img),
      data: img.split(',')[1]
    }
  }));

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: {
      parts: [
        { text: prompt },
        ...teacherParts,
        ...studentParts
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.NUMBER },
          totalPossible: { type: Type.NUMBER },
          feedback: { type: Type.STRING },
          criteriasMet: {
            type: Type.ARRAY,
            items: { type: Type.BOOLEAN }
          }
        },
        required: ["score", "totalPossible", "feedback", "criteriasMet"]
      }
    }
  });

  try {
    const text = response.text || "{}";
    return JSON.parse(text) as AIResponse;
  } catch (e) {
    console.error("Failed to parse AI response", e);
    throw new Error("AI grading failed.");
  }
};

export const extractMarkingPoints = async (images: string[]): Promise<string[]> => {
  const ai = getAI();
  const prompt = "Look at these solution files (images/PDFs) provided in order and list the specific marking points (e.g., 'Correct formula', 'Substitution', 'Final answer'). Return as a JSON array of strings.";

  const imageParts = images.map(img => ({
    inlineData: {
      mimeType: getMimeType(img),
      data: img.split(',')[1]
    }
  }));

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: {
      parts: [
        { text: prompt },
        ...imageParts
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: { type: Type.STRING }
      }
    }
  });

  const text = response.text || "[]";
  return JSON.parse(text);
};

export interface NoteSectionDraft {
  title: string;
  question: string;
  markingPoints: { point: string; weight: number }[];
}

export interface NoteAnalysisResult {
  noteSummary: string;
  sections: NoteSectionDraft[];
}

export const analyzeTeachingNote = async (
  noteFilesBase64: string[],
  context: { subjectName: string; className: string },
  teacherPrompt?: string
): Promise<NoteAnalysisResult> => {
  const ai = getAI();

  const prompt = `
    You are an expert teacher assistant.
    Analyze the provided teaching note (PDF/images). Summarize the note for teacher review and then split it into clear instructional sections.
    For each section, create a draft assignment with:
    - title: short, specific
    - question: clear student-facing prompt
    - markingPoints: 3-6 criteria, each with { point, weight } where weight is an integer.

    Context:
    Subject: ${context.subjectName}
    Class: ${context.className}

    Return JSON strictly matching the schema.

    Additional teacher prompt (optional):
    ${teacherPrompt || 'None'}
  `;

  const noteParts = noteFilesBase64.map(file => ({
    inlineData: {
      mimeType: getMimeType(file),
      data: file.split(',')[1]
    }
  }));

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: {
      parts: [
        { text: prompt },
        ...noteParts
      ]
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          noteSummary: { type: Type.STRING },
          sections: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                question: { type: Type.STRING },
                markingPoints: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      point: { type: Type.STRING },
                      weight: { type: Type.NUMBER }
                    },
                    required: ["point", "weight"]
                  }
                }
              },
              required: ["title", "question", "markingPoints"]
            }
          }
        },
        required: ["noteSummary", "sections"]
      }
    }
  });

  try {
    const text = response.text || "{}";
    return JSON.parse(text) as NoteAnalysisResult;
  } catch (e) {
    console.error("Failed to parse note analysis response", e);
    throw new Error("AI note analysis failed.");
  }
};
