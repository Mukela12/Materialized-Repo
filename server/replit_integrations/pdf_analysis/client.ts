import { GoogleGenAI } from "@google/genai";

export const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

export interface ExtractedBrandColors {
  primary?: string;
  secondary?: string;
  accent?: string;
  background?: string;
  text?: string;
  additionalColors?: string[];
}

export interface ExtractedBrandFonts {
  headingFont?: string;
  bodyFont?: string;
  accentFont?: string;
  additionalFonts?: string[];
}

export interface BrandGuidelineAnalysis {
  colors: ExtractedBrandColors;
  fonts: ExtractedBrandFonts;
  logoDescription?: string;
  brandVoice?: string;
  confidence: number;
  rawAnalysis?: string;
}

const BRAND_ANALYSIS_PROMPT = `You are a brand guidelines analyst. Analyze the provided brand guideline document (PDF or image) and extract the following information:

1. **Brand Colors**: Identify the primary, secondary, accent, background, and text colors. For each color, provide the HEX value (e.g., #FF5733). If CMYK or RGB values are provided, convert them to HEX.

2. **Brand Fonts/Typography**: Identify the fonts used for headings, body text, and any accent fonts. Provide the font family names exactly as specified.

3. **Logo Description**: Briefly describe the brand's logo if visible.

4. **Brand Voice**: If tone/voice guidelines are mentioned, summarize them briefly.

Respond in the following JSON format only (no markdown, no explanations):
{
  "colors": {
    "primary": "#HEXCODE or null",
    "secondary": "#HEXCODE or null",
    "accent": "#HEXCODE or null",
    "background": "#HEXCODE or null",
    "text": "#HEXCODE or null",
    "additionalColors": ["#HEX1", "#HEX2"]
  },
  "fonts": {
    "headingFont": "Font Name or null",
    "bodyFont": "Font Name or null",
    "accentFont": "Font Name or null",
    "additionalFonts": ["Font1", "Font2"]
  },
  "logoDescription": "Brief description or null",
  "brandVoice": "Brief summary or null",
  "confidence": 0.0 to 1.0
}`;

function extractTextFromResponse(response: any): string {
  if (response.text) {
    return response.text;
  }
  
  const candidate = response.candidates?.[0];
  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.text) {
        return part.text;
      }
    }
  }
  
  return "";
}

function extractJsonFromText(text: string): any {
  if (!text || text.trim() === "") {
    throw new Error("Empty response from AI");
  }
  
  let jsonText = text;
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1].trim();
  }
  
  const jsonStart = jsonText.indexOf("{");
  const jsonEnd = jsonText.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error("No valid JSON found in response");
  }
  
  jsonText = jsonText.slice(jsonStart, jsonEnd + 1);
  return JSON.parse(jsonText);
}

const DEFAULT_ANALYSIS: BrandGuidelineAnalysis = {
  colors: {
    additionalColors: [],
  },
  fonts: {
    additionalFonts: [],
  },
  confidence: 0,
};

export async function analyzeBrandGuideline(
  fileBase64: string,
  mimeType: string = "application/pdf"
): Promise<BrandGuidelineAnalysis> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: BRAND_ANALYSIS_PROMPT },
            {
              inlineData: {
                mimeType,
                data: fileBase64,
              },
            },
          ],
        },
      ],
    });

    const responseText = extractTextFromResponse(response);
    
    try {
      const parsed = extractJsonFromText(responseText);
      const analysis: BrandGuidelineAnalysis = {
        colors: {
          primary: parsed.colors?.primary || undefined,
          secondary: parsed.colors?.secondary || undefined,
          accent: parsed.colors?.accent || undefined,
          background: parsed.colors?.background || undefined,
          text: parsed.colors?.text || undefined,
          additionalColors: parsed.colors?.additionalColors || [],
        },
        fonts: {
          headingFont: parsed.fonts?.headingFont || undefined,
          bodyFont: parsed.fonts?.bodyFont || undefined,
          accentFont: parsed.fonts?.accentFont || undefined,
          additionalFonts: parsed.fonts?.additionalFonts || [],
        },
        logoDescription: parsed.logoDescription || undefined,
        brandVoice: parsed.brandVoice || undefined,
        confidence: parsed.confidence || 0.5,
        rawAnalysis: responseText,
      };
      return analysis;
    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError);
      return {
        ...DEFAULT_ANALYSIS,
        rawAnalysis: responseText,
      };
    }
  } catch (error) {
    console.error("Error analyzing brand guideline:", error);
    throw new Error(
      `Failed to analyze brand guideline: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

export async function analyzeImageForColors(
  imageBase64: string,
  mimeType: string = "image/png"
): Promise<ExtractedBrandColors> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Analyze this image and extract the dominant brand colors. Respond with a JSON object containing HEX color codes:
{
  "primary": "#HEXCODE",
  "secondary": "#HEXCODE or null",
  "accent": "#HEXCODE or null",
  "additionalColors": ["#HEX1", "#HEX2"]
}

Only return the JSON, no explanations.`,
            },
            {
              inlineData: {
                mimeType,
                data: imageBase64,
              },
            },
          ],
        },
      ],
    });

    const responseText = extractTextFromResponse(response);
    
    try {
      const parsed = extractJsonFromText(responseText);
      return {
        primary: parsed.primary || undefined,
        secondary: parsed.secondary || undefined,
        accent: parsed.accent || undefined,
        background: parsed.background || undefined,
        text: parsed.text || undefined,
        additionalColors: parsed.additionalColors || [],
      };
    } catch (parseError) {
      console.error("Failed to parse AI color response:", parseError);
      return { additionalColors: [] };
    }
  } catch (error) {
    console.error("Error analyzing image for colors:", error);
    throw new Error(
      `Failed to extract colors from image: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
