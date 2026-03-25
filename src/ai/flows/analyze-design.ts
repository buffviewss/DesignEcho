
'use server';

/**
 * @fileOverview Analyzes a design to identify its design language and theme.
 *
 * - analyzeDesign - A function that handles the design analysis process.
 * - AnalyzeDesignInput - The input type for the analyzeDesign function.
 * - AnalyzeDesignOutput - The return type for the analyzeDesign function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AnalyzeDesignInputSchema = z.object({
  imageReference: z
    .string()
    .describe(
      "A design image, as a data URI or a publicly accessible direct image URL. Expected format for data URI: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type AnalyzeDesignInput = z.infer<typeof AnalyzeDesignInputSchema>;

const AnalyzeDesignOutputSchema = z.object({
  designLanguage: z.string().describe('The identified design language.'),
  theme: z.string().describe('The identified theme of the design.'),
});
export type AnalyzeDesignOutput = z.infer<typeof AnalyzeDesignOutputSchema>;

export async function analyzeDesign(input: AnalyzeDesignInput): Promise<AnalyzeDesignOutput> {
  return analyzeDesignFlow(input);
}

const prompt = ai.definePrompt({
  name: 'analyzeDesignPrompt',
  input: {schema: AnalyzeDesignInputSchema},
  output: {schema: AnalyzeDesignOutputSchema},
  prompt: `You are an expert design analyst.

You will analyze the design and identify its design language and theme.

Design: {{media url=imageReference}}`,
});

const analyzeDesignFlow = ai.defineFlow(
  {
    name: 'analyzeDesignFlow',
    inputSchema: AnalyzeDesignInputSchema,
    outputSchema: AnalyzeDesignOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
