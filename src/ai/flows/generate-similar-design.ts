
'use server';
/**
 * @fileOverview AI agent that generates a new design with a similar design language and theme to the input design.
 *
 * - generateSimilarDesign - A function that handles the design generation process.
 * - GenerateSimilarDesignInput - The input type for the generateSimilarDesign function.
 * - GenerateSimilarDesignOutput - The return type for the generateSimilarDesign function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateSimilarDesignInputSchema = z.object({
  imageReference: z
    .string()
    .describe(
      "A design image, as a data URI or a publicly accessible direct image URL. Expected format for data URI: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type GenerateSimilarDesignInput = z.infer<typeof GenerateSimilarDesignInputSchema>;

const GenerateSimilarDesignOutputSchema = z.object({
  generatedDesignDataUri: z
    .string()
    .describe('A new design (PNG format, 4500x5100px) with a similar design language and theme, as a data URI.'),
});
export type GenerateSimilarDesignOutput = z.infer<typeof GenerateSimilarDesignOutputSchema>;

export async function generateSimilarDesign(input: GenerateSimilarDesignInput): Promise<GenerateSimilarDesignOutput> {
  return generateSimilarDesignFlow(input);
}

// Note: The prompt text itself doesn't need `imageReference` directly for the ai.generate call here,
// as the image is passed in the structured prompt array.
// However, the input schema change is important.

const generateSimilarDesignFlow = ai.defineFlow(
  {
    name: 'generateSimilarDesignFlow',
    inputSchema: GenerateSimilarDesignInputSchema,
    outputSchema: GenerateSimilarDesignOutputSchema,
  },
  async input => {
    const {media} = await ai.generate({
      model: 'googleai/gemini-2.0-flash-exp',
      prompt: [
        {media: {url: input.imageReference}}, // Use imageReference here
        {text: 'Generate a design with a similar design language and theme. The design should be in PNG format with a size of 4500x5100 pixels.'},
      ],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    });

    return {generatedDesignDataUri: media.url!};
  }
);
