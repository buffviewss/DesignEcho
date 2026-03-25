
'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { analyzeDesign, type AnalyzeDesignOutput } from '@/ai/flows/analyze-design';
import { generateSimilarDesign } from '@/ai/flows/generate-similar-design';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { UploadCloud, Download, Loader2, Wand2, Image as ImageIcon, FileText, Palette, Link as LinkIcon } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

const MAX_FILE_SIZE_MB = 5;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

const formSchema = z.object({
  uploadType: z.enum(["file", "url"], {
    required_error: "Please select an input type.",
  }),
  designFile: z
    .instanceof(File)
    .optional(),
  designLink: z
    .string()
    .optional(),
}).superRefine((data, ctx) => {
  if (data.uploadType === "file") {
    if (!data.designFile) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["designFile"],
        message: "Please select a design file.",
      });
      return;
    }
    if (data.designFile.size === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["designFile"],
        message: "File cannot be empty.",
      });
    }
    if (data.designFile.size > MAX_FILE_SIZE_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["designFile"],
        message: `Max file size is ${MAX_FILE_SIZE_MB}MB.`,
      });
    }
    if (!ACCEPTED_IMAGE_TYPES.includes(data.designFile.type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["designFile"],
        message: "Only .jpg, .jpeg, .png and .webp files are accepted.",
      });
    }
  } else if (data.uploadType === "url") {
    if (!data.designLink || data.designLink.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["designLink"],
        message: "Please enter an image URL.",
      });
    } else {
      const urlCheck = z.string().url("Please enter a valid URL.").safeParse(data.designLink);
      if (!urlCheck.success) {
         ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["designLink"],
            message: urlCheck.error.errors[0].message,
        });
      }
    }
  }
});

type FormValues = z.infer<typeof formSchema>;

const fileToDataUri = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

/**
 * Attempts to extract a core design PNG URL from specific Amazon composite image URLs,
 * by decoding the URL and looking for a "|FILENAME.png|" pattern.
 * Inspired by the Python code:
 *   decoded_url = urllib.parse.unquote(url)
 *   match = re.search(r'\|([A-Za-z0-9]+\.png)\|', decoded_url)
 *   if match: image_id = match.group(1); return f"https://m.media-amazon.com/images/I/{image_id}"
 * @param url The Amazon image URL.
 * @returns The extracted design PNG URL if the pattern matches, otherwise null.
 */
const extractAmazonDesignUrl = (url: string): string | null => {
  try {
    const decodedUrl = decodeURIComponent(url);
    // This regex looks for a pattern like |FILENAME.png| in the decoded URL
    // FILENAME consists of alphanumeric characters.
    const amazonPattern = /\|([A-Za-z0-9]+\.png)\|/;
    const match = decodedUrl.match(amazonPattern);

    if (match && match[1]) {
      const imageId = match[1]; // This is the 'A1ujmf8lbiL.png' or '81EZJhIK7dL.png' part
      
      // Check if the original or decoded URL is an Amazon media URL before constructing.
      const baseAmazonUrlPattern = /^https?:\/\/m\.media-amazon\.com\/images\/I\//;
      if (baseAmazonUrlPattern.test(url) || baseAmazonUrlPattern.test(decodedUrl)) {
         return `https://m.media-amazon.com/images/I/${imageId}`;
      }
    }
  } catch (e) {
    // Error decoding URL might mean it's not a candidate for this extraction
    // console.warn("Could not extract Amazon design URL with Python-like method:", e);
    return null;
  }
  return null; // Pattern not matched or not a confirmed Amazon URL
};


export default function DesignEchoPage() {
  const [inputImagePreview, setInputImagePreview] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalyzeDesignOutput | null>(null);
  const [generatedDesignDataUri, setGeneratedDesignDataUri] = useState<string | null>(null);
  
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<'analyzing' | 'generating' | null>(null);
  
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: "onChange", 
    defaultValues: {
      uploadType: "file",
      designFile: undefined,
      designLink: "",
    }
  });

  const uploadType = form.watch("uploadType");

  useEffect(() => {
    setInputImagePreview(null);
    if (uploadType === 'file') {
      form.resetField("designLink");
      form.clearErrors("designLink");
    } else {
      form.resetField("designFile");
      form.clearErrors("designFile");
    }
    form.trigger();
  }, [uploadType, form]);


  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      form.setValue('designFile', file, { shouldValidate: true });
      const reader = new FileReader();
      reader.onloadend = () => {
        setInputImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
      setAnalysisResult(null);
      setGeneratedDesignDataUri(null);
      setError(null);
    } else {
      setInputImagePreview(null);
      form.setValue('designFile', undefined, { shouldValidate: true });
    }
  };

  const handleLinkChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const url = event.target.value;
    form.setValue('designLink', url, { shouldValidate: true });
    
    const amazonDesignUrl = extractAmazonDesignUrl(url);
    const previewUrl = amazonDesignUrl || url;

    if (z.string().url().safeParse(previewUrl).success) {
        // Basic check if it looks like an image URL, or if it's an extracted Amazon URL
        if (/\.(jpeg|jpg|gif|png|webp)$/i.test(previewUrl) || amazonDesignUrl) {
            setInputImagePreview(previewUrl);
        } else {
            setInputImagePreview(null); 
        }
    } else {
      setInputImagePreview(null);
    }
    setAnalysisResult(null);
    setGeneratedDesignDataUri(null);
    setError(null);
  };

  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    setIsLoading(true);
    setError(null);
    setAnalysisResult(null);
    setGeneratedDesignDataUri(null);

    let imageReferenceForFlows: string | null = null;
    let usingExtractedUrl = false;

    try {
      if (data.uploadType === 'file' && data.designFile) {
        imageReferenceForFlows = await fileToDataUri(data.designFile);
      } else if (data.uploadType === 'url' && data.designLink) {
        const amazonDesignUrl = extractAmazonDesignUrl(data.designLink);
        if (amazonDesignUrl) {
          imageReferenceForFlows = amazonDesignUrl;
          usingExtractedUrl = true;
          toast({
            title: "Amazon URL Processed",
            description: "Successfully extracted core design from the Amazon link.",
          });
        } else {
          imageReferenceForFlows = data.designLink;
        }
      }

      if (!imageReferenceForFlows) {
        setError("No valid design input provided.");
        toast({ variant: "destructive", title: "Error", description: "No valid design input." });
        setIsLoading(false);
        return;
      }
      
      // Update preview if an Amazon URL was extracted and differs from current input
      // or if the input type is URL and it's a valid image that wasn't an amazon extraction candidate
      if ( (usingExtractedUrl && inputImagePreview !== imageReferenceForFlows) || 
           (data.uploadType === 'url' && !usingExtractedUrl && inputImagePreview !== imageReferenceForFlows) ) {
        if (/\.(jpeg|jpg|gif|png|webp)$/i.test(imageReferenceForFlows)) {
            setInputImagePreview(imageReferenceForFlows);
        }
      }


      setLoadingStep('analyzing');
      toast({ title: "Analyzing Design", description: "AI is analyzing your design..." });
      const analysis = await analyzeDesign({ imageReference: imageReferenceForFlows });
      setAnalysisResult(analysis);
      toast({ title: "Analysis Complete", description: `Language: ${analysis.designLanguage}, Theme: ${analysis.theme}`});

      setLoadingStep('generating');
      toast({ title: "Generating New Design", description: "AI is crafting a new design based on the analysis..." });
      const generation = await generateSimilarDesign({ imageReference: imageReferenceForFlows });
      setGeneratedDesignDataUri(generation.generatedDesignDataUri);
      toast({ title: "Design Generated!", description: "Your new design is ready." });

    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
      setError(`Operation failed: ${errorMessage}`);
      toast({ variant: "destructive", title: "Error", description: `Operation failed: ${errorMessage}` });
    } finally {
      setIsLoading(false);
      setLoadingStep(null);
    }
  };

  const handleDownload = () => {
    if (!generatedDesignDataUri) return;
    const link = document.createElement('a');
    link.href = generatedDesignDataUri;
    const themePart = analysisResult?.theme.replace(/\s+/g, '_') || 'Generated';
    const languagePart = analysisResult?.designLanguage.replace(/\s+/g, '_') || 'Design';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.download = `DesignEcho_${languagePart}_${themePart}_${timestamp}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast({ title: "Download Started", description: "Your design is being downloaded." });
  };
  
  const currentProgress = loadingStep === 'analyzing' ? 33 : loadingStep === 'generating' ? 66 : isLoading ? 100 : 0;
  
  const isSubmitDisabled = isLoading || !form.formState.isValid || 
    (uploadType === 'file' && !form.getValues('designFile')) ||
    (uploadType === 'url' && (!form.getValues('designLink') || form.getValues('designLink')?.trim() === ''));


  return (
    <div className="container mx-auto px-4 py-8 md:px-8 md:py-12 min-h-screen flex flex-col items-center bg-background font-sans">
      <header className="mb-10 text-center">
        <div className="inline-flex items-center justify-center p-3 bg-primary/20 rounded-full mb-4">
            <Wand2 className="h-12 w-12 text-primary" />
        </div>
        <h1 className="text-5xl font-bold text-primary-foreground tracking-tight">DesignEcho</h1>
        <p className="text-muted-foreground mt-3 text-lg max-w-2xl mx-auto">
          Provide your design by uploading an image or pasting a URL, and let our AI echo its visual essence into a unique, new creation.
        </p>
      </header>

      <div className="w-full max-w-2xl space-y-8">
        <Card className="shadow-lg rounded-xl overflow-hidden">
          <CardHeader className="bg-muted/50 border-b">
            <CardTitle className="text-2xl flex items-center gap-2"><UploadCloud className="text-primary"/>1. Provide Your Design</CardTitle>
            <CardDescription>Choose to upload an image file or enter a direct image URL.</CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="uploadType"
                  render={({ field }) => (
                    <FormItem className="space-y-3">
                      <FormLabel>Input Method:</FormLabel>
                      <FormControl>
                        <RadioGroup
                          onValueChange={(value) => {
                            field.onChange(value);
                            if (value === 'file') {
                              form.setValue('designLink', '', { shouldValidate: false });
                              setInputImagePreview(null); 
                              form.clearErrors('designLink');
                            } else {
                              form.setValue('designFile', undefined, { shouldValidate: false });
                              setInputImagePreview(null);
                              form.clearErrors('designFile');
                            }
                            form.trigger(); 
                          }}
                          defaultValue={field.value}
                          className="flex flex-col sm:flex-row gap-4"
                          disabled={isLoading}
                        >
                          <FormItem className="flex items-center space-x-3 space-y-0">
                            <FormControl>
                              <RadioGroupItem value="file" id="file-type" />
                            </FormControl>
                            <FormLabel htmlFor="file-type" className="font-normal">
                              Upload File
                            </FormLabel>
                          </FormItem>
                          <FormItem className="flex items-center space-x-3 space-y-0">
                            <FormControl>
                              <RadioGroupItem value="url" id="url-type" />
                            </FormControl>
                            <FormLabel htmlFor="url-type" className="font-normal">
                              Enter Image URL
                            </FormLabel>
                          </FormItem>
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {uploadType === 'file' && (
                  <FormField
                    control={form.control}
                    name="designFile"
                    render={({ field }) => ( 
                      <FormItem>
                        <FormLabel htmlFor="designFile-input">Design File</FormLabel>
                         <FormDescription>Select an image file (PNG, JPG, WEBP, max {MAX_FILE_SIZE_MB}MB).</FormDescription>
                        <FormControl>
                          <Input
                            id="designFile-input"
                            type="file"
                            accept={ACCEPTED_IMAGE_TYPES.join(',')}
                            onChange={handleFileChange} 
                            className="text-base file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
                            disabled={isLoading}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {uploadType === 'url' && (
                  <FormField
                    control={form.control}
                    name="designLink"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="designLink-input">Image URL</FormLabel>
                        <FormDescription>
                          Paste a direct link to an image (e.g., ending in .jpg, .png). 
                          For some Amazon product images, we'll attempt to extract the core design automatically.
                        </FormDescription>
                        <FormControl>
                          <div className="relative flex items-center">
                            <LinkIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              id="designLink-input"
                              type="url"
                              placeholder="https://example.com/image.png"
                              {...field} 
                              onChange={(e) => {
                                field.onChange(e); 
                                handleLinkChange(e); 
                              }}
                              className="pl-10 text-base"
                              disabled={isLoading}
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                
                {inputImagePreview && (
                  <div className="mt-4 p-4 border rounded-lg bg-muted/30">
                    <Label className="text-sm font-medium text-muted-foreground mb-2 block">Preview:</Label>
                    <Image
                      src={inputImagePreview}
                      alt="Input design preview"
                      width={400}
                      height={400}
                      className="rounded-md object-contain max-h-64 w-auto mx-auto shadow-md"
                      data-ai-hint="design preview"
                      unoptimized // Use unoptimized for external URLs to avoid Next.js image optimization issues and ensure display
                      key={inputImagePreview} // Add key to force re-render on src change
                    />
                  </div>
                )}

                <Button 
                  type="submit" 
                  className="w-full text-lg py-6 bg-accent hover:bg-accent/90 text-accent-foreground rounded-lg shadow-md transition-all duration-150 ease-in-out transform hover:scale-105 active:scale-95"
                  disabled={isSubmitDisabled}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      {loadingStep === 'analyzing' ? 'Analyzing Design...' : 'Generating New Design...'}
                    </>
                  ) : (
                    <>
                      <Wand2 className="mr-2 h-5 w-5" />
                      Analyze & Generate Design
                    </>
                  )}
                </Button>
              </form>
            </Form>
            {isLoading && (
              <div className="mt-4 space-y-2">
                <Progress value={currentProgress} className="w-full h-2" />
                <p className="text-sm text-muted-foreground text-center">
                    {loadingStep === 'analyzing' ? 'Step 1 of 2: Analyzing your design...' : 
                     loadingStep === 'generating' ? 'Step 2 of 2: Generating new design...' : 
                     'Processing...'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {error && (
          <Alert variant="destructive" className="shadow-md rounded-lg">
            <AlertTitle className="font-semibold">Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {analysisResult && !isLoading && (
          <Card className="shadow-lg rounded-xl overflow-hidden">
            <CardHeader className="bg-muted/50 border-b">
              <CardTitle className="text-2xl flex items-center gap-2"><FileText className="text-primary"/>2. Design Analysis Complete</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-3">
              <div className="flex items-center">
                <Palette className="w-5 h-5 mr-2 text-primary" />
                <p className="text-md"><strong className="font-semibold text-primary-foreground">Design Language:</strong> {analysisResult.designLanguage}</p>
              </div>
              <div className="flex items-center">
                <ImageIcon className="w-5 h-5 mr-2 text-primary" />
                <p className="text-md"><strong className="font-semibold text-primary-foreground">Theme:</strong> {analysisResult.theme}</p>
              </div>
            </CardContent>
          </Card>
        )}

        {generatedDesignDataUri && !isLoading && (
          <Card className="shadow-lg rounded-xl overflow-hidden">
            <CardHeader className="bg-muted/50 border-b">
              <CardTitle className="text-2xl flex items-center gap-2"><ImageIcon className="text-primary"/>3. Your Echoed Design</CardTitle>
              <CardDescription>Here is the AI-generated design based on your input. Dimensions: 4500x5100px.</CardDescription>
            </CardHeader>
            <CardContent className="p-6 text-center space-y-4">
              <div className="bg-muted/30 p-4 rounded-lg inline-block max-w-full overflow-auto shadow-inner">
                 <Image
                    src={generatedDesignDataUri}
                    alt="Generated design"
                    width={450} 
                    height={510} 
                    className="rounded-md object-contain max-h-[510px] w-auto mx-auto shadow-md"
                    data-ai-hint="generated design art"
                  />
              </div>
              <Button onClick={handleDownload} className="w-full md:w-auto text-lg py-3 px-6 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg shadow-md transition-all duration-150 ease-in-out transform hover:scale-105 active:scale-95">
                <Download className="mr-2 h-5 w-5" />
                Download Design (PNG)
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
      <footer className="mt-12 text-center text-sm text-muted-foreground">
        <p>&copy; {new Date().getFullYear()} DesignEcho. Powered by Generative AI.</p>
      </footer>
    </div>
  );
}

